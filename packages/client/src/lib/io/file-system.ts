/**
 * The File System Access API, declared and feature-detected in one place.
 *
 * TypeScript 6.0's `lib.dom.d.ts` declares `FileSystemFileHandle`,
 * `createWritable()` and `FileSystemWritableFileStream`, but NOT
 * `window.showSaveFilePicker`, `window.showOpenFilePicker` or
 * `DataTransferItem.getAsFileSystemHandle` — the three entry points that would
 * actually hand you one. So the gap is declared here, narrowly, rather than
 * papered over with `any` at each call site.
 *
 * THE FALLBACK IS NOT A DEGRADED MODE, it is the path Firefox and Safari take.
 * Neither implements `showSaveFilePicker`, so an anchor with a `download`
 * attribute over a blob URL is what most users get, and it has to be the
 * tested path rather than the afterthought.
 *
 * `URL.revokeObjectURL` IS NOT OPTIONAL. A blob URL pins its blob in memory
 * for the life of the document, so a chemist exporting thirty panel figures
 * would leak thirty molfiles. It is revoked on the next task rather than
 * immediately, because revoking before the browser has started the download
 * cancels it in Safari.
 */

export interface SaveFilePickerOptions {
  readonly suggestedName?: string;
  readonly types?: readonly {
    readonly description: string;
    readonly accept: Readonly<Record<string, readonly string[]>>;
  }[];
}

interface FileSystemAccessWindow {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: readonly {
      description: string;
      accept: Record<string, readonly string[]>;
    }[];
  }) => Promise<readonly FileSystemFileHandle[]>;
}

function fsaWindow(): FileSystemAccessWindow | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as FileSystemAccessWindow);
}

export function hasFileSystemAccess(): boolean {
  return typeof fsaWindow()?.showSaveFilePicker === "function";
}

export type WriteOutcome =
  | { readonly ok: true; readonly method: "file-system-access" | "download" }
  /** The user dismissed the picker. Not an error; nothing should be said. */
  | { readonly ok: false; readonly cancelled: true }
  | { readonly ok: false; readonly cancelled: false; readonly message: string };

/** How long to keep a blob URL alive after clicking its anchor. */
const REVOKE_DELAY_MS = 60_000;

function downloadBlob(blob: Blob, filename: string): WriteOutcome {
  if (typeof document === "undefined") {
    return { ok: false, cancelled: false, message: "There is no document to download from." };
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, REVOKE_DELAY_MS);
  return { ok: true, method: "download" };
}

/** True for the DOMException a dismissed picker throws, which must not be
 *  reported as a failure — the user said no, and saying "save failed" at them
 *  is the editor arguing. */
function isDismissal(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function writeTextFile(
  text: string,
  filename: string,
  mimeType: string,
  description: string,
  extension: string,
): Promise<WriteOutcome> {
  return writeBlobFile(new Blob([text], { type: mimeType }), filename, mimeType, description, extension);
}

/**
 * Write a blob, or a blob that is still being produced.
 *
 * WHY `content` MAY BE A FUNCTION. `showSaveFilePicker` requires transient
 * user activation, which an `await` spends: a PNG that is rasterised first
 * and offered for saving second opens no picker at all in Chromium. So the
 * picker is opened FIRST, while the click that asked for the export still
 * counts, and only then is the content produced. The download fallback has
 * no such constraint and produces the content before clicking its anchor.
 *
 * A producer that throws is reported as a failure with its message, never as
 * a silent empty file.
 */
export async function writeBlobFile(
  content: Blob | (() => Promise<Blob>),
  filename: string,
  mimeType: string,
  description: string,
  extension: string,
): Promise<WriteOutcome> {
  const produce = async (): Promise<Blob> =>
    typeof content === "function" ? content() : content;
  const failure = (error: unknown): WriteOutcome => ({
    ok: false,
    cancelled: false,
    message: error instanceof Error ? error.message : String(error),
  });

  const picker = fsaWindow()?.showSaveFilePicker;
  if (typeof picker !== "function") {
    try {
      return downloadBlob(await produce(), filename);
    } catch (error) {
      return failure(error);
    }
  }

  let handle: FileSystemFileHandle;
  try {
    handle = await picker({
      suggestedName: filename,
      types: [{ description, accept: { [mimeType]: [extension] } }],
    });
  } catch (error) {
    // Dismissed: the user said no. Anything else (a sandboxed iframe, a
    // blocked picker): fall back to a plain download rather than failing an
    // export the browser is perfectly able to deliver.
    if (isDismissal(error)) return { ok: false, cancelled: true };
    try {
      return downloadBlob(await produce(), filename);
    } catch (produceError) {
      return failure(produceError);
    }
  }

  let blob: Blob;
  try {
    blob = await produce();
  } catch (error) {
    return failure(error);
  }

  try {
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return { ok: true, method: "file-system-access" };
  } catch (error) {
    if (isDismissal(error)) return { ok: false, cancelled: true };
    return {
      ok: false,
      cancelled: false,
      message: `That file could not be written: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** What a chemist's file manager will offer, plus the wildcard: the whole
 *  point of content sniffing is that the extension is not trusted. */
export const OPEN_ACCEPT = ".mol,.sdf,.sd,.json,.txt,.smi,.smiles,*";

export interface PickedFile {
  readonly name: string;
  readonly text: string;
}

/**
 * Ask for files to open, through the picker where it exists and through a
 * detached `<input type="file">` where it does not.
 *
 * Resolves to an empty array when the user cancels. The input fallback has NO
 * cancel event in any browser that predates `cancel` on file inputs, so a
 * promise that only settled on `change` would hang forever — the listener
 * pair below settles on either.
 */
export async function pickTextFiles(accept: string): Promise<readonly PickedFile[]> {
  const picker = fsaWindow()?.showOpenFilePicker;
  if (typeof picker === "function") {
    try {
      const handles = await picker({
        multiple: true,
        types: [
          {
            description: "Chemical structures",
            accept: { "chemical/x-mdl-molfile": accept.split(",") },
          },
        ],
      });
      const files = await Promise.all(handles.map((handle) => handle.getFile()));
      return await Promise.all(
        files.map(async (file) => ({ name: file.name, text: await file.text() })),
      );
    } catch (error) {
      if (isDismissal(error)) return [];
      // Fall through to the input, which works in more places than the picker.
    }
  }

  if (typeof document === "undefined") return [];
  return new Promise<readonly PickedFile[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = true;
    input.style.display = "none";
    let settled = false;
    const finish = (files: readonly PickedFile[]): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener("cancel", () => {
      finish([]);
    });
    input.addEventListener("change", () => {
      const list = [...(input.files ?? [])];
      void Promise.all(
        list.map(async (file) => ({ name: file.name, text: await file.text() })),
      ).then(finish, () => {
        finish([]);
      });
    });
    document.body.append(input);
    input.click();
  });
}

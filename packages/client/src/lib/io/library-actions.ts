/**
 * The recents grid's Export library and Import, as functions that report.
 *
 * Kept out of the page for the reason `editor/commands/file.ts` is kept out of
 * the registry: they are async, they touch storage and the file system, and a
 * test should be able to drive them without rendering anything.
 *
 * ── THE PICKER OPENS BEFORE THE LIBRARY IS READ ────────────────────────────
 *
 * `showSaveFilePicker` needs the click's transient activation, and reading
 * forty sketches out of IndexedDB first can outlast it. So the export hands
 * `writeBlobFile` a PRODUCER, exactly as the PNG export does: the picker opens
 * on the click, and the library is read and serialised after the user has
 * chosen where it goes.
 *
 * ── THE IMPORT READER IS LOADED ON DEMAND ──────────────────────────────────
 *
 * `openText` brings chem-core's molblock reader and the SDF splitter with it.
 * The grid is the page every visit starts on, and most visits import nothing,
 * so the reader is fetched after the picker returns rather than with the page.
 */

import type { SketchDocument } from "@starter/shared";

import { SITE_NAME } from "@/lib/site";
import { importDocuments, loadAllDocuments } from "@/persistence/documents";

import { OPEN_ACCEPT, pickTextFiles, writeBlobFile, type PickedFile } from "./file-system";
import { libraryFileName, serializeLibrary } from "./library";
import type { OpenResult, OpenTextOptions } from "./open";

export interface ActionReport {
  /** "cancelled" says nothing: the user closed a dialog and knows they did. */
  readonly outcome: "done" | "failed" | "cancelled";
  readonly message: string | null;
}

const cancelled: ActionReport = { outcome: "cancelled", message: null };

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

export interface ExportLibraryOptions {
  /** Injectable clock, so a test can assert on the filename. */
  readonly now?: string | undefined;
  readonly write?: typeof writeBlobFile | undefined;
}

export async function exportLibrary(options: ExportLibraryOptions = {}): Promise<ActionReport> {
  const exportedAt = options.now ?? new Date().toISOString();
  const write = options.write ?? writeBlobFile;
  const filename = libraryFileName(exportedAt);
  // Filled in by the producer, which runs after the picker has closed.
  let exported = 0;
  let skipped: readonly string[] = [];

  const outcome = await write(
    async () => {
      const loaded = await loadAllDocuments();
      if (!loaded.ok) throw new Error(loaded.error.message);
      if (loaded.value.documents.length === 0) {
        throw new Error(
          loaded.value.failures[0] === undefined
            ? "There are no sketches to export."
            : `No sketch could be read — ${loaded.value.failures[0]}`,
        );
      }
      exported = loaded.value.documents.length;
      skipped = loaded.value.failures;
      return new Blob([serializeLibrary(loaded.value.documents, exportedAt).text], {
        type: "application/json",
      });
    },
    filename,
    "application/json",
    `${SITE_NAME} library`,
    ".json",
  );

  if (!outcome.ok) return outcome.cancelled ? cancelled : { outcome: "failed", message: outcome.message };
  const parts = [`Exported ${plural(exported, "sketch", "sketches")} to ${filename}.`];
  if (skipped.length > 0) {
    parts.push(
      `${plural(skipped.length, "sketch", "sketches")} could not be read and ${
        skipped.length === 1 ? "is" : "are"
      } not in the file — ${skipped[0] ?? ""}`,
    );
  }
  return { outcome: "done", message: parts.join(" ") };
}

export type OpenText = (text: string, options?: OpenTextOptions) => Promise<OpenResult>;

export interface ImportOptions {
  readonly pick?: (() => Promise<readonly PickedFile[]>) | undefined;
  /** Defaults to a dynamic import of `./open`; see the header. */
  readonly open?: OpenText | undefined;
}

/** The file picker, then every file into the library. Opens nothing. */
export async function importIntoLibrary(options: ImportOptions = {}): Promise<ActionReport> {
  const pick = options.pick ?? (() => pickTextFiles(OPEN_ACCEPT));
  const files = await pick();
  if (files.length === 0) return cancelled;
  const open = options.open ?? (await import("./open")).openText;

  const documents: SketchDocument[] = [];
  const warnings: string[] = [];
  for (const file of files) {
    const result = await open(file.text, { name: file.name });
    if (!result.ok) {
      warnings.push(`${file.name}: ${result.message}`);
      continue;
    }
    documents.push(...result.value.documents);
    warnings.push(...result.value.warnings);
  }
  if (documents.length === 0) {
    return { outcome: "failed", message: warnings[0] ?? "Nothing could be read from that file." };
  }

  const receipt = await importDocuments(documents);
  const parts: string[] = [];
  const [only] = receipt.saved;
  if (receipt.saved.length === 1 && only !== undefined) {
    parts.push(`Imported “${only.metadata.title}”.`);
  } else if (receipt.saved.length > 1) {
    parts.push(`Imported ${plural(receipt.saved.length, "sketch", "sketches")}.`);
  }
  parts.push(...warnings);
  if (receipt.forked > 0) {
    // Never overwritten: the copy in storage is newer than the file, and
    // replacing it would lose that work (see forkOverStoredDocuments).
    parts.push(
      receipt.forked === 1
        ? "1 was saved as a new sketch, because the copy in this browser was edited after the file was written."
        : `${String(receipt.forked)} were saved as new sketches, because the copies in this browser were edited after the file was written.`,
    );
  }
  // One failure is enough; they will nearly always be the same quota error.
  if (receipt.failures[0] !== undefined) {
    parts.push(
      `${plural(receipt.failures.length, "sketch", "sketches")} could not be saved — ${receipt.failures[0]}`,
    );
  }
  return {
    outcome: receipt.saved.length === 0 ? "failed" : "done",
    message: parts.join(" "),
  };
}

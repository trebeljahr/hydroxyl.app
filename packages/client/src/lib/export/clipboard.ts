/**
 * The async clipboard, used the one way that survives every browser.
 *
 * ── CALLED SYNCHRONOUSLY INSIDE THE GESTURE ──────────────────────────────
 *
 * `navigator.clipboard.write` needs transient user activation, and Safari
 * spends it at the first `await`. So the write is issued IMMEDIATELY, in the
 * same task as the click or keypress, and the slow parts — rasterising the
 * PNG, loading RDKit for a SMILES — ride inside the `ClipboardItem` as
 * PROMISES. Every command surface in the editor calls `run` synchronously
 * inside its handler, which is what makes this hold.
 *
 * ── ONE ITEM, SEVERAL REPRESENTATIONS ────────────────────────────────────
 *
 * A figure goes on the clipboard as ONE `ClipboardItem` carrying
 * `image/svg+xml`, `image/png` and `text/plain`, so each paste target picks
 * what it understands: a vector editor the SVG, a word processor the PNG, a
 * text field the markup. The plain text IS the SVG markup — Inkscape pastes
 * SVG text as vectors, and a plain-text SMILES here would load the 6.9 MB
 * wasm on every figure copy.
 *
 * A type the browser cannot write makes the WHOLE write reject (Firefox has
 * no `image/svg+xml`), so types are filtered through `ClipboardItem.supports`
 * where it exists.
 */

export type ClipboardParts = Readonly<Record<string, Promise<Blob>>>;

interface ClipboardItemStatic {
  new (items: Record<string, Promise<Blob> | Blob | string>): ClipboardItem;
  supports?: (type: string) => boolean;
}

/** Which of `types` this browser's clipboard accepts. */
export function supportedClipboardTypes(
  types: readonly string[],
  itemClass: ClipboardItemStatic | undefined = clipboardItemClass(),
): string[] {
  if (itemClass === undefined) return [];
  const supports = itemClass.supports;
  // Without `supports` (older Chromium, Safari before 17) there is no way to
  // ask, so the write is attempted with everything and reports its own
  // refusal.
  return typeof supports === "function" ? types.filter((type) => supports(type)) : [...types];
}

function clipboardItemClass(): ClipboardItemStatic | undefined {
  return typeof ClipboardItem === "undefined"
    ? undefined
    : (ClipboardItem as unknown as ClipboardItemStatic);
}

/**
 * Write one item with every supported part. Returns the promise
 * `clipboard.write` returned — call this BEFORE any `await`.
 *
 * Rejections from unsupported parts are swallowed so a promise nobody is
 * waiting on does not surface as an unhandled rejection; the write itself
 * still reports them.
 */
export function writeClipboardParts(parts: ClipboardParts): {
  readonly written: readonly string[];
  readonly done: Promise<void>;
} {
  const itemClass = clipboardItemClass();
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  const types = supportedClipboardTypes(Object.keys(parts), itemClass);
  for (const [type, promise] of Object.entries(parts)) {
    if (!types.includes(type)) promise.catch(() => undefined);
  }
  if (itemClass === undefined || clipboard === undefined || typeof clipboard.write !== "function") {
    return {
      written: [],
      done: Promise.reject(new Error("This browser does not allow writing to the clipboard.")),
    };
  }
  if (types.length === 0) {
    return {
      written: [],
      done: Promise.reject(new Error("The clipboard here accepts none of these formats.")),
    };
  }
  const entries: Record<string, Promise<Blob>> = {};
  for (const type of types) {
    const part = parts[type];
    if (part !== undefined) entries[type] = part;
  }
  return { written: types, done: clipboard.write([new itemClass(entries)]) };
}

export function textBlob(text: string, type = "text/plain"): Blob {
  return new Blob([text], { type });
}

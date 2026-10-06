/**
 * The whole library as one file: the backup, and the way to move sketches to
 * another browser.
 *
 * ── WHY IT EXISTS (decision 108) ───────────────────────────────────────────
 *
 * Sketches live in this origin's IndexedDB and nowhere else: no account, no
 * server, no sync. That keeps every structure on the chemist's own machine,
 * and it also means clearing site data, a browser that evicts storage under
 * pressure, or a new laptop loses the library. One file that restores
 * everything is the local-only answer to all three.
 *
 * ── EACH ENTRY IS A `.hydroxyl.json`, VERBATIM ─────────────────────────────
 *
 * `encodeDocument(doc)` per entry, exactly what the single-sketch export
 * writes, so the two formats cannot drift and every entry goes back through
 * the same migration ladder a stored row does (`decodeStored`). The envelope
 * adds only its own name and version.
 *
 * Not indented, unlike the single-sketch file. That one is kept in
 * repositories beside the figure it made, where a one-line JSON makes every
 * change a whole-file diff. A library backup is read by this code alone, and
 * two spaces per level is a third more bytes on a file that grows with every
 * sketch.
 *
 * ── ONE BAD ENTRY DOES NOT SINK THE FILE ───────────────────────────────────
 *
 * The SDF rule from `open.ts`: import what reads and name what did not. A
 * backup refused whole because of one hand-edited entry is a backup that
 * restores nothing.
 */

import { encodeDocument } from "@starter/shared";
import type { SketchDocument } from "@starter/shared";

import { SITE_NAME } from "@/lib/site";
import { decodeStored } from "@/persistence/migrate";

/** The envelope's `format` value. Checked with `Object.hasOwn`, since the
 *  file is untrusted input (see the note in persistence/migrate.ts). */
export const LIBRARY_FORMAT = "hydroxyl-library";

/**
 * Envelope names this build no longer writes but still reads, forever: every
 * backup made before the product was renamed says `chemistry-sketcher-library`
 * (decision 229). Only the name changed, so the same reader takes both.
 */
export const LEGACY_LIBRARY_FORMATS: readonly string[] = ["chemistry-sketcher-library"];

/** Bumped only when the ENVELOPE changes. A document schema change is the
 *  migration ladder's business, entry by entry. */
export const LIBRARY_FORMAT_VERSION = 1;

export interface LibraryFile {
  readonly format: typeof LIBRARY_FORMAT;
  readonly formatVersion: number;
  /** ISO-8601. */
  readonly exportedAt: string;
  readonly documents: readonly unknown[];
}

/** `hydroxyl-library-2026-09-29.json`. The date is the export's UTC day,
 *  which is what `exportedAt` inside the file says too. */
export function libraryFileName(exportedAt: string): string {
  return `hydroxyl-library-${exportedAt.slice(0, 10)}.json`;
}

export function serializeLibrary(
  documents: readonly SketchDocument[],
  exportedAt: string,
): { readonly text: string; readonly filename: string } {
  const file: LibraryFile = {
    format: LIBRARY_FORMAT,
    formatVersion: LIBRARY_FORMAT_VERSION,
    exportedAt,
    documents: documents.map((doc) => encodeDocument(doc)),
  };
  return { text: JSON.stringify(file), filename: libraryFileName(exportedAt) };
}

/** True when a parsed JSON value claims to be a library file, whatever its
 *  version. `readLibrary` decides whether it can actually be read. */
export function isLibraryFile(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null) return false;
  if (!Object.hasOwn(parsed, "format")) return false;
  const format = (parsed as Record<string, unknown>)["format"];
  return format === LIBRARY_FORMAT || LEGACY_LIBRARY_FORMATS.some((legacy) => legacy === format);
}

export type ReadLibraryResult =
  | {
      readonly ok: true;
      readonly documents: readonly SketchDocument[];
      /** One sentence per entry that was skipped. */
      readonly failures: readonly string[];
      /** How many entries the file held, read or not. */
      readonly entries: number;
    }
  | { readonly ok: false; readonly message: string };

function field(value: object, key: string): unknown {
  return Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
}

/** Read a parsed library file into documents. Never throws. */
export function readLibrary(parsed: unknown): ReadLibraryResult {
  if (!isLibraryFile(parsed) || typeof parsed !== "object" || parsed === null) {
    return { ok: false, message: `That file is not a ${SITE_NAME} library.` };
  }
  const version = field(parsed, "formatVersion");
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { ok: false, message: "That library file does not say which version wrote it." };
  }
  if (version > LIBRARY_FORMAT_VERSION) {
    // Refused rather than attempted, for migrate.ts's reason: a newer
    // envelope may carry something this build would drop without noticing.
    return {
      ok: false,
      message:
        `That library was written by a newer version of the editor ` +
        `(library format ${String(version)}; this build reads up to ${String(LIBRARY_FORMAT_VERSION)}).`,
    };
  }
  const entries = field(parsed, "documents");
  if (!Array.isArray(entries)) {
    return { ok: false, message: "That library file has no list of sketches." };
  }
  if (entries.length === 0) {
    return { ok: false, message: "That library file holds no sketches." };
  }

  const documents: SketchDocument[] = [];
  const failures: string[] = [];
  const seen = new Set<string>();
  entries.forEach((raw: unknown, index) => {
    const decoded = decodeStored(raw);
    const where = `sketch ${String(index + 1)} of ${String(entries.length)}`;
    if (!decoded.ok) {
      failures.push(`${where}: ${decoded.error.message}`);
      return;
    }
    // Two entries with one id would be written to the same three rows, the
    // second silently replacing the first. Only a hand-edited file does this,
    // and keeping the first and saying so loses nothing that was not already
    // ambiguous.
    if (seen.has(decoded.value.id)) {
      failures.push(`${where}: repeats the id of an earlier sketch in the same file`);
      return;
    }
    seen.add(decoded.value.id);
    documents.push(decoded.value);
  });

  if (documents.length === 0) {
    return {
      ok: false,
      message: `No sketch in that library could be read — ${failures[0] ?? ""}`,
    };
  }
  return { ok: true, documents, failures, entries: entries.length };
}

/** The warning for skipped entries, in the SDF path's words, or null. */
export function libraryFailureNote(
  failures: readonly string[],
  entries: number,
): string | null {
  if (failures.length === 0) return null;
  return `${String(failures.length)} of ${String(entries)} sketches could not be read — ${failures[0] ?? ""}`;
}

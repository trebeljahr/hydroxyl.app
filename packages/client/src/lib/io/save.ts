/**
 * Documents -> files. The export half of the file plumbing.
 *
 * TWO FORMATS, AND THEY ARE NOT INTERCHANGEABLE. The native `.chemsketch.json`
 * is the only lossless one — it carries the panels, the style preset, the
 * captions and the display flags, which is to say the figure rather than only
 * the molecule. A `.mol` carries the structure and nothing else, and is what
 * every other program reads.
 *
 * WRITING A MOLFILE CAN REFUSE, BY DESIGN (decision 8). An atom carrying a
 * cosmetic label — `Ph`, `Boc` — makes `writeMolblock` throw
 * `MolblockLabelError`, because a `Ph` written as a bare methyl is a wrong
 * structure in someone's paper. `@/lib/rdkit/translate` already turns that
 * into a `labelled-atoms` failure carrying the atom ids; this module surfaces
 * its message rather than catching and ignoring it, and the caller can then
 * offer to expand or strip the labels.
 *
 * `moleculeToMolblock`, not `writeMolblock` directly: the wrapper kekulises
 * first and enforces `hydrogenAssertion: "valence"`, and a file written with
 * the CTfile `hhh` query field arrives at RDKit as a query molecule with no
 * hydrogens — benzene as C6, silently, with an empty log. It also picks the
 * GENERATION (decision 49): V2000, except for a structure that states stereo
 * groups, which goes out as V3000 because V2000 cannot say `&1` and writing it
 * anyway would name a single enantiomer. The command that started the export
 * repeats that in its status line, from the wrapper's own sentence.
 */

import { encodeDocument } from "@starter/shared";
import type { SketchDocument } from "@starter/shared";

import { moleculeToMolblock } from "@/lib/rdkit/translate";

import { writeTextFile, type WriteOutcome } from "./file-system";

export type ExportFormat = "sketch" | "mol";

/** Filesystem-safe, and never empty — an untitled sketch still needs a name. */
export function fileBaseName(doc: SketchDocument): string {
  const cleaned = doc.metadata.title
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    // Collapse the runs the substitution creates and trim the ends: a title
    // ending in a `?` would otherwise become a filename ending in a dash.
    .replace(/-{2,}/g, "-")
    .replace(/^[-\s]+|[-\s]+$/g, "");
  return cleaned === "" ? "sketch" : cleaned.slice(0, 80);
}

export type SerializeResult =
  | { readonly ok: true; readonly text: string; readonly filename: string }
  | { readonly ok: false; readonly message: string };

/**
 * The whole serialisation, with no I/O — so the refusal path is unit-testable
 * without a DOM and without a file picker.
 */
export function serializeForExport(
  doc: SketchDocument,
  format: ExportFormat,
): SerializeResult {
  const base = fileBaseName(doc);
  if (format === "sketch") {
    return {
      ok: true,
      // Two spaces of indent: these files end up in repositories beside the
      // figures they made, and a one-line JSON makes every change a whole-file
      // diff — the same reason chem-render's serializer indents by default.
      text: JSON.stringify(encodeDocument(doc), null, 2),
      filename: `${base}.chemsketch.json`,
    };
  }
  const written = moleculeToMolblock(doc.molecule, doc.metadata.title);
  if (!written.ok) return { ok: false, message: written.error.message };
  return { ok: true, text: written.value, filename: `${base}.mol` };
}

const MIME: Readonly<Record<ExportFormat, string>> = {
  sketch: "application/json",
  mol: "chemical/x-mdl-molfile",
};

const DESCRIPTION: Readonly<Record<ExportFormat, string>> = {
  sketch: "Chemistry Sketcher document",
  mol: "MDL molfile",
};

const EXTENSION: Readonly<Record<ExportFormat, string>> = {
  sketch: ".json",
  mol: ".mol",
};

export async function exportDocument(
  doc: SketchDocument,
  format: ExportFormat,
): Promise<WriteOutcome> {
  const serialized = serializeForExport(doc, format);
  if (!serialized.ok) {
    return { ok: false, cancelled: false, message: serialized.message };
  }
  return writeTextFile(
    serialized.text,
    serialized.filename,
    MIME[format],
    DESCRIPTION[format],
    EXTENSION[format],
  );
}

/**
 * Document -> the three rows that get stored.
 *
 * The meta row is DENORMALISED here, at write time, and that is the whole
 * reason the recents grid can list a library without decoding a single
 * molecule. Everything it shows — the title, the timestamps, the formula, the
 * atom and bond counts — is computed once, when the document is already in
 * memory and already being walked.
 */

import { molecularFormulaUnicode } from "@starter/chem-core";
import { encodeDocument } from "@starter/shared";
import type { SketchDocument } from "@starter/shared";

import type { DocumentMeta, StoredRecord } from "./types";

export function metaFor(doc: SketchDocument): DocumentMeta {
  return {
    id: doc.id,
    title: doc.metadata.title,
    createdAt: doc.metadata.createdAt,
    modifiedAt: doc.metadata.modifiedAt,
    atomCount: doc.molecule.atomIds.length,
    bondCount: doc.molecule.bondIds.length,
    formulaUnicode: molecularFormulaUnicode(doc.molecule),
    schemaVersion: doc.schemaVersion,
  };
}

export function recordFor(
  doc: SketchDocument,
  thumbnail: string | null = null,
): StoredRecord {
  return { meta: metaFor(doc), encoded: encodeDocument(doc), thumbnail };
}

/**
 * The one structure argument every tool takes, and how it becomes a Molecule.
 *
 * EXACTLY ONE OF `smiles`, `molfile` OR `name`. An MCP input schema is a flat
 * object, so "one of" is checked here rather than in the schema; giving two
 * is refused rather than resolved by precedence, because an assistant that
 * sent both meant something and silently dropping half of it is a wrong
 * figure with no error.
 *
 * Read the way the editor reads them, so a structure means the same thing
 * here and on the canvas:
 *
 *   smiles   through RDKit (`normalizeMolblock`, as the worker's "normalize"
 *            op), then chem-core's reader via `molblockToMolecule`.
 *   molfile  chem-core's reader via `molblockToMolecule` — RDKit is not
 *            loaded for it at all — re-laid-out by RDKit only when the file
 *            has no usable 2D drawing (all atoms on one point, or a 3D
 *            conformer, which flattened to the page is a tangle). The editor
 *            offers "Clean up" for that; an assistant cannot click it.
 *   name     the insert box's structure dictionary.
 *
 * Every import is scaled to the standard bond (`normalizeBondLength`), as
 * `documentFromStructure` in the client's open.ts does, so a figure prints at
 * the house bond length whatever tool drew the molfile.
 */

import { normalizeBondLength, type Molecule } from "@starter/chem-core";
import {
  dictionaryMolecule,
  findDictionaryEntryByName,
  searchDictionary,
} from "@starter/chem-core/dictionary";
import { z } from "zod";

import { normalizeMolblock } from "@/lib/rdkit/ops";
import { hasMeaningfulCoordinates, molblockToMolecule } from "@/lib/rdkit/translate";

import type { RdkitRuntime } from "./rdkit.js";

export const structureShape = {
  smiles: z.string().optional().describe("A SMILES string, e.g. \"c1ccccc1\"."),
  molfile: z
    .string()
    .optional()
    .describe("An MDL molfile (V2000 or V3000), the whole text including the header lines."),
  name: z
    .string()
    .optional()
    .describe(
      "A common name from the editor's structure dictionary, e.g. \"benzene\", \"glycine\", \"DMSO\". " +
        "Not a full name-to-structure parser: unknown names are refused.",
    ),
};

export interface StructureInput {
  readonly smiles?: string | undefined;
  readonly molfile?: string | undefined;
  readonly name?: string | undefined;
}

export interface ResolvedStructure {
  readonly molecule: Molecule;
  readonly title: string;
  /** Which input it came from, for an editor link that reuses the text. */
  readonly source:
    | { readonly kind: "smiles"; readonly text: string }
    | { readonly kind: "molfile"; readonly text: string }
    | { readonly kind: "name"; readonly smiles: string };
  /** Things worth telling the caller; not failures. */
  readonly notes: readonly string[];
}

export type Resolved =
  | { readonly ok: true; readonly value: ResolvedStructure }
  | { readonly ok: false; readonly message: string };

export type LoadRdkit = () => Promise<RdkitRuntime>;

/** Which of the three was given, or the sentence explaining the refusal. */
function pickInput(
  input: StructureInput,
):
  | { readonly ok: true; readonly kind: "smiles" | "molfile" | "name"; readonly text: string }
  | { readonly ok: false; readonly message: string } {
  const given = (["smiles", "molfile", "name"] as const).filter(
    (key) => input[key] !== undefined && input[key].trim() !== "",
  );
  if (given.length === 0) {
    return { ok: false, message: "Give a structure as one of smiles, molfile or name." };
  }
  if (given.length > 1) {
    return {
      ok: false,
      message: `Give exactly one of smiles, molfile or name; this call gave ${given.join(" and ")}.`,
    };
  }
  const kind = given[0]!;
  return { ok: true, kind, text: input[kind]! };
}

export async function resolveStructure(
  input: StructureInput,
  loadRdkit: LoadRdkit,
): Promise<Resolved> {
  const picked = pickInput(input);
  if (!picked.ok) return picked;

  if (picked.kind === "name") {
    const entry = findDictionaryEntryByName(picked.text);
    if (entry === undefined) {
      const near = searchDictionary(picked.text, 5).map((match) => match.entry.name);
      return {
        ok: false,
        message:
          `“${picked.text}” is not in the structure dictionary. ` +
          (near.length > 0 ? `Close matches: ${near.join(", ")}. ` : "") +
          "Give a SMILES or a molfile instead.",
      };
    }
    return {
      ok: true,
      value: {
        molecule: dictionaryMolecule(entry),
        title: entry.name,
        source: { kind: "name", smiles: entry.smiles },
        notes: [],
      },
    };
  }

  if (picked.kind === "smiles") {
    const smiles = picked.text.trim();
    const { rdkit, log } = await loadRdkit();
    const normalized = normalizeMolblock(rdkit, smiles, "preserve", log);
    if (!normalized.ok) return { ok: false, message: normalized.message };
    const read = molblockToMolecule(normalized.value.molblock);
    if (!read.ok) return { ok: false, message: read.error.message };
    return {
      ok: true,
      value: {
        molecule: normalizeBondLength(read.value.molecule),
        title: "",
        source: { kind: "smiles", text: smiles },
        notes: [],
      },
    };
  }

  const read = molblockToMolecule(picked.text);
  if (!read.ok) return { ok: false, message: read.error.message };
  const threeD = read.report.warnings.some((warning) => warning.kind === "three-dimensional");
  if (!threeD && hasMeaningfulCoordinates(read.value.molecule)) {
    return {
      ok: true,
      value: {
        molecule: normalizeBondLength(read.value.molecule),
        title: read.value.title.trim(),
        source: { kind: "molfile", text: picked.text },
        notes: [],
      },
    };
  }
  // No drawing to keep: lay it out the way the editor's "Clean up" does.
  const { rdkit, log } = await loadRdkit();
  const laid = normalizeMolblock(rdkit, picked.text, "generate", log);
  if (!laid.ok) return { ok: false, message: laid.message };
  const relaid = molblockToMolecule(laid.value.molblock);
  if (!relaid.ok) return { ok: false, message: relaid.error.message };
  return {
    ok: true,
    value: {
      molecule: normalizeBondLength(relaid.value.molecule),
      title: read.value.title.trim(),
      source: { kind: "molfile", text: picked.text },
      notes: [
        threeD
          ? "The molfile carries 3D coordinates; a 2D layout was generated for the drawing."
          : "The molfile has no 2D layout; one was generated for the drawing.",
      ],
    },
  };
}

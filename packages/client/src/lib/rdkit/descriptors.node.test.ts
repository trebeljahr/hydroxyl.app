/**
 * The properties popover's descriptors (decision 235), against the real wasm.
 *
 * Every structure is DRAWN in chem-core and written by its molblock writer,
 * because that is the only path the editor takes: a test that handed RDKit a
 * SMILES would pass while the writer lost a hydrogen. The expected values
 * are RDKit's own for the same structure read from SMILES, so the assertion
 * is "the drawing reached RDKit intact", not a second opinion on Crippen.
 *
 * Runs in the `rdkit` vitest project, which loads the real wasm in node.
 */

import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";

import {
  benzene,
  buildMolecule,
  elementCounts,
  extractSelectedPart,
  insertFragment,
  addBond,
  vec,
} from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";

import { descriptorsAndMolblock, type RDKitLogLike, type RDKitModuleLike } from "./ops";
import { moleculeToMolblock, molblockToMolecule } from "./translate";

const require = createRequire(import.meta.url);

let RDKit: RDKitModuleLike;
let log: RDKitLogLike | null = null;

beforeAll(async () => {
  const initRDKitModule = require("@rdkit/rdkit") as () => Promise<RDKitModuleLike>;
  RDKit = await initRDKitModule();
  log = RDKit.set_log_capture?.("rdApp.*") ?? null;
}, 60_000);

function molblock(mol: Molecule): string {
  const written = moleculeToMolblock(mol);
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
}

function descriptorsOf(text: string) {
  const result = descriptorsAndMolblock(RDKit, text, log);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

/** Benzene with one substituent on its first ring atom. */
function monosubstituted(
  substituent: Molecule,
): { readonly mol: Molecule; readonly ring: readonly AtomId[] } {
  const ring = benzene();
  const ringIds = ring.atomIds;
  const inserted = insertFragment(ring, substituent);
  const mol = addBond(inserted.molecule, { from: ringIds[0]!, to: inserted.atomIds[0]! }).molecule;
  return { mol, ring: ringIds };
}

function benzoicAcid(): Molecule {
  return monosubstituted(
    buildMolecule((b) => {
      const c = b.atom("C", vec(0, 2));
      const o1 = b.atom("O", vec(-0.87, 2.5));
      const o2 = b.atom("O", vec(0.87, 2.5));
      b.bond(c, o1, 2);
      b.bond(c, o2);
    }),
  ).mol;
}

describe("descriptorsAndMolblock", () => {
  it("gives a drawn benzoic acid the descriptors RDKit gives its SMILES", () => {
    const drawn = descriptorsOf(molblock(benzoicAcid())).descriptors;
    const smiles = descriptorsOf("OC(=O)c1ccccc1").descriptors;
    expect(drawn).toEqual(smiles);
    // The Lipinski counts, not NumHBA: both carboxyl oxygens accept.
    expect(drawn).toEqual({ tpsa: 37.3, clogp: 1.3848, hbd: 1, hba: 2 });
  });

  it("measures a selected phenyl as a substituent, with five hydrogens", () => {
    const { mol, ring } = monosubstituted(buildMolecule((b) => void b.atom("C", vec(0, 2))));
    const result = descriptorsOf(molblock(extractSelectedPart(mol, ring)));
    // RDKit read the pins: the round trip still carries C6H5, not benzene.
    const back = molblockToMolecule(result.molblock);
    if (!back.ok) throw new Error(back.error.message);
    expect(elementCounts(back.value.molecule)).toEqual({ C: 6, H: 5 });
    expect(result.descriptors).toMatchObject({ tpsa: 0, hbd: 0, hba: 0 });
  });

  it("refuses an over-valent structure rather than measuring something else", () => {
    // Pentavalent carbon: RDKit's sanitizer refuses it, and the popover says
    // "unavailable" with RDKit's reason instead of a number.
    const mol = buildMolecule((b) => {
      const c = b.atom("C", vec(0, 0));
      for (let i = 0; i < 5; i++) b.bond(c, b.atom("F", vec(Math.cos(i), Math.sin(i))));
    });
    const result = descriptorsAndMolblock(RDKit, molblock(mol), log);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("sanitize-failed");
  });
});

import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";

import {
  buildMolecule,
  elementCounts,
  implicitHydrogenCount,
  isGenericStructure,
  molecularFormula,
  QUERY_ELEMENT,
  requireAtom,
  requireBond,
  setBondQuery,
  vec,
} from "@starter/chem-core";
import type { AtomId, AtomQuery, Molecule } from "@starter/chem-core";

import { normalizeMolblock, type RDKitLogLike, type RDKitModuleLike } from "./ops";
import { moleculeToMolblock, molblockToMolecule } from "./translate";

/**
 * Decision 238's query features across the real wasm.
 *
 * chem-core's own tests pin the molfile spellings — `R#` with `M  RGP`, `L`
 * with `M  ALS`, an `A  ` alias, bond types 5-8. This file is what keeps them
 * honest: RDKit MinimalLib reads what chem-core writes, writes it back in its
 * own words, and chem-core reads THAT. Asserted on chem-core's queries, never
 * on a SMILES string, for the reason the fidelity harness gives.
 */

const require = createRequire(import.meta.url);

let RDKit: RDKitModuleLike;
let log: RDKitLogLike | null = null;

beforeAll(async () => {
  const initRDKitModule = require("@rdkit/rdkit") as () => Promise<RDKitModuleLike>;
  RDKit = await initRDKitModule();
  log = RDKit.set_log_capture?.("rdApp.*") ?? null;
}, 60_000);

/**
 * A real Markush core: a phenyl ring with R1 at C1 and X = Cl, Br, I para to
 * it — the 4-halophenyl scaffold of a patent claim — plus a generic "Ar" on a
 * meta carbon, which has no MDL letter and so travels as `*` with an alias.
 */
function halophenylMarkush(): { mol: Molecule; ring: AtomId[] } {
  const ring: AtomId[] = [];
  const mol = buildMolecule((b) => {
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + Math.PI / 2;
      ring.push(b.atom("C", vec(Math.cos(angle), Math.sin(angle))));
    }
    for (let i = 0; i < 6; i++) b.bond(ring[i]!, ring[(i + 1) % 6]!, i % 2 === 0 ? 2 : 1);
    b.bond(ring[0]!, b.atom(QUERY_ELEMENT, vec(0, 2), { query: { kind: "rgroup", index: 1 } }));
    b.bond(
      ring[3]!,
      b.atom(QUERY_ELEMENT, vec(0, -2), {
        query: { kind: "list", elements: ["Cl", "Br", "I"], negated: false },
      }),
    );
    b.bond(
      ring[1]!,
      b.atom(QUERY_ELEMENT, vec(-1.8, 1), { query: { kind: "generic", label: "Ar" } }),
    );
  });
  return { mol, ring };
}

function roundTrip(mol: Molecule): Molecule {
  const written = moleculeToMolblock(mol, "markush");
  expect(written.ok).toBe(true);
  if (!written.ok) throw new Error("unreachable");
  const op = normalizeMolblock(RDKit, written.value, "preserve", log);
  expect(op).toMatchObject({ ok: true });
  if (!op.ok) throw new Error("unreachable");
  const read = molblockToMolecule(op.value.molblock);
  expect(read.ok).toBe(true);
  if (!read.ok) throw new Error("unreachable");
  return read.value.molecule;
}

const queriesOf = (mol: Molecule): (AtomQuery | undefined)[] =>
  mol.atomIds.map((id) => requireAtom(mol, id).query);

describe("a Markush core through RDKit (decision 238)", () => {
  it("keeps R1, the halogen list and the Ar placeholder, in place", () => {
    const { mol } = halophenylMarkush();
    const back = roundTrip(mol);
    expect(queriesOf(back)).toEqual(queriesOf(mol));
    expect(isGenericStructure(back)).toBe(true);
  });

  it("keeps the scaffold's hydrogens: neither gained nor lost at the substituted carbons", () => {
    const { mol } = halophenylMarkush();
    const back = roundTrip(mol);
    expect(elementCounts(back)).toEqual(elementCounts(mol));
    expect(elementCounts(back)).toEqual({ C: 6, H: 3 });
    expect(back.atomIds.map((id) => implicitHydrogenCount(back, id))).toEqual(
      mol.atomIds.map((id) => implicitHydrogenCount(mol, id)),
    );
    expect(molecularFormula(back)).toBe("C6H3R1[Cl,Br,I]Ar");
  });

  it("keeps every query bond type, and the order each is counted at", () => {
    const { mol, ring } = halophenylMarkush();
    let generic = mol;
    const kinds = ["any", "single-or-double", "single-or-aromatic", "double-or-aromatic"] as const;
    kinds.forEach((query, i) => {
      generic = setBondQuery(generic, generic.bondIds[i]!, query);
    });
    const back = roundTrip(generic);
    expect(back.bondIds.slice(0, 4).map((id) => requireBond(back, id).query)).toEqual([...kinds]);
    expect(back.bondIds.slice(0, 4).map((id) => requireBond(back, id).order)).toEqual([1, 1, 1, 2]);
    expect(ring.map((id) => implicitHydrogenCount(back, id))).toEqual(
      ring.map((id) => implicitHydrogenCount(generic, id)),
    );
  });

  it("keeps a NOT-list and an any-atom", () => {
    const mol = buildMolecule((b) => {
      const c = b.atom("C");
      b.bond(c, b.atom(QUERY_ELEMENT, vec(1, 0), { query: { kind: "list", elements: ["N", "O"], negated: true } }));
      b.bond(c, b.atom(QUERY_ELEMENT, vec(-1, 0), { query: { kind: "any", symbol: "A" } }));
    });
    expect(queriesOf(roundTrip(mol))).toEqual(queriesOf(mol));
  });
});

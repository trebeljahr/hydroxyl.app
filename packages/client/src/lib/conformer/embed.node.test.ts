/**
 * The 3D conformer against real molecules (decision 232).
 *
 * The geometry assertions are chemistry, not OpenChemLib's own word for it:
 * bond lengths a first-year textbook prints, and the HANDEDNESS of L-alanine
 * and of its enantiomer measured as a signed volume. The embedder's own
 * stereo check reads parities back through OpenChemLib, so a frame mistake
 * shared by the writer and the reader would pass it; the signed volume would
 * not.
 *
 * Runs in the `rdkit` vitest project (real files, slow), because it loads
 * OpenChemLib and its force-field tables directly.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { dictionaryMolecule, findDictionaryEntryByName } from "@starter/chem-core/dictionary";
import { insertFragment, invertStereocentre } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";
import * as OCL from "openchemlib";

import { moleculeToMolblock } from "@/lib/rdkit/translate";

import { embedConformer, FORCE_FIELD_RESOURCE_PREFIX } from "./embed";
import type { ConformerAtom, ConformerResult } from "./protocol";

const require = createRequire(import.meta.url);

beforeAll(() => {
  const all = JSON.parse(
    // Beside the entry point; the package exports no subpath for it.
    readFileSync(path.join(path.dirname(require.resolve("openchemlib")), "resources.json"), "utf8"),
  ) as Record<string, string>;
  OCL.Resources.register(
    Object.fromEntries(
      Object.entries(all).filter(([key]) => key.startsWith(FORCE_FIELD_RESOURCE_PREFIX)),
    ),
  );
});

/** Every wedge and hash swapped: the enantiomer, drawn in the same place. */
function enantiomer(mol: Molecule): Molecule {
  return mol.atomIds.reduce((next, id) => invertStereocentre(next, id), mol);
}

function named(name: string): Molecule {
  const entry = findDictionaryEntryByName(name);
  if (entry === undefined) throw new Error(`no dictionary entry ${name}`);
  return dictionaryMolecule(entry);
}

function embed(mol: Molecule): Extract<ConformerResult, { ok: true }> {
  const molblock = moleculeToMolblock(mol);
  if (!molblock.ok) throw new Error(molblock.error.message);
  const result = embedConformer(OCL, molblock.value);
  if (!result.ok) throw new Error(result.message);
  return result;
}

function distance(p: ConformerAtom, q: ConformerAtom): number {
  return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
}

function bondLengths(result: Extract<ConformerResult, { ok: true }>, a: string, b: string, order: number): number[] {
  return result.bonds
    .filter((bond) => bond.order === order)
    .map((bond) => [result.atoms[bond.a]!, result.atoms[bond.b]!] as const)
    .filter(([p, q]) => (p.element === a && q.element === b) || (p.element === b && q.element === a))
    .map(([p, q]) => distance(p, q));
}

/**
 * Signed volume at L-alanine's alpha carbon, by CIP priority: N, then the
 * carboxyl carbon, then the methyl carbon. Positive is counter-clockwise seen
 * from the side away from the hydrogen, which is (S).
 */
function alphaCarbonHandedness(result: Extract<ConformerResult, { ok: true }>): number {
  const { atoms, bonds } = result;
  const neighbours = (i: number): number[] =>
    bonds.flatMap((bond) => (bond.a === i ? [bond.b] : bond.b === i ? [bond.a] : []));
  const alpha = atoms.findIndex(
    (atom, i) => atom.element === "C" && neighbours(i).some((n) => atoms[n]!.element === "N"),
  );
  const around = neighbours(alpha);
  const nitrogen = around.find((n) => atoms[n]!.element === "N")!;
  const carboxyl = around.find((n) => neighbours(n).some((m) => atoms[m]!.element === "O"))!;
  const methyl = around.find(
    (n) => atoms[n]!.element === "C" && n !== carboxyl,
  )!;
  const c = atoms[alpha]!;
  const v = (i: number): [number, number, number] => [atoms[i]!.x - c.x, atoms[i]!.y - c.y, atoms[i]!.z - c.z];
  const [a, b, d] = [v(nitrogen), v(carboxyl), v(methyl)];
  return (
    a[0] * (b[1] * d[2] - b[2] * d[1]) -
    a[1] * (b[0] * d[2] - b[2] * d[0]) +
    a[2] * (b[0] * d[1] - b[1] * d[0])
  );
}

describe("embedConformer", () => {
  it("fills in ethanol's hydrogens and gives it textbook bond lengths", () => {
    const result = embed(named("ethanol"));
    expect(result.atoms.filter((atom) => atom.element === "H")).toHaveLength(6);
    expect(result.atoms).toHaveLength(9);
    for (const length of bondLengths(result, "C", "C", 1)) expect(length).toBeCloseTo(1.51, 1);
    for (const length of bondLengths(result, "C", "O", 1)) expect(length).toBeCloseTo(1.42, 1);
  });

  it("makes benzene flat with C=C shorter than C-C would be", () => {
    const result = embed(named("benzene"));
    const carbons = result.atoms.filter((atom) => atom.element === "C");
    // Planarity: every carbon within 0.05 Å of the plane through the centroid
    // normal to the ring. Using the cross product of two ring chords.
    const [p, q, r] = [carbons[0]!, carbons[2]!, carbons[4]!];
    const u = [q.x - p.x, q.y - p.y, q.z - p.z];
    const w = [r.x - p.x, r.y - p.y, r.z - p.z];
    const normal = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const size = Math.hypot(...normal);
    for (const atom of carbons) {
      const offset = ((atom.x - p.x) * normal[0]! + (atom.y - p.y) * normal[1]! + (atom.z - p.z) * normal[2]!) / size;
      expect(Math.abs(offset)).toBeLessThan(0.05);
    }
    for (const length of bondLengths(result, "C", "C", 2)) expect(length).toBeCloseTo(1.39, 1);
  });

  it("builds L-alanine as (S), and its enantiomer as (R)", () => {
    const alanine = named("L-alanine");
    expect(alphaCarbonHandedness(embed(alanine))).toBeGreaterThan(0);
    expect(alphaCarbonHandedness(embed(enantiomer(alanine)))).toBeLessThan(0);
  });

  it("keeps every drawn stereocentre of β-D-glucopyranose", () => {
    // Five stereocentres on a ring the minimiser has to pucker: the case the
    // retry exists for. A pass means one of the seeds kept all five.
    const result = embed(named("β-D-glucopyranose"));
    expect(result.atoms.filter((atom) => atom.element !== "H")).toHaveLength(12);
  });

  it("embeds each species on its own and sets them side by side, stereo intact", () => {
    // Benzene drawn to the left of L-alanine. Minimised together the two
    // would clump into one encounter complex; apart, each keeps its shape.
    const scheme = insertFragment(named("L-alanine"), named("benzene"), { offset: { x: -6, y: 0 } }).molecule;
    const result = embed(scheme);
    expect(result.atoms).toHaveLength(13 + 12);
    const carbons = result.atoms.filter((atom) => atom.element === "C");
    const alanineAtoms = result.atoms.slice(12);
    // Left to right as drawn: every benzene atom left of every alanine atom.
    const benzeneRight = Math.max(...result.atoms.slice(0, 12).map((atom) => atom.x));
    const alanineLeft = Math.min(...alanineAtoms.map((atom) => atom.x));
    expect(benzeneRight).toBeLessThan(alanineLeft);
    expect(carbons).toHaveLength(9);
    const alanineOnly = {
      ...result,
      atoms: alanineAtoms,
      bonds: result.bonds
        .filter((bond) => bond.a >= 12)
        .map((bond) => ({ ...bond, a: bond.a - 12, b: bond.b - 12 })),
    };
    expect(alphaCarbonHandedness(alanineOnly)).toBeGreaterThan(0);
  });

  it("is deterministic: one drawing, one picture", () => {
    const glycine = named("glycine");
    expect(embed(glycine).atoms).toEqual(embed(glycine).atoms);
  });

  it("refuses an empty drawing in words", () => {
    const empty = "\n  hydroxyl\n\n  0  0  0  0  0  0  0  0  0  0999 V2000\nM  END\n";
    const result = embedConformer(OCL, empty);
    expect(result).toMatchObject({ ok: false, reason: "empty" });
  });
});

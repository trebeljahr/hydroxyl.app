/**
 * isAchiral: proved by a per-atom mapping, never by comparing descriptors.
 *
 * meso-tartaric acid reads {R, S} and so does (2R,3S)-pentane-2,3-diol. The
 * descriptor multisets compare EQUAL, and so do those of their mirror images,
 * yet the first is achiral and the second chiral. A multiset test would call
 * both achiral. What separates them is which atom maps onto which, so every
 * achiral verdict here is checked through the mapping it returns.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isAchiral, MAX_AUTOMORPHISM_SEARCH_NODES } from "./achirality.js";
import { readMolblock } from "./molblock-read.js";
import { bondBetween } from "./molecule.js";
import { setBondStereo } from "./ops.js";
import { cipDescriptor, stereocenterAtoms } from "./stereo.js";
import type { Molecule } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = JSON.parse(readFileSync(join(HERE, "..", "test", "fixtures", "cip", "cases.json"), "utf8")) as {
  cases: Record<string, { molblock: string }>;
};

function fixture(name: string): Molecule {
  return readMolblock(CASES.cases[name]!.molblock).molecule;
}

function projection(file: string): Molecule {
  return readMolblock(readFileSync(join(HERE, "..", "test", "fixtures", "projection", file), "utf8")).molecule;
}

function letters(mol: Molecule): string[] {
  return stereocenterAtoms(mol)
    .map((id) => cipDescriptor(mol, id)?.kind ?? "-")
    .sort();
}

/** The mapping must be a bijection that preserves elements and bonds. */
function expectAutomorphism(mol: Molecule, mapping: ReadonlyMap<string, string>): void {
  expect(new Set(mapping.values()).size).toBe(mapping.size);
  for (const [from, to] of mapping) {
    expect(mol.atoms[to]!.element).toBe(mol.atoms[from]!.element);
  }
  for (const bondId of mol.bondIds) {
    const bond = mol.bonds[bondId]!;
    const a = mapping.get(bond.from);
    const b = mapping.get(bond.to);
    if (a === undefined || b === undefined) continue;
    expect(bondBetween(mol, a, b)?.order).toBe(bond.order);
  }
}

describe("isAchiral", () => {
  it("proves meso-tartaric acid achiral and (2R,3S)-pentane-2,3-diol chiral, though their letters match", () => {
    const meso = projection("meso-tartaric-acid.mol");
    const diol = projection("pentane-2r3s-diol.mol");
    // The trap: equal descriptor multisets.
    expect(letters(meso)).toEqual(["R", "S"]);
    expect(letters(diol)).toEqual(["R", "S"]);

    const result = isAchiral(meso);
    expect(result.kind).toBe("achiral");
    if (result.kind === "achiral") {
      expectAutomorphism(meso, result.mapping);
      // The mirror exchanges the two carbinol carbons.
      expect(result.mapping.get("a4")).toBe("a6");
      expect(result.mapping.get("a6")).toBe("a4");
    }
    expect(isAchiral(diol)).toEqual({ kind: "chiral" });
  });

  it("calls (R,R)-tartaric acid and D-glucose chiral", () => {
    expect(isAchiral(projection("rr-tartaric-acid.mol"))).toEqual({ kind: "chiral" });
    expect(isAchiral(projection("d-glucose-open.mol"))).toEqual({ kind: "chiral" });
  });

  it("handles pseudoasymmetric and ring cases", () => {
    expect(isAchiral(projection("ribaric-acid.mol")).kind).toBe("achiral");
    expect(isAchiral(fixture("ribitol")).kind).toBe("achiral");
    expect(isAchiral(fixture("arabinitol"))).toEqual({ kind: "chiral" });
    expect(isAchiral(fixture("galactitol")).kind).toBe("achiral");
    expect(isAchiral(fixture("glucitol"))).toEqual({ kind: "chiral" });
    expect(isAchiral(fixture("myo-inositol")).kind).toBe("achiral");
    expect(isAchiral(fixture("cis-1-4-dimethylcyclohexane")).kind).toBe("achiral");
    expect(isAchiral(projection("cis-1-2-dimethylcyclohexane.mol")).kind).toBe("achiral");
    expect(isAchiral(projection("trans-1-2-dimethylcyclohexane.mol"))).toEqual({ kind: "chiral" });
    expect(isAchiral(projection("meso-2-3-dibromobutane.mol")).kind).toBe("achiral");
    expect(isAchiral(projection("trans-2-butene.mol")).kind).toBe("achiral");
  });

  it("calls an unwedged butan-2-ol chiral: it is, whichever enantiomer was meant", () => {
    expect(isAchiral(fixture("butan-2-ol-flat"))).toEqual({ kind: "chiral" });
  });

  it("is undetermined when an unread unit is what the proof would need", () => {
    // meso-tartaric acid with both wedges removed could be meso or (R,R).
    const meso = projection("meso-tartaric-acid.mol");
    let flat = meso;
    for (const bondId of meso.bondIds) {
      if (meso.bonds[bondId]!.stereo !== "none") flat = setBondStereo(flat, bondId, "none");
    }
    expect(isAchiral(flat)).toEqual({ kind: "undetermined", reason: "unspecified-unit" });
  });

  it("is undetermined, never achiral, for a molecule with a stereogenic axis", () => {
    expect(isAchiral(fixture("penta-2-3-diene"))).toEqual({
      kind: "undetermined",
      reason: "unrepresentable-stereo",
    });
  });

  it("is bounded: past the search cap it says so instead of guessing", () => {
    expect(MAX_AUTOMORPHISM_SEARCH_NODES).toBe(100000);
    expect(isAchiral(fixture("cubane")).kind).toBe("achiral");
    expect(isAchiral(fixture("cubane"), { maxSearchNodes: 3 })).toEqual({
      kind: "undetermined",
      reason: "search-truncated",
    });
  });

  it("owns isAchiral alone and reads no coordinate", () => {
    // `export *` in index.ts drops a name two modules declare, SILENTLY, so
    // the barrel's hygiene test pins an owner per module. This module names
    // its own, beside the promise that it holds no second parity lift: the
    // proof is graph-only, so a drawing cannot move a molecule in or out of
    // it. (stereo-config.test.ts makes the same two checks for the others.)
    const text = readFileSync(join(HERE, "achirality.ts"), "utf8");
    expect(text).toMatch(/^export function isAchiral\b/m);
    expect(text).not.toMatch(/\.pos\b/);
    expect(text).not.toMatch(/liftParity|pointsParity/);
    expect(readFileSync(join(HERE, "index.ts"), "utf8")).toContain('"./achirality.js"');
  });
});

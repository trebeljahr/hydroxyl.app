/**
 * Drawing one implicit hydrogen as a real atom (decisions 131 and 152): the
 * count is conserved, a configuration never changes, and a refusal is named.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildMolecule } from "./builders.js";
import { elementCounts } from "./formula.js";
import { readMolblock } from "./molblock-read.js";
import { bondBetween } from "./molecule.js";
import { setAtomPosition, setBondStereo } from "./ops.js";
import { medianBondLength } from "./transform.js";
import { promoteImplicitHydrogen } from "./promote-hydrogen.js";
import { cipDescriptor, stereocenterAtoms } from "./stereo.js";
import type { AtomId, Molecule } from "./types.js";
import { implicitHydrogenCount } from "./valence.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "projection");

function load(file: string): Molecule {
  return readMolblock(readFileSync(join(FIXTURES, file), "utf8")).molecule;
}

function ethanol(): { mol: Molecule; ch2: AtomId; o: AtomId } {
  let ch2 = "";
  let o = "";
  const mol = buildMolecule((b) => {
    const ch3 = b.atom("C", { x: 0, y: 0 });
    ch2 = b.atom("C", { x: 0.87, y: 0.5 });
    b.bond(ch3, ch2);
    o = b.atom("O", { x: 1.73, y: 0 });
    b.bond(ch2, o);
  });
  return { mol, ch2, o };
}

describe("promoteImplicitHydrogen", () => {
  it("moves one hydrogen from the implicit count to a drawn atom, and nothing else", () => {
    const { mol, ch2 } = ethanol();
    const result = promoteImplicitHydrogen(mol, ch2);
    if (!result.ok) throw new Error(result.reason);
    const next = result.molecule;
    expect(result.hydrogenId).toBe(`a${mol.nextId}`);
    expect(result.bondId).toBe(`b${mol.nextId + 1}`);
    expect(next.atoms[result.hydrogenId]).toMatchObject({ element: "H", charge: 0 });
    expect(bondBetween(next, ch2, result.hydrogenId)?.id).toBe(result.bondId);
    expect(implicitHydrogenCount(next, ch2)).toBe(1);
    expect(implicitHydrogenCount(next, result.hydrogenId)).toBe(0);
    // One total: the formula is unchanged, one H now drawn instead of implied.
    expect(elementCounts(next)).toEqual(elementCounts(mol));
    const implied = (m: Molecule) => m.atomIds.reduce((n, id) => n + implicitHydrogenCount(m, id), 0);
    expect(implied(next)).toBe(implied(mol) - 1);
    // The pure op left its input alone.
    expect(mol.atomIds).toHaveLength(3);
  });

  it("places the hydrogen at the drawing's own bond length, in the widest gap", () => {
    const { mol, o } = ethanol();
    const result = promoteImplicitHydrogen(mol, o);
    if (!result.ok) throw new Error(result.reason);
    const h = result.molecule.atoms[result.hydrogenId]!.pos;
    const at = mol.atoms[o]!.pos;
    expect(Math.sqrt((h.x - at.x) ** 2 + (h.y - at.y) ** 2)).toBeCloseTo(medianBondLength(mol)!, 9);
  });

  it("does not make a CH2 a stereocentre by drawing one of its hydrogens", () => {
    const { mol, ch2 } = ethanol();
    const result = promoteImplicitHydrogen(mol, ch2);
    if (!result.ok) throw new Error(result.reason);
    expect(stereocenterAtoms(result.molecule)).toEqual([]);
  });

  it("decrements a pinned hydrogen count rather than unpinning it", () => {
    let n = "";
    const mol = buildMolecule((b) => {
      n = b.atom("N", { x: 0, y: 0 }, { explicitHydrogenCount: 1 });
      b.bond(n, b.atom("C", { x: 1, y: 0 }));
    });
    const result = promoteImplicitHydrogen(mol, n);
    if (!result.ok) throw new Error(result.reason);
    expect(result.molecule.atoms[n]!.explicitHydrogenCount).toBe(0);
    expect(implicitHydrogenCount(result.molecule, n)).toBe(0);
  });

  it("keeps (R)-glyceraldehyde (R)", () => {
    const mol = load("r-glyceraldehyde.mol");
    expect(cipDescriptor(mol, "a3")?.kind).toBe("R");
    const result = promoteImplicitHydrogen(mol, "a3");
    if (!result.ok) throw new Error(result.reason);
    expect(cipDescriptor(result.molecule, "a3")?.kind).toBe("R");
  });

  it("moves off the widest gap where a hydrogen there would state the enantiomer or nothing", () => {
    // Butan-2-ol drawn with its OH wedged straight up and its widest gap
    // straight down, where a sprout would put the hydrogen.
    let c2 = "";
    const polar = (deg: number) => ({ x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) });
    const mol = buildMolecule((b) => {
      c2 = b.atom("C", { x: 0, y: 0 });
      b.bond(c2, b.atom("O", polar(90)), 1, "wedge");
      b.bond(c2, b.atom("C", polar(200)));
      const c3 = b.atom("C", polar(340));
      b.bond(c2, c3);
      b.bond(c3, b.atom("C", { x: 1.9, y: -0.7 }));
    });
    const before = cipDescriptor(mol, c2)?.kind;
    expect(before === "R" || before === "S").toBe(true);

    const result = promoteImplicitHydrogen(mol, c2);
    if (!result.ok) throw new Error(result.reason);
    expect(cipDescriptor(result.molecule, c2)?.kind).toBe(before);
    expect(result.molecule.bonds[result.bondId]!.from).toBe(c2);

    // Measured: in the widest gap, a plain hydrogen reads as the enantiomer
    // and a hashed one, opposite the wedge, reads as nothing (decision 42).
    const h = result.molecule.atoms[result.hydrogenId]!.pos;
    expect(Math.abs(h.x) + Math.abs(h.y + 1)).toBeGreaterThan(0.1);
    const widest = setAtomPosition(result.molecule, result.hydrogenId, { x: 0, y: -1 });
    const plain = setBondStereo(widest, result.bondId, "none");
    expect(cipDescriptor(plain, c2)?.kind).toBe(before === "R" ? "S" : "R");
    const hashed = setBondStereo(widest, result.bondId, "hash");
    expect(cipDescriptor(hashed, c2)?.kind).toBe("undetermined");
  });

  it("refuses with a named reason rather than guessing", () => {
    const { mol } = ethanol();
    expect(promoteImplicitHydrogen(mol, "a99")).toEqual({ ok: false, reason: "no-such-atom" });
    expect(promoteImplicitHydrogen(mol, "constructor")).toEqual({ ok: false, reason: "no-such-atom" });
    let quaternary = "";
    const neopentane = buildMolecule((b) => {
      quaternary = b.atom("C", { x: 0, y: 0 });
      for (const [x, y] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) b.bond(quaternary, b.atom("C", { x, y }));
    });
    expect(promoteImplicitHydrogen(neopentane, quaternary)).toEqual({
      ok: false,
      reason: "no-implicit-hydrogen",
    });
  });
});

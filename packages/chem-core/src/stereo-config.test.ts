/**
 * Coordinate-free configuration, asserted on real molecules.
 *
 * Fixtures are copied rather than imported from stereo.test.ts, which the CIP
 * rewrite will change. Wherever stereo.ts can give a letter for the same
 * drawing it is used as an INDEPENDENT oracle: `descriptorFromConfig` must
 * agree with `cipDescriptor`, so a sign error in either reader shows up as a
 * disagreement rather than as two confident wrong answers.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildMolecule, type MoleculeBuilder } from "./builders.js";
import { lonePairCount } from "./lewis.js";
import { addBond, adjacency, requireAtom } from "./molecule.js";
import {
  flipBond,
  mergeAtoms,
  removeBond,
  setAtomPosition,
  setBondOrder,
  setBondStereo,
  setElement,
  setLonePairs,
} from "./ops.js";
import { rings } from "./rings.js";
import { cipDescriptor } from "./stereo.js";
import {
  descriptorFromConfig,
  ligandRefs,
  parityAgainst,
  readConfig,
  resetStereoTopologyComputationCount,
  ringFace,
  stereoConfig,
  stereoTopology,
  stereoTopologyComputationCount,
  type CentreConfig,
  type ConfigRead,
  type DepthConvention,
  type StereoConfig,
} from "./stereo-config.js";
import { PSEUDO_3D_DEPTH } from "./parity.js";
import { flipAtoms, rotateAtoms, verticalMirror } from "./transform.js";
import type { AtomId, Molecule } from "./types.js";
import { DEG, fromPolar, ORIGIN, vec, type Vec2 } from "./vec.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** One step of `length` from `from`, at `degrees` counter-clockwise from +x. */
function step(from: Vec2, degrees: number, length = 1): Vec2 {
  const d = fromPolar(degrees * DEG, length);
  return { x: from.x + d.x, y: from.y + d.y };
}

function centre(config: StereoConfig, atomId: AtomId): CentreConfig {
  const found = config.centres.find((c) => c.atomId === atomId);
  if (found === undefined) throw new Error(`${atomId} is not a centre`);
  return found;
}

function readOk(read: ConfigRead): StereoConfig {
  if (read.kind !== "read") throw new Error(`unavailable: ${read.reason}`);
  return read.config;
}

function parities(config: StereoConfig): Record<AtomId, number | string> {
  const out: Record<AtomId, number | string> = {};
  for (const c of config.centres) {
    out[c.atomId] = c.reading.kind === "specified" ? c.reading.parity : c.reading.reason;
  }
  return out;
}

function relations(config: StereoConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of config.doubleBonds) {
    out[b.bondId] = b.reading.kind === "specified" ? b.reading.relation : b.reading.reason;
  }
  return out;
}

function letter(mol: Molecule, config: StereoConfig, atomId: AtomId): string {
  const d = descriptorFromConfig(mol, centre(config, atomId));
  if (d === undefined) return "none";
  return d.kind === "undetermined" ? d.reason : d.kind;
}

function cipLetter(mol: Molecule, atomId: AtomId): string {
  const d = cipDescriptor(mol, atomId);
  if (d === undefined) return "none";
  return d.kind === "undetermined" ? d.reason : d.kind;
}

/** Mirror every POSITION across the y axis and leave every mark as drawn. */
function mirrorPositionsOnly(mol: Molecule): Molecule {
  let out = mol;
  for (const id of mol.atomIds) {
    const p = requireAtom(mol, id).pos;
    out = setAtomPosition(out, id, { x: -p.x, y: p.y });
  }
  return out;
}

function invert(values: Record<AtomId, number | string>): Record<AtomId, number | string> {
  const out: Record<AtomId, number | string> = {};
  for (const [k, v] of Object.entries(values)) out[k] = typeof v === "number" ? -v : v;
  return out;
}

/** A Kekule p-tolyl ring hung off `anchor`, ipso at `ipsoPos`, pointing along `degrees`. */
function tolyl(b: MoleculeBuilder, anchor: AtomId, ipsoPos: Vec2, degrees: number): void {
  const centreOfRing = step(ipsoPos, degrees);
  const ringIds: AtomId[] = [];
  for (let k = 0; k < 6; k++) {
    ringIds.push(b.atom("C", step(centreOfRing, degrees + 180 + 60 * k)));
  }
  for (let k = 0; k < 6; k++) b.bond(ringIds[k]!, ringIds[(k + 1) % 6]!, k % 2 === 0 ? 2 : 1);
  b.bond(anchor, ringIds[0]!);
  b.bond(ringIds[3]!, b.atom("C", step(centreOfRing, degrees, 2)));
}

/**
 * A molecule from one letter per atom and a bond list `[i, j, order?]`, for
 * topology-only assertions. Atom k gets id a(k+1); positions are scattered and
 * mean nothing.
 */
function graph(elements: string, bonds: readonly (readonly number[])[]): Molecule {
  return buildMolecule((b) => {
    const ids = [...elements].map((element, k) => b.atom(element, vec(Math.cos(k) * (k + 1), Math.sin(k) * (k + 1))));
    for (const [i, j, order] of bonds) b.bond(ids[i!]!, ids[j!]!, (order ?? 1) as 1 | 2 | 3);
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * (R)-bromochlorofluoromethane as the textbook picture: Br north on a wedge,
 * Cl lower right, F lower left. Canonical order Br(a2), Cl(a4), F(a6), H is
 * also the priority order, so its parity IS the letter's sign: −1 for R.
 */
function bromochlorofluoromethaneR() {
  return buildMolecule((b) => {
    const carbon = b.atom("C", ORIGIN);
    b.bond(carbon, b.atom("Br", step(ORIGIN, 90)), 1, "wedge");
    b.bond(carbon, b.atom("Cl", step(ORIGIN, -30)), 1);
    b.bond(carbon, b.atom("F", step(ORIGIN, 210)), 1);
  });
}

/**
 * 2-methylcyclohexan-1-ol: OH on a wedge at a1, methyl at a2 as given. Two
 * wedges on adjacent ring atoms put both groups on one face, so "wedge" is
 * the cis diastereomer and "hash" the trans one.
 */
function methylcyclohexanol(methyl: "wedge" | "hash") {
  return buildMolecule((b) => {
    const ring: string[] = [];
    for (let i = 0; i < 6; i++) ring.push(b.atom("C", fromPolar(i * 60 * DEG, 1)));
    for (let i = 0; i < 6; i++) b.bond(ring[i]!, ring[(i + 1) % 6]!, 1);
    b.bond(ring[0]!, b.atom("O", fromPolar(0, 2)), 1, "wedge");
    b.bond(ring[1]!, b.atom("C", fromPolar(60 * DEG, 2)), 1, methyl);
  });
}

function butan2olWedged() {
  return buildMolecule((b) => {
    const c1 = b.atom("C", ORIGIN);
    const c2Pos = step(ORIGIN, 30);
    const c2 = b.atom("C", c2Pos);
    const c3Pos = step(c2Pos, -30);
    const c3 = b.atom("C", c3Pos);
    const c4 = b.atom("C", step(c3Pos, 30));
    b.bond(c1, c2, 1);
    b.bond(c2, b.atom("O", step(c2Pos, 90)), 1, "wedge");
    b.bond(c2, c3, 1);
    b.bond(c3, c4, 1);
  });
}

function glyceraldehydeWedged() {
  return buildMolecule((b) => {
    const c2 = b.atom("C", ORIGIN);
    const c1 = b.atom("C", step(ORIGIN, 150));
    b.bond(c1, b.atom("O", step(step(ORIGIN, 150), 90)), 2);
    const c3 = b.atom("C", step(ORIGIN, -30));
    b.bond(c3, b.atom("O", step(step(ORIGIN, -30), -90)), 1);
    b.bond(c2, c1, 1);
    b.bond(c2, c3, 1);
    b.bond(c2, b.atom("O", step(ORIGIN, 90)), 1, "wedge");
  });
}

function but2ene(geometry: "cis" | "trans") {
  return buildMolecule((b) => {
    const c2 = b.atom("C", ORIGIN);
    const c3 = b.atom("C", { x: 1, y: 0 });
    b.bond(c2, c3, 2);
    b.bond(c2, b.atom("C", step(ORIGIN, 120)), 1);
    b.bond(c3, b.atom("C", step({ x: 1, y: 0 }, geometry === "cis" ? 60 : -60)), 1);
  });
}

/**
 * D-glyceraldehyde as a bare Fischer cross: CHO up, CH2OH down, OH right, the
 * implicit H left, and not one wedge. The aldehyde's C=O is drawn at an angle,
 * which must not matter: only bonds at a stereocentre are held to the axes.
 * Centre a1; neighbours a2 (CHO), a5 (CH2OH), a10 (OH).
 */
function fischerGlyceraldehyde() {
  return buildMolecule((b) => {
    const c2 = b.atom("C", vec(0, 0));
    const c1 = b.atom("C", vec(0, 1));
    b.bond(c1, b.atom("O", vec(0.8, 1.5)), 2);
    const c3 = b.atom("C", vec(0, -1));
    b.bond(c3, b.atom("O", vec(0, -2)));
    b.bond(c2, c1);
    b.bond(c2, c3);
    b.bond(c2, b.atom("O", vec(1, 0)));
  });
}

/** D-glucose, open chain, as a Fischer projection: OH right, left, right, right. */
function fischerGlucose() {
  const ids: Record<string, AtomId> = {};
  const mol = buildMolecule((b) => {
    ids.C1 = b.atom("C", vec(0, 0));
    b.bond(ids.C1, b.atom("O", vec(0.8, 0.5)), 2);
    let previous = ids.C1;
    const sides: Record<string, number> = { C2: 1, C3: -1, C4: 1, C5: 1 };
    for (let k = 2; k <= 6; k++) {
      const name = `C${k}`;
      const id = b.atom("C", vec(0, 1 - k));
      ids[name] = id;
      b.bond(previous, id);
      const side = sides[name];
      if (side !== undefined) b.bond(id, b.atom("O", vec(side, 1 - k)));
      previous = id;
    }
    b.bond(ids.C6!, b.atom("O", vec(0.8, -5.5)));
  });
  return { mol, ids };
}

/**
 * beta-D-glucopyranose, the same atom ids drawn two ways. Ring: C1 right, C2
 * front right, C3 front left, C4 left, C5 back left, O5 back right.
 *
 *   "haworth"  the ring flattened in perspective, substituents vertical
 *   "wedge"    the same ring seen from above, substituents radial on wedges
 *              (up) and hashes (down)
 *
 * Up: C1-OH, C3-OH, C5-C6. Down: C2-OH, C4-OH. Wedge CIP, cross-checked
 * against RDKit: C1 R, C2 R, C3 S, C4 S, C5 R.
 */
function betaGlucopyranose(mode: "haworth" | "wedge") {
  const ringPos: Record<string, [number, number]> = {
    C1: [1.2, 0],
    C2: [0.5, -0.5],
    C3: [-0.5, -0.5],
    C4: [-1.2, 0],
    C5: [-0.5, 0.5],
    O5: [0.5, 0.5],
  };
  const up: Record<string, boolean> = { C1: true, C2: false, C3: true, C4: false, C5: true };
  const ring = ["C1", "C2", "C3", "C4", "C5", "O5"];
  const ids: Record<string, AtomId> = {};
  const mol = buildMolecule((b) => {
    for (const k of ring) ids[k] = b.atom(k[0]!, vec(...ringPos[k]!));
    for (let i = 0; i < 6; i++) b.bond(ids[ring[i]!]!, ids[ring[(i + 1) % 6]!]!);
    for (const k of ["C1", "C2", "C3", "C4", "C5"]) {
      const [x, y] = ringPos[k]!;
      const dir = up[k] ? 1 : -1;
      let pos: Vec2;
      if (mode === "haworth") {
        pos = vec(x, y + 0.8 * dir);
      } else {
        const len = Math.hypot(x, y);
        pos = vec(x + (0.8 * x) / len, y + (0.8 * y) / len);
      }
      const sub = b.atom(k === "C5" ? "C" : "O", pos);
      ids[`${k}sub`] = sub;
      b.bond(ids[k]!, sub, 1, mode === "wedge" ? (up[k] ? "wedge" : "hash") : "none");
      if (k === "C5") b.bond(sub, b.atom("O", vec(pos.x - 0.6, pos.y + 0.5)));
    }
  });
  return { mol, ids, ringIds: ring.map((k) => ids[k]!) };
}

// ---------------------------------------------------------------------------
// Canonical order and the parity function
// ---------------------------------------------------------------------------

describe("canonical ligand order", () => {
  it("lists explicit neighbours by numeric id, then H, then the lone pair", () => {
    // P(H)(Me)(Et), decision 15's own example: Me, Et, H, LP. The ids are made
    // to straddle a9/a10 so a plain string sort would put Et first.
    const mol = buildMolecule((b) => {
      for (let k = 0; k < 7; k++) b.atom("He", vec(10 + k, 10)); // a1..a7, padding
      const p = b.atom("P", ORIGIN); // a8
      const me = b.atom("C", step(ORIGIN, 210)); // a9
      const et = b.atom("C", step(ORIGIN, 90)); // a10
      b.bond(p, et);
      b.bond(p, me, 1, "wedge");
      b.bond(et, b.atom("C", step(step(ORIGIN, 90), 30)));
    });
    const [p] = stereoTopology(mol).centres;
    expect(p).toEqual({ atomId: "a8", order: ["a9", "a10"], implicitHydrogen: true, lonePair: true });
    expect(ligandRefs(p!)).toEqual([
      { kind: "atom", atomId: "a9" },
      { kind: "atom", atomId: "a10" },
      { kind: "implicitHydrogen" },
      { kind: "lonePair" },
    ]);
    // Two implicit ligands land on one point under a wedge reading: refused,
    // never a zero volume read as a sign.
    expect(centre(stereoConfig(mol), "a8").reading).toEqual({
      kind: "undetermined",
      reason: "ambiguous-geometry",
    });
  });

  it("pins the sign: (R)-bromochlorofluoromethane has parity −1 in priority order", () => {
    const mol = bromochlorofluoromethaneR();
    const c = centre(stereoConfig(mol), "a1");
    expect(c.order).toEqual(["a2", "a4", "a6"]);
    expect(c.reading).toEqual({ kind: "specified", parity: -1 });
    expect(letter(mol, stereoConfig(mol), "a1")).toBe("R");
    expect(PSEUDO_3D_DEPTH).not.toBe(0);
  });

  it("restates a parity against any permutation by its sign", () => {
    const c = centre(stereoConfig(bromochlorofluoromethaneR()), "a1");
    const a = (atomId: AtomId) => ({ kind: "atom" as const, atomId });
    const h = { kind: "implicitHydrogen" as const };
    expect(parityAgainst(c, [a("a2"), a("a4"), a("a6"), h])).toBe(-1);
    expect(parityAgainst(c, [a("a4"), a("a2"), a("a6"), h])).toBe(1); // one swap
    expect(parityAgainst(c, [a("a4"), a("a6"), a("a2"), h])).toBe(-1); // 3-cycle
    expect(parityAgainst(c, [a("a2"), a("a4"), a("a6"), a("a6")])).toBeUndefined();
    expect(parityAgainst(c, [a("a2"), a("a4"), h])).toBeUndefined();
  });

  it("does not depend on the order bonds were added (bondsAt vs neighbours)", () => {
    // The same centre with its bonds created in two different orders, so
    // `bondsAt` lists them differently while every atom keeps its id.
    function build(bondOrder: readonly number[]) {
      return buildMolecule((b) => {
        const c = b.atom("C", ORIGIN);
        const subs = [
          b.atom("F", step(ORIGIN, 90)),
          b.atom("Cl", step(ORIGIN, -30)),
          b.atom("Br", step(ORIGIN, 210)),
          b.atom("I", step(ORIGIN, 150)),
        ];
        for (const k of bondOrder) b.bond(c, subs[k]!, 1, k === 0 ? "wedge" : "none");
      });
    }
    const one = build([0, 1, 2, 3]);
    const two = build([3, 1, 0, 2]);
    expect(adjacency(one).neighbors.a1).not.toEqual(adjacency(two).neighbors.a1);
    expect(centre(stereoConfig(two), "a1")).toEqual(centre(stereoConfig(one), "a1"));
  });
});

// ---------------------------------------------------------------------------
// Mirrors
// ---------------------------------------------------------------------------

describe("mirrors", () => {
  const fixtures: [string, () => Molecule][] = [
    ["bromochlorofluoromethane", bromochlorofluoromethaneR],
    ["cis-2-methylcyclohexanol", () => methylcyclohexanol("wedge")],
    ["trans-2-methylcyclohexanol", () => methylcyclohexanol("hash")],
    ["butan-2-ol", butan2olWedged],
    ["cis-2-butene", () => but2ene("cis")],
    ["trans-2-butene", () => but2ene("trans")],
    ["beta-D-glucopyranose", () => betaGlucopyranose("wedge").mol],
  ];

  it.each(fixtures)("flipAtoms preserves every parity and cis/trans: %s", (_, make) => {
    const mol = make();
    const flipped = flipAtoms(mol, mol.atomIds, verticalMirror(vec(0.3, 0)));
    expect(parities(stereoConfig(flipped))).toEqual(parities(stereoConfig(mol)));
    expect(relations(stereoConfig(flipped))).toEqual(relations(stereoConfig(mol)));
  });

  it.each(fixtures)("a positions-only mirror inverts every parity, keeps cis/trans: %s", (_, make) => {
    const mol = make();
    const mirrored = mirrorPositionsOnly(mol);
    expect(parities(stereoConfig(mirrored))).toEqual(invert(parities(stereoConfig(mol))));
    expect(relations(stereoConfig(mirrored))).toEqual(relations(stereoConfig(mol)));
  });

  it("actually has something to invert in each fixture", () => {
    expect(Object.values(parities(stereoConfig(methylcyclohexanol("wedge"))))).toEqual([1, -1]);
    expect(relations(stereoConfig(but2ene("cis")))).toEqual({ b3: "cis" });
    expect(relations(stereoConfig(but2ene("trans")))).toEqual({ b3: "trans" });
  });
});

// ---------------------------------------------------------------------------
// The shared lift: fans and the ambiguity guard (decisions 28 and 29)
// ---------------------------------------------------------------------------

describe("fan drawings and the ambiguity guard", () => {
  /** C at the origin with Br, Cl, F (and I) at the given angles and marks. */
  function halomethane(
    angles: readonly number[],
    marks: readonly ("wedge" | "hash" | "none")[],
    length = 1,
  ) {
    return buildMolecule((b) => {
      const c = b.atom("C", ORIGIN);
      angles.forEach((degrees, i) => {
        b.bond(c, b.atom(["Br", "Cl", "F", "I"][i]!, step(ORIGIN, degrees, length)), 1, marks[i] ?? "none");
      });
    });
  }

  // Letters from RDKit 2025.03 get_stereo_tags on each drawing's molblock,
  // written with hydrogenAssertion "valence".
  const fans: [string, readonly number[], readonly ("wedge" | "hash" | "none")[], "R" | "S"][] = [
    ["Br 0° wedge, Cl +75°, F −75°", [0, 75, -75], ["wedge"], "R"],
    ["Br 0°, Cl +75° wedge, F −75°", [0, 75, -75], ["none", "wedge"], "S"],
    ["hexagon bridgehead, middle bond wedged", [0, 60, 120], ["none", "wedge"], "R"],
    ["hexagon bridgehead, end bond wedged", [0, 60, 120], ["wedge"], "S"],
    ["Br −80°, Cl 0° wedge, F +80°", [-80, 0, 80], ["none", "wedge"], "R"],
    ["Br −80°, Cl 0° hash, F +80°", [-80, 0, 80], ["none", "hash"], "S"],
    ["a tight fan, 0° 30° 60°", [0, 30, 60], ["none", "none", "wedge"], "S"],
  ];

  it.each(fans)("puts the H opposite the fan, and both readers agree with RDKit: %s", (_, angles, marks, expected) => {
    for (const length of [1, 1.5]) {
      const mol = halomethane(angles, marks, length);
      expect(letter(mol, stereoConfig(mol), "a1")).toBe(expected);
      expect(cipLetter(mol, "a1")).toBe(expected);
    }
  });

  it("refuses the X drawing at 44.5°, 45° and 45.5° in both readers", () => {
    for (const nudge of [-0.5, 0, 0.5]) {
      const mol = halomethane([135, 315, 225, 45 + nudge], ["wedge", "hash"]);
      expect(letter(mol, stereoConfig(mol), "a1")).toBe("ambiguous-geometry");
      expect(cipLetter(mol, "a1")).toBe("ambiguous-geometry");
    }
  });

  it("refuses a wedge and a hash on opposite bonds at any angle, but not under pseudo3d (decision 42)", () => {
    // RDKit 2025.03 refuses these drawings ('?') at 30° and 60° too.
    for (const fourth of [20, 30, 60, 80]) {
      const mol = halomethane([135, 315, 225, fourth], ["wedge", "hash"]);
      expect(letter(mol, stereoConfig(mol), "a1")).toBe("ambiguous-geometry");
      expect(cipLetter(mol, "a1")).toBe("ambiguous-geometry");
      // The same geometry as a genuine projection: a toward ligand opposite
      // an away ligand is what a tetrahedron seen along a general axis looks
      // like, so the pseudo-3D reader still states a configuration.
      const bare = halomethane([135, 315, 225, fourth], []);
      const read = readOk(readConfig({ mol: bare }, { kind: "pseudo3d", depth: { a2: 1, a3: -1 } }));
      expect(centre(read, "a1").reading.kind).toBe("specified");
    }
    // Wedge and hash on ADJACENT bonds is the ordinary drawing and keeps its letter.
    const adjacent = halomethane([135, 225, 315, 45], ["wedge", "hash"]);
    expect(letter(adjacent, stereoConfig(adjacent), "a1")).toMatch(/^[RS]$/);
    expect(cipLetter(adjacent, "a1")).toBe(letter(adjacent, stereoConfig(adjacent), "a1"));
  });

  it("refuses a drawing whose letter depends on how long its bonds are", () => {
    // Raw vectors and unit directions give opposite signs. Before decision 29
    // stereo-config read R and stereo.ts read S on this very drawing.
    const mol = buildMolecule((b) => {
      const c = b.atom("C", ORIGIN);
      b.bond(c, b.atom("Br", vec(0.024, -1.095)));
      b.bond(c, b.atom("Cl", vec(-0.629, 0.267)));
      b.bond(c, b.atom("F", vec(0.749, -1.62)), 1, "wedge");
      b.bond(c, b.atom("I", vec(-0.803, -0.184)), 1, "hash");
    });
    expect(letter(mol, stereoConfig(mol), "a1")).toBe("ambiguous-geometry");
    expect(cipLetter(mol, "a1")).toBe("ambiguous-geometry");
  });
});

// ---------------------------------------------------------------------------
// Edits that move slots
// ---------------------------------------------------------------------------

describe("parity survives edits that reshuffle slots", () => {
  /** A four-explicit-ligand centre with ids chosen so reorders are ODD. */
  function tetrahalide() {
    return buildMolecule((b) => {
      const c = b.atom("C", ORIGIN); // a1
      b.bond(c, b.atom("F", step(ORIGIN, 90)), 1, "wedge"); // a2, b3
      b.bond(c, b.atom("Cl", step(ORIGIN, -30))); // a4, b5
      b.bond(c, b.atom("Br", step(ORIGIN, 210))); // a6, b7
      const ch2 = b.atom("C", step(ORIGIN, 150)); // a8, b9
      b.bond(c, ch2);
      b.bond(ch2, b.atom("O", step(step(ORIGIN, 150), 90))); // a10, b11
      b.atom("F", step(ORIGIN, 90)); // a12: a loose F lying exactly on a2
    });
  }

  it("survives an unrelated removeBond elsewhere (the centre's own slots stay put)", () => {
    // This compacts a8's incident list, not a1's, so it only proves that an
    // edit elsewhere changes nothing. The slot-order trap itself is caught by
    // the remove-and-re-add and mergeAtoms tests below, where a1's slots move.
    const mol = tetrahalide();
    const edited = removeBond(mol, "b11");
    expect(adjacency(edited).bondsAt.a8).toEqual(["b9"]);
    expect(centre(stereoConfig(edited), "a1")).toEqual(centre(stereoConfig(mol), "a1"));
  });

  it("survives removing and re-adding the wedge, which moves its bond to the last slot", () => {
    const mol = tetrahalide();
    const removed = removeBond(mol, "b3");
    const { molecule: readded } = addBond(removed, { from: "a1", to: "a2", stereo: "wedge" });
    // The bond slots went from F,Cl,Br,C to Cl,Br,C,F: a 4-cycle, odd. A reader
    // that remembered "slot 0" would now report the enantiomer.
    expect(adjacency(mol).neighbors.a1).toEqual(["a2", "a4", "a6", "a8"]);
    expect(adjacency(readded).neighbors.a1).toEqual(["a4", "a6", "a8", "a2"]);
    expect(centre(stereoConfig(readded), "a1")).toEqual(centre(stereoConfig(mol), "a1"));
  });

  it("survives a mergeAtoms whose survivor keeps the old bond slot under a new id", () => {
    const mol = tetrahalide();
    const before = centre(stereoConfig(mol), "a1");
    const merged = mergeAtoms(mol, "a12", "a2");
    if (!merged.ok) throw new Error(merged.message);
    const after = centre(stereoConfig(merged.molecule), "a1");

    // The rewired bond b3 kept slot 0, but its far atom is now a12, which sorts
    // LAST. Moving one ligand from first to last is an odd permutation.
    expect(adjacency(merged.molecule).neighbors.a1).toEqual(["a12", "a4", "a6", "a8"]);
    expect(after.order).toEqual(["a4", "a6", "a8", "a12"]);
    expect(after.reading).toEqual({
      kind: "specified",
      parity: before.reading.kind === "specified" ? -before.reading.parity : 0,
    });
    const mappedOldOrder = [
      { kind: "atom" as const, atomId: "a12" },
      { kind: "atom" as const, atomId: "a4" },
      { kind: "atom" as const, atomId: "a6" },
      { kind: "atom" as const, atomId: "a8" },
    ];
    expect(parityAgainst(after, mappedOldOrder)).toBe(
      before.reading.kind === "specified" ? before.reading.parity : 0,
    );
    expect(letter(merged.molecule, stereoConfig(merged.molecule), "a1")).toBe(
      letter(mol, stereoConfig(mol), "a1"),
    );
    expect(letter(mol, stereoConfig(mol), "a1")).toBe(cipLetter(mol, "a1"));
  });

  it("reads a wedge from its narrow end only, so flipBond moves the claim", () => {
    const mol = bromochlorofluoromethaneR();
    const flipped = flipBond(mol, "b3");
    expect(centre(stereoConfig(flipped), "a1").reading).toEqual({
      kind: "undetermined",
      reason: "no-stereo-bond",
    });
    expect(stereoConfig(flipped).centres.map((c) => c.atomId)).toEqual(["a1"]);
  });
});

// ---------------------------------------------------------------------------
// Fischer
// ---------------------------------------------------------------------------

describe("fischer convention", () => {
  const FISCHER: DepthConvention = { kind: "fischer" };

  it("reads a bare D-glyceraldehyde cross as R, and a wedge reader sees nothing", () => {
    const mol = fischerGlyceraldehyde();
    const config = readOk(readConfig({ mol }, FISCHER));
    expect(config.centres.map((c) => c.atomId)).toEqual(["a1"]);
    expect(letter(mol, config, "a1")).toBe("R");

    const wedge = stereoConfig(mol);
    expect(centre(wedge, "a1").reading).toEqual({ kind: "undetermined", reason: "no-stereo-bond" });
    expect(cipLetter(mol, "a1")).toBe("no-stereo-bond");
  });

  it("gives the enantiomer to a reader that lifts the verticals toward the viewer", () => {
    const mol = fischerGlyceraldehyde();
    const fischer = readOk(readConfig({ mol }, FISCHER));
    // CHO (a2) and CH2OH (a5) toward, OH (a10) away: the classic mistake.
    const wrong = readOk(
      readConfig({ mol }, { kind: "pseudo3d", depth: { a2: 1, a5: 1, a10: -1 } }),
    );
    expect(parities(wrong)).toEqual(invert(parities(fischer)));
    expect(letter(mol, wrong, "a1")).toBe("S");
  });

  it("reads D-glucose as 2R,3S,4R,5R; 90 degrees inverts all, 180 none, 45 refuses", () => {
    const { mol, ids } = fischerGlucose();
    const names = ["C2", "C3", "C4", "C5"];
    const letters = (m: Molecule, read: ConfigRead) => {
      const config = readOk(read);
      return names.map((n) => letter(m, config, ids[n]!));
    };
    expect(letters(mol, readConfig({ mol }, FISCHER))).toEqual(["R", "S", "R", "R"]);

    const pivot = vec(0, -2.5);
    for (const [degrees, expected] of [
      [90, ["S", "R", "S", "S"]],
      [180, ["R", "S", "R", "R"]],
      [270, ["S", "R", "S", "S"]],
      [-90, ["S", "R", "S", "S"]],
    ] as const) {
      const rotated = rotateAtoms(mol, mol.atomIds, pivot, degrees * DEG);
      expect(letters(rotated, readConfig({ mol: rotated }, FISCHER))).toEqual(expected);
    }

    const tilted = rotateAtoms(mol, mol.atomIds, pivot, 45 * DEG);
    const refused = readConfig({ mol: tilted }, FISCHER);
    expect(refused).toEqual({
      kind: "unavailable",
      reason: "off-axis",
      atomIds: names.map((n) => ids[n]!),
    });
    // Nearly on-axis is still off-axis: no rounding to the nearest axis.
    const nudged = rotateAtoms(mol, mol.atomIds, pivot, 0.5 * DEG);
    expect(readConfig({ mol: nudged }, FISCHER).kind).toBe("unavailable");
  });

  it("does not read double bonds, which a Fischer cannot state", () => {
    const mol = but2ene("cis");
    expect(relations(readOk(readConfig({ mol }, FISCHER)))).toEqual({ b3: "not-covered" });
  });
});

// ---------------------------------------------------------------------------
// Haworth and pseudo-3D
// ---------------------------------------------------------------------------

describe("haworth convention", () => {
  it("reads beta-D-glucopyranose with the same parities as its wedge drawing", () => {
    const haworth = betaGlucopyranose("haworth");
    const wedge = betaGlucopyranose("wedge");
    const names = ["C1", "C2", "C3", "C4", "C5"];

    const hRead = readOk(
      readConfig({ mol: haworth.mol }, { kind: "haworth", ringAtomIds: haworth.ringIds }),
    );
    const wRead = stereoConfig(wedge.mol);
    expect(parities(hRead)).toEqual(parities(wRead));

    // Letters from the Haworth reading against stereo.ts on the wedge drawing,
    // which never sees the Haworth at all.
    const fromHaworth = names.map((n) => letter(haworth.mol, hRead, haworth.ids[n]!));
    const fromCip = names.map((n) => cipLetter(wedge.mol, wedge.ids[n]!));
    expect(fromCip).toEqual(["R", "R", "S", "S", "R"]);
    expect(fromHaworth).toEqual(fromCip);

    // A wedge reader on the Haworth sees no marks.
    expect(Object.values(parities(stereoConfig(haworth.mol)))).toEqual(
      names.map(() => "no-stereo-bond"),
    );
  });

  it("refuses radial substituents and a ring that is not a ring", () => {
    const wedge = betaGlucopyranose("wedge");
    const radial = readConfig({ mol: wedge.mol }, { kind: "haworth", ringAtomIds: wedge.ringIds });
    expect(radial.kind === "unavailable" && radial.reason).toBe("non-vertical-substituent");

    const haworth = betaGlucopyranose("haworth");
    const notRing = readConfig(
      { mol: haworth.mol },
      { kind: "haworth", ringAtomIds: haworth.ringIds.slice(0, 5) },
    );
    expect(notRing.kind === "unavailable" && notRing.reason).toBe("not-a-ring");
  });
});

describe("pseudo3d convention", () => {
  it("agrees with the wedge reading when the depths say the same thing", () => {
    const mol = bromochlorofluoromethaneR();
    const read = readOk(readConfig({ mol }, { kind: "pseudo3d", depth: { a2: 5 } }));
    expect(parities(read)).toEqual(parities(stereoConfig(mol)));
  });

  it("reports a depthless lift as coplanar and a flat volume as ambiguous, never a sign", () => {
    const mol = bromochlorofluoromethaneR();
    const flat = readOk(readConfig({ mol }, { kind: "pseudo3d", depth: {} }));
    expect(centre(flat, "a1").reading).toEqual({ kind: "undetermined", reason: "coplanar" });

    // Four explicit ligands all drawn on one line, with a wedge: zero volume,
    // under parity.ts's floor, so ambiguous-geometry (decision 29).
    const collinear = buildMolecule((b) => {
      const c = b.atom("C", ORIGIN);
      b.bond(c, b.atom("F", vec(1, 0)), 1, "wedge");
      b.bond(c, b.atom("Cl", vec(-1, 0)));
      b.bond(c, b.atom("Br", vec(2, 0)));
      b.bond(c, b.atom("I", vec(-2, 0)));
    });
    expect(centre(stereoConfig(collinear), "a1").reading).toEqual({
      kind: "undetermined",
      reason: "ambiguous-geometry",
    });
  });

  it("reads each neighbour's depth relative to the centre's own depth", () => {
    const mol = bromochlorofluoromethaneR();
    const wedge = parities(stereoConfig(mol));
    // Everything lifted by 5: only the Br differs from the centre, upward.
    const offset = readOk(
      readConfig({ mol }, { kind: "pseudo3d", depth: { a1: 5, a2: 6, a4: 5, a6: 5 } }),
    );
    expect(parities(offset)).toEqual(wedge);
    // The Br one below the centre is behind it: the enantiomer. A reader that
    // took depths as absolute would see every ligand in front and read the
    // original parity.
    const below = readOk(
      readConfig({ mol }, { kind: "pseudo3d", depth: { a1: 5, a2: 4, a4: 5, a6: 5 } }),
    );
    expect(parities(below)).toEqual(invert(wedge));
  });

  it("reads through a positions override without touching the molecule", () => {
    const mol = bromochlorofluoromethaneR();
    const positions: Record<AtomId, Vec2> = {};
    for (const id of mol.atomIds) {
      const p = requireAtom(mol, id).pos;
      positions[id] = { x: -p.x, y: p.y };
    }
    const read = readOk(readConfig({ mol, positions }, { kind: "wedgeHash" }));
    expect(parities(read)).toEqual(invert(parities(stereoConfig(mol))));
  });
});

// ---------------------------------------------------------------------------
// Which atoms are centres
// ---------------------------------------------------------------------------

describe("phantom lone-pair centres", () => {
  /** Methyl p-tolyl sulfoxide: S=O up, CH3 lower left on a wedge, tolyl right. */
  function methylTolylSulfoxide(second: "tolyl" | "methyl") {
    return buildMolecule((b) => {
      const s = b.atom("S", ORIGIN); // a1
      b.bond(s, b.atom("O", step(ORIGIN, 90)), 2);
      b.bond(s, b.atom("C", step(ORIGIN, 210)), 1, "wedge");
      if (second === "tolyl") tolyl(b, s, step(ORIGIN, 0), 0);
      else b.bond(s, b.atom("C", step(ORIGIN, -30)));
    });
  }

  it("derives a sulfoxide parity through the lone pair, and not for DMSO", () => {
    const mol = methylTolylSulfoxide("tolyl");
    const config = stereoConfig(mol);
    const s = centre(config, "a1");
    expect(s.lonePair).toBe(true);
    expect(s.implicitHydrogen).toBe(false);
    expect(s.reading.kind).toBe("specified");
    // O (top) → aryl (right) → CH3 (lower left) is clockwise with the lone
    // pair behind the page: R, which RDKit's new CIP labeller also gives.
    expect(letter(mol, config, "a1")).toBe("R");
    // Flipping the drawing is the same enantiomer; mirroring positions is not.
    const flipped = flipAtoms(mol, mol.atomIds, verticalMirror(ORIGIN));
    expect(letter(flipped, stereoConfig(flipped), "a1")).toBe("R");
    const mirrored = mirrorPositionsOnly(mol);
    expect(letter(mirrored, stereoConfig(mirrored), "a1")).toBe("S");

    const dmso = methylTolylSulfoxide("methyl");
    expect(stereoTopology(dmso).centres).toEqual([]);
  });

  it("gives a sulfinate one letter whether drawn S=O or S+–O− (decision 47)", () => {
    // Methyl methanesulfinate CS(=O)OC: Me north on a wedge, O lower left,
    // OMe lower right. A multiple bond at the stereogenic atom is not
    // duplicated (IUPAC 2013 P-93.2.4 and the P-93.3.4.1 sulfinate figure,
    // cited in cip.ts), so OMe ranks above =O in both drawings, and both read
    // R, as RDKit get_stereo_tags gives for both.
    function sulfinate(ester: boolean, chargeSeparated: boolean) {
      return buildMolecule((b) => {
        const s = b.atom("S", ORIGIN, chargeSeparated ? { charge: 1 } : {}); // a1
        b.bond(s, b.atom("C", step(ORIGIN, 90)), 1, "wedge");
        const oxo = b.atom("O", step(ORIGIN, 210), chargeSeparated ? { charge: -1 } : {});
        b.bond(s, oxo, chargeSeparated ? 1 : 2);
        const o = b.atom("O", step(ORIGIN, -30), ester ? {} : { charge: -1 });
        b.bond(s, o);
        if (ester) b.bond(o, b.atom("C", step(step(ORIGIN, -30), 30)));
      });
    }
    const doubled = sulfinate(true, false);
    const doubledConfig = stereoConfig(doubled);
    expect(centre(doubledConfig, "a1").lonePair).toBe(true);
    expect(centre(doubledConfig, "a1").reading).toEqual({ kind: "specified", parity: 1 });
    expect(letter(doubled, doubledConfig, "a1")).toBe("R");
    expect(cipLetter(doubled, "a1")).toBe("R");

    const separated = sulfinate(true, true);
    const separatedConfig = stereoConfig(separated);
    expect(centre(separatedConfig, "a1").reading).toEqual({ kind: "specified", parity: 1 });
    expect(letter(separated, separatedConfig, "a1")).toBe("R");

    // The sulfinate anion's two oxygens are one ligand once S=O is written
    // charge-separated. RDKit lists the atom and gives it no letter either.
    const anion = sulfinate(false, false);
    expect(letter(anion, stereoConfig(anion), "a1")).toBe("ranking-unsupported");

    // Where rule 1 settles the order before any duplicate is compared, the
    // letter stands: methyl p-tolyl sulfoxide is R above.
  });

  it("derives a P(III) parity through the lone pair, and not with two methyls", () => {
    function phosphine(ethyl: boolean) {
      return buildMolecule((b) => {
        const p = b.atom("P", ORIGIN); // a1
        b.bond(p, b.atom("C", step(ORIGIN, 210)), 1, "wedge"); // Me
        const up = b.atom("C", step(ORIGIN, 90));
        b.bond(p, up);
        if (ethyl) b.bond(up, b.atom("C", step(step(ORIGIN, 90), 30)));
        tolyl(b, p, step(ORIGIN, 0), 0);
      });
    }
    const mol = phosphine(true);
    const config = stereoConfig(mol);
    expect(centre(config, "a1").lonePair).toBe(true);
    // aryl (right) → ethyl (top) → methyl (lower left) runs counter-clockwise
    // with the lone pair behind: S.
    expect(letter(mol, config, "a1")).toBe("S");
    expect(stereoTopology(phosphine(false)).centres).toEqual([]);
  });

  it("admits sulfonium S+ and a bridged bridgehead N; excludes amines and carbanions", () => {
    const sulfonium = buildMolecule((b) => {
      const s = b.atom("S", ORIGIN, { charge: 1 });
      b.bond(s, b.atom("C", step(ORIGIN, 90)), 1, "wedge");
      const et = b.atom("C", step(ORIGIN, -30));
      b.bond(s, et);
      b.bond(et, b.atom("C", step(step(ORIGIN, -30), 30)));
      const pr = b.atom("C", step(ORIGIN, 210));
      b.bond(s, pr);
      const pr2 = b.atom("C", step(step(ORIGIN, 210), 150));
      b.bond(pr, pr2);
      b.bond(pr2, b.atom("C", step(step(step(ORIGIN, 210), 150), 210)));
    });
    expect(stereoTopology(sulfonium).centres.map((c) => [c.atomId, c.lonePair])).toEqual([
      ["a1", true],
    ]);

    // 1-azabicyclo[3.2.1]octane: N1 bridges a 3-, a 2- and a 1-atom bridge.
    const bicyclic = buildMolecule((b) => {
      const n1 = b.atom("N", vec(0, 0));
      const c2 = b.atom("C", vec(1, 1));
      const c3 = b.atom("C", vec(2, 1.2));
      const c4 = b.atom("C", vec(3, 1));
      const c5 = b.atom("C", vec(4, 0));
      const c6 = b.atom("C", vec(3, -1));
      const c7 = b.atom("C", vec(1, -1));
      const c8 = b.atom("C", vec(2, 0.2));
      b.bond(n1, c2);
      b.bond(c2, c3);
      b.bond(c3, c4);
      b.bond(c4, c5);
      b.bond(c5, c6);
      b.bond(c6, c7);
      b.bond(c7, n1);
      b.bond(n1, c8);
      b.bond(c8, c5);
    });
    const bridgehead = stereoTopology(bicyclic).centres.find((c) => c.atomId === "a1");
    expect(bridgehead?.lonePair).toBe(true);

    const amine = buildMolecule((b) => {
      const n = b.atom("N", ORIGIN);
      b.bond(n, b.atom("C", step(ORIGIN, 90)), 1, "wedge");
      const et = b.atom("C", step(ORIGIN, -30));
      b.bond(n, et);
      b.bond(et, b.atom("C", step(step(ORIGIN, -30), 30)));
      const pr = b.atom("C", step(ORIGIN, 210));
      b.bond(n, pr);
      const pr2 = b.atom("C", step(step(ORIGIN, 210), 150));
      b.bond(pr, pr2);
      b.bond(pr2, b.atom("C", step(step(step(ORIGIN, 210), 150), 210)));
    });
    expect(stereoTopology(amine).centres).toEqual([]);

    const carbanion = buildMolecule((b) => {
      const c = b.atom("C", ORIGIN, { charge: -1 });
      b.bond(c, b.atom("C", step(ORIGIN, 90)), 1, "wedge");
      b.bond(c, b.atom("O", step(ORIGIN, -30)));
    });
    expect(stereoTopology(carbanion).centres).toEqual([]);
  });

  it("ranks the lone pair below hydrogen: P(H)(Me)(Et) with the H drawn reads R", () => {
    // H north (plain), Me lower left on a wedge, Et lower right. Priorities
    // Et > Me > H > LP, clockwise with the lone pair behind: R. RDKit refuses
    // the protium drawing but gives (R) for the same picture with D, which
    // ranks where H does relative to everything else here. Ranking the lone
    // pair above H would swap the last two ligands and read S.
    function phosphine(isotope: number | undefined) {
      return buildMolecule((b) => {
        const p = b.atom("P", ORIGIN); // a1
        b.bond(p, b.atom("H", step(ORIGIN, 90), { isotope })); // a2
        b.bond(p, b.atom("C", step(ORIGIN, 210)), 1, "wedge"); // a4
        const et = b.atom("C", step(ORIGIN, -30)); // a6
        b.bond(p, et);
        b.bond(et, b.atom("C", step(step(ORIGIN, -30), 30)));
      });
    }
    for (const isotope of [undefined, 2]) {
      const mol = phosphine(isotope);
      const config = stereoConfig(mol);
      const p = centre(config, "a1");
      expect(p.order).toEqual(["a2", "a4", "a6"]);
      expect([p.implicitHydrogen, p.lonePair]).toEqual([false, true]);
      expect(letter(mol, config, "a1")).toBe("R");
    }
  });

  it("reads a quaternary ammonium as a four-ligand centre with no phantom", () => {
    // C[N+](CC)(CCC)CCCC with the methyl on a wedge.
    const mol = buildMolecule((b) => {
      const n = b.atom("N", ORIGIN, { charge: 1 });
      b.bond(n, b.atom("C", step(ORIGIN, 90)), 1, "wedge");
      const chain = (degrees: number, length: number) => {
        let previous = n;
        let pos = ORIGIN;
        for (let k = 0; k < length; k++) {
          pos = step(pos, degrees + (k % 2 === 0 ? 0 : 30));
          const next = b.atom("C", pos);
          b.bond(previous, next);
          previous = next;
        }
      };
      chain(-30, 2);
      chain(210, 3);
      chain(150, 4);
    });
    expect(lonePairCount(mol, "a1")).toEqual({ kind: "counted", pairs: 0, unpaired: 0 });
    const config = stereoConfig(mol);
    const n = centre(config, "a1");
    expect(n.lonePair).toBe(false);
    expect(n.order).toHaveLength(4);
    expect(n.reading.kind).toBe("specified");
    const expected = cipLetter(mol, "a1");
    expect(["R", "S"]).toContain(expected);
    expect(letter(mol, config, "a1")).toBe(expected);
  });

  it("admits nitrogen exactly where RDKit does (decision 30)", () => {
    // Each case was cross-checked against RDKit 2025.03 get_stereo_tags on the
    // same constitution. Positions are irrelevant to topology, so `graph`
    // scatters the atoms. Index k is atom id a(k+1).
    const nitrogenCentre = (mol: Molecule, index: number) =>
      stereoTopology(mol).centres.find((c) => c.atomId === `a${index + 1}`);

    // Bridged: 1-azabicyclo[3.2.1]octane, N0; its rings share C7's two bonds.
    const bridged = graph("NCCCCCCC", [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 0], [0, 7], [7, 4]]);
    expect(nitrogenCentre(bridged, 0)?.lonePair).toBe(true);

    // Aziridine: CC1CN1C, N at index 3.
    const aziridine = graph("CCCNC", [[0, 1], [1, 2], [2, 3], [3, 1], [3, 4]]);
    expect(nitrogenCentre(aziridine, 3)?.lonePair).toBe(true);
    // ... but not with an N–H, and not as an amide (CC1CN1C(C)=O).
    expect(nitrogenCentre(graph("CCCN", [[0, 1], [1, 2], [2, 3], [3, 1]]), 3)).toBeUndefined();
    const acylAziridine = graph("CCCNCOC", [[0, 1], [1, 2], [2, 3], [3, 1], [3, 4], [4, 5, 2], [4, 6]]);
    expect(nitrogenCentre(acylAziridine, 3)).toBeUndefined();
    // A sulfonyl neighbour does not conjugate, in RDKit's model or here.
    const sulfonylAziridine = graph("CCCNSOOC", [[0, 1], [1, 2], [2, 3], [3, 1], [3, 4], [4, 5, 2], [4, 6, 2], [4, 7]]);
    expect(nitrogenCentre(sulfonylAziridine, 3)?.lonePair).toBe(true);

    // Fused: 1-methylpyrrolizidine CC1CCN2CCCC12, N4. Its rings share one bond.
    const pyrrolizidine = graph("CCCCNCCCC", [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 1], [8, 4]]);
    expect(nitrogenCentre(pyrrolizidine, 4)).toBeUndefined();
    expect(stereoTopology(pyrrolizidine).centres.map((c) => c.atomId)).toEqual(["a2", "a9"]);

    // Aromatic, Kekule form: indolizine N3 and imidazo[1,2-a]pyridine N2.
    const indolizine = graph("CCCNCCCCC", [[0, 1], [1, 2, 2], [2, 3], [3, 4], [4, 5, 2], [5, 6], [6, 7, 2], [7, 3], [7, 8], [8, 0, 2]]);
    expect(nitrogenCentre(indolizine, 3)).toBeUndefined();
    const imidazopyridine = graph("CCNCCCCCN", [[0, 1, 2], [1, 2], [2, 3], [3, 4, 2], [4, 5], [5, 6, 2], [6, 7], [7, 2], [7, 8, 2], [8, 0]]);
    expect(nitrogenCentre(imidazopyridine, 2)).toBeUndefined();

    // Amide in a fused bicycle: O=C1CC2CCCCN12 (N8), and penicillanic acid,
    // the penicillin nucleus O=C1CC2SC(C)(C)C(C(=O)O)N12 (N4 at index 12).
    const lactam = graph("OCCCCCCCN", [[0, 1, 2], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 1], [8, 3]]);
    expect(nitrogenCentre(lactam, 8)).toBeUndefined();
    const penam = graph("OCCCSCCCCCOON", [
      [0, 1, 2], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [5, 7], [5, 8],
      [8, 9], [9, 10, 2], [9, 11], [8, 12], [12, 1], [12, 3],
    ]);
    expect(nitrogenCentre(penam, 12)).toBeUndefined();
    expect(stereoTopology(penam).centres.map((c) => c.atomId)).toEqual(["a4", "a9"]);

    // Plain acyclic amine: CCN(C)CCC.
    const amine = graph("CCNCCCC", [[0, 1], [1, 2], [2, 3], [2, 4], [4, 5], [5, 6]]);
    expect(nitrogenCentre(amine, 2)).toBeUndefined();
  });

  it("lists four-coordinate P=X and sulfoximine centres, with letters (decisions 31, 43 and 47)", () => {
    // Ethylmethylpropylphosphine oxide CCP(=O)(C)CCC drawn as a cross: O
    // north, Et east, Me west on a wedge, Pr south on a hash.
    const oxide = buildMolecule((b) => {
      const p = b.atom("P", ORIGIN); // a1
      b.bond(p, b.atom("O", step(ORIGIN, 90)), 2); // a2
      const et = b.atom("C", step(ORIGIN, 0)); // a4
      b.bond(p, et);
      b.bond(et, b.atom("C", step(step(ORIGIN, 0), 60)));
      b.bond(p, b.atom("C", step(ORIGIN, 180)), 1, "wedge"); // a8
      const pr = b.atom("C", step(ORIGIN, 270)); // a10
      b.bond(p, pr, 1, "hash");
      const pr2 = b.atom("C", step(step(ORIGIN, 270), 330));
      b.bond(pr, pr2);
      b.bond(pr2, b.atom("C", step(step(step(ORIGIN, 270), 330), 270)));
    });
    const config = stereoConfig(oxide);
    const p = centre(config, "a1");
    expect([p.order, p.implicitHydrogen, p.lonePair]).toEqual([["a2", "a4", "a8", "a10"], false, false]);
    expect(p.reading.kind).toBe("specified");
    const flipped = flipAtoms(oxide, oxide.atomIds, verticalMirror(ORIGIN));
    expect(parities(stereoConfig(flipped))).toEqual(parities(config));
    expect(parities(stereoConfig(mirrorPositionsOnly(oxide)))).toEqual(invert(parities(config)));
    // P=O at the centre is not duplicated (decision 47, IUPAC P-93.2.3): O >
    // propyl > ethyl > methyl. RDKit get_stereo_tags reads this drawing R.
    expect(letter(oxide, config, "a1")).toBe("R");
    expect(cipLetter(oxide, "a1")).toBe("R");

    const hetero = (mol: Molecule) =>
      stereoTopology(mol)
        .centres.filter((c) => requireAtom(mol, c.atomId).element !== "C")
        .map((c) => c.atomId);
    // Phosphoramidate COP(=O)(NC)OCC, as at sofosbuvir's P (index 2).
    expect(hetero(graph("COPONCOCC", [[0, 1], [1, 2], [2, 3, 2], [2, 4], [4, 5], [2, 6], [6, 7], [7, 8]]))).toEqual(["a3"]);
    // Phosphate triester with three different esters, and a symmetric one.
    expect(hetero(graph("COPOOCCOCCC", [[0, 1], [1, 2], [2, 3, 2], [2, 4], [4, 5], [5, 6], [2, 7], [7, 8], [8, 9], [9, 10]]))).toEqual(["a3"]);
    expect(hetero(graph("COPOOCOC", [[0, 1], [1, 2], [2, 3, 2], [2, 4], [4, 5], [2, 6], [6, 7]]))).toEqual([]);
    // Sulfoximine CS(=O)(=N)CC, and ethyl methyl sulfone.
    expect(hetero(graph("CSONCC", [[0, 1], [1, 2, 2], [1, 3, 2], [1, 4], [4, 5]]))).toEqual(["a2"]);
    expect(hetero(graph("CSOOCC", [[0, 1], [1, 2, 2], [1, 3, 2], [1, 4], [4, 5]]))).toEqual([]);
    // A phosphorus ylide P=C is a centre (decision 43), as RDKit flags one.
    expect(hetero(graph("CCPCCCCC", [[0, 1], [1, 2], [2, 3, 2], [2, 4], [2, 5], [5, 6], [6, 7]]))).toEqual(["a3"]);
  });

  it("does not let a display lone-pair pin create or remove a centre", () => {
    const sulfoxide = methylTolylSulfoxide("tolyl");
    expect(stereoTopology(setLonePairs(sulfoxide, "a1", 0)).centres.map((c) => c.atomId)).toEqual([
      "a1",
    ]);
    const amine = buildMolecule((b) => {
      const n = b.atom("N", ORIGIN);
      b.bond(n, b.atom("C", step(ORIGIN, 90)));
      const et = b.atom("C", step(ORIGIN, -30));
      b.bond(n, et);
      b.bond(et, b.atom("C", step(step(ORIGIN, -30), 30)));
      b.bond(n, b.atom("O", step(ORIGIN, 210)));
    });
    expect(stereoTopology(setLonePairs(amine, "a1", 1)).centres).toEqual([]);
  });
});

describe("implicit hydrogens and isotopes", () => {
  it("fully specifies a ring carbon with one wedge and an implicit H", () => {
    const mol = methylcyclohexanol("wedge");
    const c1 = centre(stereoConfig(mol), "a1");
    expect(c1.implicitHydrogen).toBe(true);
    expect(c1.reading.kind).toBe("specified");
    const config = stereoConfig(mol);
    for (const id of ["a1", "a2"]) expect(letter(mol, config, id)).toBe(cipLetter(mol, id));
  });

  it("reports CH3–CHD–OH as a stereocentre, and CH3–CH(H)–OH as not one", () => {
    function ethanol(isotope: number | undefined) {
      return buildMolecule((b) => {
        const me = b.atom("C", step(ORIGIN, 210));
        const c = b.atom("C", ORIGIN);
        b.bond(me, c);
        b.bond(c, b.atom("H", step(ORIGIN, -30), { isotope }));
        b.bond(c, b.atom("O", step(ORIGIN, 90)), 1, "wedge");
      });
    }
    const deuterated = ethanol(2);
    const config = stereoConfig(deuterated);
    expect(config.centres.map((c) => c.atomId)).toEqual(["a2"]);
    expect(letter(deuterated, config, "a2")).toBe(cipLetter(deuterated, "a2"));
    expect(["R", "S"]).toContain(letter(deuterated, config, "a2"));

    // An explicit protium atom is the same ligand as the implicit hydrogen.
    expect(stereoTopology(ethanol(undefined)).centres).toEqual([]);
  });

  it("drops a double-bond end that carries one explicit and one implicit H", () => {
    const propene = buildMolecule((b) => {
      const c1 = b.atom("C", ORIGIN);
      const c2 = b.atom("C", vec(1, 0));
      b.bond(c1, c2, 2);
      b.bond(c1, b.atom("H", step(ORIGIN, 120)));
      b.bond(c2, b.atom("C", step(vec(1, 0), 60)));
    });
    expect(stereoTopology(propene).doubleBonds).toEqual([]);
  });

  it("names cis/trans references by id, not by CIP rank", () => {
    // 1-bromo-1-chloropropene: at C1 the lowest id is Cl, not the senior Br.
    const mol = buildMolecule((b) => {
      const c1 = b.atom("C", ORIGIN); // a1
      const c2 = b.atom("C", vec(1, 0)); // a2
      b.bond(c1, c2, 2); // b3
      b.bond(c1, b.atom("Cl", step(ORIGIN, 120))); // a4
      b.bond(c1, b.atom("Br", step(ORIGIN, 240))); // a6
      b.bond(c2, b.atom("C", step(vec(1, 0), 60))); // a8
    });
    const [unit] = stereoConfig(mol).doubleBonds;
    expect(unit).toEqual({
      bondId: "b3",
      refOnFrom: "a4",
      refOnTo: "a8",
      reading: { kind: "specified", relation: "cis" },
    });
    const crossed = setBondStereo(mol, "b3", "either");
    expect(stereoConfig(crossed).doubleBonds[0]?.reading).toEqual({
      kind: "undetermined",
      reason: "unspecified",
    });
  });

  it("agrees with stereo.ts on every wedge fixture it can letter", () => {
    for (const mol of [
      bromochlorofluoromethaneR(),
      butan2olWedged(),
      glyceraldehydeWedged(),
      methylcyclohexanol("wedge"),
      methylcyclohexanol("hash"),
      betaGlucopyranose("wedge").mol,
    ]) {
      const config = stereoConfig(mol);
      expect(config.centres.length).toBeGreaterThan(0);
      for (const c of config.centres) {
        expect(letter(mol, config, c.atomId)).toBe(cipLetter(mol, c.atomId));
      }
    }
  });

  it("refuses to letter a centre from another molecule's config", () => {
    const mol = bromochlorofluoromethaneR();
    const other = butan2olWedged();
    const foreign = { ...centre(stereoConfig(mol), "a1"), atomId: "a2" };
    expect(() => descriptorFromConfig(other, foreign)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Ring faces
// ---------------------------------------------------------------------------

describe("ringFace", () => {
  const RING = ["a1", "a2", "a3", "a4", "a5", "a6"];
  const face = (mol: Molecule, atomId: AtomId, sub: AtomId) => ringFace(mol, RING, atomId, sub).kind;

  it("puts beta-D-glucose C1-O1 and C5-C6 on one face and C2-O2 on the other", () => {
    const { mol, ids, ringIds } = betaGlucopyranose("wedge");
    const at = (k: string) => ringFace(mol, ringIds, ids[k]!, ids[`${k}sub`]!).kind;
    expect(at("C1")).toBe(at("C5"));
    expect(at("C1")).toBe(at("C3"));
    expect(at("C2")).toBe(at("C4"));
    expect(at("C1")).not.toBe(at("C2"));
    expect(["front", "back"]).toContain(at("C1"));
  });

  it("gives the same chemistry for a ring drawn clockwise and counter-clockwise", () => {
    const ccw = methylcyclohexanol("wedge");
    // The same molecule drawn with the ring running the other way round the
    // page: positions reflected and the marks exchanged, which is flipAtoms.
    const cw = buildMolecule((b) => {
      const ring: string[] = [];
      for (let i = 0; i < 6; i++) ring.push(b.atom("C", fromPolar(-i * 60 * DEG, 1)));
      for (let i = 0; i < 6; i++) b.bond(ring[i]!, ring[(i + 1) % 6]!, 1);
      b.bond(ring[0]!, b.atom("O", fromPolar(0, 2)), 1, "hash");
      b.bond(ring[1]!, b.atom("C", fromPolar(-60 * DEG, 2)), 1, "hash");
    });
    expect(parities(stereoConfig(cw))).toEqual(parities(stereoConfig(ccw)));
    for (const mol of [ccw, cw]) {
      expect(face(mol, "a1", "a13")).toBe(face(mol, "a2", "a15")); // cis
    }
    expect(face(cw, "a1", "a13")).toBe(face(ccw, "a1", "a13"));
    expect(face(cw, "a2", "a15")).toBe(face(ccw, "a2", "a15"));

    const rotated = rotateAtoms(ccw, ccw.atomIds, ORIGIN, 180 * DEG);
    expect(face(rotated, "a1", "a13")).toBe(face(ccw, "a1", "a13"));
    const mirrored = mirrorPositionsOnly(ccw);
    expect(face(mirrored, "a1", "a13")).not.toBe(face(ccw, "a1", "a13"));

    const trans = methylcyclohexanol("hash");
    expect(face(trans, "a1", "a13")).not.toBe(face(trans, "a2", "a15"));
  });

  it("infers an unmarked substituent from the other exocyclic mark", () => {
    const mol = buildMolecule((b) => {
      const ring: string[] = [];
      for (let i = 0; i < 6; i++) ring.push(b.atom("C", fromPolar(i * 60 * DEG, 1)));
      for (let i = 0; i < 6; i++) b.bond(ring[i]!, ring[(i + 1) % 6]!, 1);
      b.bond(ring[0]!, b.atom("O", fromPolar(-20 * DEG, 2)), 1, "wedge"); // a13
      b.bond(ring[0]!, b.atom("C", fromPolar(20 * DEG, 2))); // a15
    });
    expect(face(mol, "a1", "a15")).not.toBe(face(mol, "a1", "a13"));
    expect(ringFace(mol, RING, "a2", "a13")).toEqual({
      kind: "undetermined",
      reason: "not-a-substituent",
    });
    expect(ringFace(mol, RING, "a3", "a1")).toEqual({
      kind: "undetermined",
      reason: "not-a-substituent",
    });
    expect(ringFace(methylcyclohexanol("wedge"), RING.slice(1), "a2", "a15")).toEqual({
      kind: "undetermined",
      reason: "not-a-ring",
    });
  });

  it("reports a degenerate and a self-intersecting polygon instead of reading them", () => {
    function cyclobutane(positions: readonly Vec2[]) {
      return buildMolecule((b) => {
        const ring = positions.map((p) => b.atom("C", p));
        for (let i = 0; i < 4; i++) b.bond(ring[i]!, ring[(i + 1) % 4]!);
        b.bond(ring[0]!, b.atom("O", vec(-1, -1)), 1, "wedge"); // a9
      });
    }
    const flat = cyclobutane([vec(0, 0), vec(1, 0), vec(2, 0), vec(3, 0)]);
    expect(ringFace(flat, ["a1", "a2", "a3", "a4"], "a1", "a9")).toEqual({
      kind: "undetermined",
      reason: "degenerate-polygon",
    });
    const bowTie = cyclobutane([vec(0, 0), vec(2, 1), vec(2, 0), vec(0, 1.5)]);
    expect(ringFace(bowTie, ["a1", "a2", "a3", "a4"], "a1", "a9")).toEqual({
      kind: "undetermined",
      reason: "self-intersecting-polygon",
    });
    const square = cyclobutane([vec(0, 0), vec(1, 0), vec(1, 1), vec(0, 1)]);
    expect(["front", "back"]).toContain(ringFace(square, ["a4", "a3", "a2", "a1"], "a1", "a9").kind);
  });

  it("pins the absolute orientation: canonical walk, normal and which side is front", () => {
    // Atom indices placed round the page counter-clockwise in the order
    // 0, 2, 4, 5, 3, 1. The canonical walk starts at a1 and steps to its
    // lower-index neighbour a2, so it runs a1 a2 a4 a6 a5 a3: CLOCKWISE on the
    // page. The reference normal therefore points away from the viewer, and a
    // wedge (toward the viewer) is on the BACK face. Starting the walk at the
    // highest index, reversing it, or swapping front and back all flip this.
    function ring(mark: "wedge" | "hash") {
      const slotOf = [0, 5, 1, 4, 2, 3];
      return buildMolecule((b) => {
        const ids = slotOf.map((slot) => b.atom("C", fromPolar(slot * 60 * DEG, 1)));
        for (const [i, j] of [[0, 2], [2, 4], [4, 5], [5, 3], [3, 1], [1, 0]] as const) {
          b.bond(ids[i]!, ids[j]!);
        }
        b.bond(ids[0]!, b.atom("O", fromPolar(0, 2)), 1, mark); // a13
        b.bond(ids[2]!, b.atom("C", fromPolar(60 * DEG, 2))); // a15, so a1 is a centre
      });
    }
    const wedged = ring("wedge");
    expect(rings(wedged)[0]!.atomIds).toEqual(["a1", "a2", "a4", "a6", "a5", "a3"]);
    expect(ringFace(wedged, RING, "a1", "a13")).toEqual({ kind: "back" });
    expect(ringFace(ring("hash"), RING, "a1", "a13")).toEqual({ kind: "front" });
  });

  it("reads a wedge drawn on a ring bond, as the parity reader does", () => {
    // 2-methylcyclohexan-1-ol with the OH plain and the C1–C2 ring bond wedged
    // from C1. stereoConfig reads C1 as specified; ringFace must state a face
    // too, and the same face as the OH-marked drawing with the same letter.
    function drawing(ohMark: "wedge" | "hash" | "none", ringBondWedged: boolean) {
      return buildMolecule((b) => {
        const ring: string[] = [];
        for (let i = 0; i < 6; i++) ring.push(b.atom("C", fromPolar(i * 60 * DEG, 1)));
        for (let i = 0; i < 6; i++) {
          b.bond(ring[i]!, ring[(i + 1) % 6]!, 1, i === 0 && ringBondWedged ? "wedge" : "none");
        }
        b.bond(ring[0]!, b.atom("O", fromPolar(0, 2)), 1, ohMark); // a13
        b.bond(ring[1]!, b.atom("C", fromPolar(60 * DEG, 2))); // a15
      });
    }
    const viaRing = drawing("none", true);
    expect(centre(stereoConfig(viaRing), "a1").reading.kind).toBe("specified");
    const target = cipLetter(viaRing, "a1");
    expect(["R", "S"]).toContain(target);
    const sameLetter = [drawing("wedge", false), drawing("hash", false)].find(
      (mol) => cipLetter(mol, "a1") === target,
    )!;
    expect(ringFace(viaRing, RING, "a1", "a13")).toEqual(ringFace(sameLetter, RING, "a1", "a13"));
    expect(["front", "back"]).toContain(ringFace(viaRing, RING, "a1", "a13").kind);
  });

  it("uses the same canonical walk as rings()", () => {
    const { mol, ringIds } = betaGlucopyranose("wedge");
    const [perceived] = rings(mol);
    expect(new Set(perceived!.atomIds)).toEqual(new Set(ringIds));
    // Handing the ring over in any order gives the same answer.
    const shuffled = [...ringIds].reverse();
    expect(ringFace(mol, shuffled, ringIds[0]!, "a13")).toEqual(ringFace(mol, ringIds, ringIds[0]!, "a13"));
  });
});

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

describe("split cache", () => {
  /** Hex-3-ene with a stereocentre, unique to this block so the LRU is cold. */
  function uniqueMolecule() {
    return buildMolecule((b) => {
      const c = b.atom("C", ORIGIN); // a1 centre
      b.bond(c, b.atom("F", step(ORIGIN, 90)), 1, "wedge"); // a2 b3
      b.bond(c, b.atom("Cl", step(ORIGIN, 210))); // a4 b5
      const d1 = b.atom("C", step(ORIGIN, -30)); // a6 b7
      b.bond(c, d1);
      const d2 = b.atom("C", step(step(ORIGIN, -30), 30)); // a8
      b.bond(d1, d2, 2); // b9
      b.bond(d1, b.atom("Se", step(step(ORIGIN, -30), -90))); // a10 b11
      b.bond(d2, b.atom("Te", step(step(step(ORIGIN, -30), 30), 90))); // a12 b13
    });
  }

  it("recomputes nothing topological for a position-only edit, while parity recomputes", () => {
    const mol = uniqueMolecule();
    resetStereoTopologyComputationCount();
    const topology = stereoTopology(mol);
    expect(topology.centres.map((c) => c.atomId)).toEqual(["a1"]);
    expect(topology.doubleBonds.map((d) => d.bondId)).toEqual(["b9"]);
    const before = stereoConfig(mol);
    expect(stereoTopologyComputationCount()).toBe(1);

    // Drag the Te across the double-bond axis: cis/trans must change.
    const d2 = requireAtom(mol, "a8").pos;
    const dragged = setAtomPosition(mol, "a12", { x: d2.x, y: d2.y - 1 });
    const after = stereoConfig(dragged);
    expect(stereoTopology(dragged)).toBe(topology);
    expect(stereoTopologyComputationCount()).toBe(1);
    expect(relations(after)).not.toEqual(relations(before));

    // A wedge edit is not topology either, and it inverts the centre.
    const hashed = setBondStereo(mol, "b3", "hash");
    expect(parities(stereoConfig(hashed))).toEqual(invert(parities(before)));
    expect(stereoTopologyComputationCount()).toBe(1);
  });

  it("memoises the reading per instance", () => {
    const mol = uniqueMolecule();
    expect(stereoConfig(mol)).toBe(stereoConfig(mol));
    expect(readConfig({ mol }, { kind: "fischer" })).toBe(readConfig({ mol }, { kind: "fischer" }));
  });

  it("recomputes when the topology really changes", () => {
    const mol = setElement(uniqueMolecule(), "a4", "Br");
    resetStereoTopologyComputationCount();
    stereoTopology(mol);
    expect(stereoTopologyComputationCount()).toBe(1);
    // C→N on the centre removes it; single→double on b7 removes both units.
    expect(stereoTopology(setElement(mol, "a1", "N")).centres).toEqual([]);
    expect(stereoTopologyComputationCount()).toBe(2);
    const doubled = setBondOrder(mol, "b7", 2);
    expect(stereoTopology(doubled).centres).toEqual([]);
    expect(stereoTopologyComputationCount()).toBe(3);
  });
});

describe("wavy bonds (decision 39)", () => {
  it("reads a wavy bond at a centre as a mixture of epimers, distinct from no stereo bond", () => {
    const wavy = setBondStereo(butan2olWedged(), "b7", "wavy");
    const config = stereoConfig(wavy);
    expect(centre(config, "a2").reading).toEqual({ kind: "mixture", of: "epimers" });
    expect(descriptorFromConfig(wavy, centre(config, "a2"), config)).toEqual({ kind: "mixture", of: "epimers" });
    const flat = setBondStereo(butan2olWedged(), "b7", "none");
    expect(centre(stereoConfig(flat), "a2").reading).toEqual({ kind: "undetermined", reason: "no-stereo-bond" });
    // The same statement under a reading convention that ignores wedges.
    const read = readConfig({ mol: wavy }, { kind: "pseudo3d", depth: {} });
    expect(read.kind === "read" && read.config.centres[0]?.reading).toEqual({ kind: "mixture", of: "epimers" });
  });
});

// ---------------------------------------------------------------------------
// Package hygiene
// ---------------------------------------------------------------------------

describe("chem-core exports", () => {
  const srcDir = dirname(fileURLToPath(import.meta.url));

  it("has no exported name declared by two modules (export * drops them silently)", () => {
    const modules = readdirSync(srcDir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts",
    );
    const owners = new Map<string, string[]>();
    const declaration =
      /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
    for (const file of modules) {
      const text = readFileSync(join(srcDir, file), "utf8");
      const names = new Set<string>();
      for (const match of text.matchAll(declaration)) names.add(match[1]!);
      for (const match of text.matchAll(/^export\s*(?:type\s*)?\{([^}]*)\}/gm)) {
        for (const part of match[1]!.split(",")) {
          const name = part.trim().split(/\s+as\s+/).pop()?.replace(/^type\s+/, "");
          if (name) names.add(name);
        }
      }
      for (const name of names) owners.set(name, [...(owners.get(name) ?? []), file]);
    }
    const duplicates = [...owners].filter(([, files]) => files.length > 1);
    expect(duplicates).toEqual([]);
    expect(owners.get("readConfig")).toEqual(["stereo-config.ts"]);
    // The CIP split: ranking and classification in cip.ts, axes and planes in
    // stereo-axes.ts. `LigandRef` moved to cip.ts and must not be redeclared
    // by stereo-config. (achirality.ts names its own exports in its own test.)
    expect(owners.get("LigandRef")).toEqual(["cip.ts"]);
    expect(owners.get("rankStereoCentre")).toEqual(["cip.ts"]);
    expect(owners.get("unrepresentableStereo")).toEqual(["stereo-axes.ts"]);
    expect(owners.get("atomSymmetryClasses")).toEqual(["symmetry.ts"]);
    expect(owners.get("StereoDescriptor")).toEqual(["stereo.ts"]);

    // The structure dictionary is the one deliberate exception: ~80 kB of
    // molblock text that only the insert box needs, so it is served from its
    // own entry point and the root barrel must NOT pull it in. It is still
    // checked for duplicate names above like every other module.
    const ownEntryPoint = new Set(["dictionary.ts", "dictionary-entries.ts"]);
    const index = readFileSync(join(srcDir, "index.ts"), "utf8");
    for (const file of modules) {
      const specifier = `"./${file.replace(/\.ts$/, ".js")}"`;
      if (ownEntryPoint.has(file)) expect(index).not.toContain(specifier);
      else expect(index).toContain(specifier);
    }
    const manifest = JSON.parse(readFileSync(join(srcDir, "..", "package.json"), "utf8")) as {
      exports: Record<string, { import: string }>;
    };
    expect(manifest.exports["./dictionary"]?.import).toBe("./dist/dictionary.js");
  });

  it("keeps parity.ts's liftParity the only 2D-to-tetrahedral lift", () => {
    // The two readers call it; the ranking, symmetry and axis modules never
    // read a coordinate at all, so they cannot hide a lift. achirality.ts
    // makes the same promise in its own test.
    for (const file of ["stereo.ts", "stereo-config.ts"]) {
      const text = readFileSync(join(srcDir, file), "utf8");
      expect(text, file).toMatch(/import \{[^}]*\bliftParity\b[^}]*\} from "\.\/parity\.js"/);
    }
    for (const file of ["cip.ts", "symmetry.ts", "stereo-axes.ts"]) {
      const text = readFileSync(join(srcDir, file), "utf8");
      expect(text, file).not.toMatch(/\.pos\b/);
      expect(text, file).not.toMatch(/liftParity|pointsParity/);
    }
  });

  it("still has zero runtime dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(srcDir, "..", "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });
});

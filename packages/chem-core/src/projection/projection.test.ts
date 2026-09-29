/**
 * The projection engine, asserted on the RDKit-generated reference set in
 * test/fixtures/projection (ef1fdc4) and on real molecules built here.
 *
 * NOTHING HERE PASSES VACUOUSLY. An undetermined descriptor survives every
 * projection perfectly, so every fixture's descriptors are asserted to be
 * letters BEFORE any layout runs; every round trip also asserts the layout
 * placed every unit (`unplaced` empty, coverage the whole frame), because the
 * law alone is satisfied by a layout that stated nothing; and the mirror
 * tests prove the reader has teeth by showing the wrong mark policy fails.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildMolecule } from "../builders.js";
import { insertFragment } from "../fragment.js";
import { readMolblock } from "../molblock-read.js";
import { addAtom, addBond, bondBetween } from "../molecule.js";
import { removeAtoms, setAtomPosition, setBondStereo, setIsotope } from "../ops.js";
import { resetRingPerceptionComputationCount, ringPerceptionComputationCount, rings } from "../rings.js";
import {
  descriptorFromConfig,
  readConfig,
  resetStereoTopologyComputationCount,
  stereoConfig,
  stereoTopologyComputationCount,
  type StereoConfig,
} from "../stereo-config.js";
import { medianBondLength, normalizeBondLength } from "../transform.js";
import type { AtomId, Molecule } from "../types.js";
import { vec } from "../vec.js";
import { implicitHydrogenCount } from "../valence.js";
import {
  applyConformation,
  project,
  projectionCoverage,
  projectionTopologyComputationCount,
  readProjection,
  resetProjectionTopologyComputationCount,
  resolveProjectionFrame,
  RESULTS_PER_CONFIGURATION,
} from "./engine.js";
import { canonicalProjectionView, restrictStereoConfig, rotateProjectionView, stereoDisagreements } from "./frames.js";
import { condensedGroup, layoutNodeOf, sourceAtomsOf } from "./nodes.js";
import { placementOfLayout, type LayoutAccess } from "./template.js";
import {
  CHARACTERISTIC_LENGTHS,
  type ChainView,
  type PlanarView,
  type ProjectedLayout,
  type ProjectionResult,
  type ProjectionView,
  type RingView,
  type SightedBondView,
} from "./types.js";

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures", "projection");
const FIXTURE_FILES = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".mol"))
  .sort();

function load(file: string): Molecule {
  return readMolblock(readFileSync(join(FIXTURES, file), "utf8")).molecule;
}

function planar(rotationDeg = 0, mirror = false): PlanarView {
  return { kind: "planar", template: "wedgeDash", frame: {}, params: { rotationDeg, mirror } };
}

function fischer(backbone: readonly AtomId[], top: "first" | "last" = "first"): ChainView {
  return { kind: "chain", template: "fischer", frame: { backbone }, params: { top } };
}

function ring(ringAtomIds: readonly AtomId[], referenceAtomId?: AtomId): RingView {
  return {
    kind: "ring",
    template: "haworth",
    frame: referenceAtomId === undefined ? { ringAtomIds } : { ringAtomIds, referenceAtomId },
    params: { face: "front" },
  };
}

function layoutOf(result: ProjectionResult): ProjectedLayout {
  if (result.kind !== "available") throw new Error(`not available: ${JSON.stringify(result)}`);
  return result.layout;
}

function readBack(mol: Molecule, layout: ProjectedLayout): StereoConfig {
  const read = readProjection(mol, layout);
  if (read.kind !== "read") throw new Error(`read refused: ${read.reason}`);
  return read.config;
}

/** "R", "S", "r", "s", "mixture" or "undetermined:<reason>" for each centre, by id. */
function letters(mol: Molecule, config: StereoConfig): Record<AtomId, string> {
  const out: Record<AtomId, string> = {};
  for (const centre of config.centres) {
    const d = descriptorFromConfig(mol, centre, config);
    out[centre.atomId] = d === undefined ? "none" : d.kind === "undetermined" ? `undetermined:${d.reason}` : d.kind;
  }
  return out;
}

function relations(config: StereoConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of config.doubleBonds) out[b.bondId] = b.reading.kind === "specified" ? b.reading.relation : b.reading.kind;
  return out;
}

function labelText(layout: ProjectedLayout, nodeId: string): string {
  const node = layout.derivedNodes.find((n) => n.id === nodeId);
  if (node === undefined) throw new Error(`no derived node ${nodeId}`);
  return node.label.map((part) => part.text).join("");
}

function sideOf(layout: ProjectedLayout, centre: AtomId, atomId: AtomId): "left" | "right" {
  const node = layoutNodeOf(layout, atomId)!;
  const x = layout.positions[node]!.x - layout.positions[centre]!.x;
  return x < 0 ? "left" : "right";
}

const GLUCOSE_BACKBONE = ["a2", "a3", "a5", "a7", "a9", "a11"];

function newman(front: AtomId, back: AtomId, references: { frontReference?: AtomId; backReference?: AtomId } = {}): SightedBondView {
  return { kind: "sightedBond", template: "newman", frame: { front, back, ...references }, params: { torsionDeg: 60, rollDeg: 0 } };
}

/**
 * Ethyl methyl sulfoxide, CH3–S(=O)–CH2CH3, with the S–CH3 bond marked: a
 * stereocentre whose fourth ligand is sulfur's lone pair, so a Fischer cross
 * at S has ONE explicit arm. a1 CH3, a2 S, a3 CH2; the O is found by element.
 */
function ethylMethylSulfoxide(mark: "wedge" | "hash"): Molecule {
  return buildMolecule((b) => {
    const methyl = b.atom("C", vec(-1, 0));
    const sulfur = b.atom("S", vec(0, 0));
    const methylene = b.atom("C", vec(1, 0));
    b.bond(sulfur, methyl, 1, mark);
    b.bond(sulfur, methylene);
    b.bond(sulfur, b.atom("O", vec(0, 1)), 2);
    b.bond(methylene, b.atom("C", vec(2, 0)));
  });
}

// ---------------------------------------------------------------------------
// The reference set is non-vacuous before anything is projected
// ---------------------------------------------------------------------------

describe("the reference set, before any layout runs", () => {
  it("has 29 molecules and every stereocentre of every one reads a letter", () => {
    expect(FIXTURE_FILES).toHaveLength(29);
    let centres = 0;
    for (const file of FIXTURE_FILES) {
      const mol = load(file);
      const config = stereoConfig(mol);
      for (const [atomId, letter] of Object.entries(letters(mol, config))) {
        expect(letter, `${file} ${atomId}`).toMatch(/^[RSrs]$/);
        centres++;
      }
      for (const b of config.doubleBonds) expect(b.reading.kind, file).toBe("specified");
    }
    // 29 files, 75 centres (projection-fixtures.test.ts pins each letter): a
    // count that drops means a fixture stopped resolving.
    expect(centres).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// The planar frame: read(project(M, C, planar), planar) = C on its coverage
// ---------------------------------------------------------------------------

const PLANAR_VIEWS: readonly [string, PlanarView][] = [
  ["as drawn", planar()],
  ["turned a quarter", planar(90)],
  ["turned 37 degrees", planar(37)],
  ["mirrored", planar(0, true)],
  ["mirrored and turned 200 degrees", planar(200, true)],
];

describe("the planar frame round trip", () => {
  for (const file of FIXTURE_FILES) {
    for (const [name, view] of PLANAR_VIEWS) {
      it(`${file}, ${name}: states every unit and reads back the configuration`, () => {
        const mol = load(file);
        const config = stereoConfig(mol);
        const layout = layoutOf(project(mol, config, view));

        // Every unit placed: the frame's whole coverage, nothing unplaced.
        expect(layout.unplaced).toEqual([]);
        expect(layout.coverage).toEqual(projectionCoverage(mol, view));
        expect(layout.coverage.centres).toEqual(config.centres.map((c) => c.atomId));
        expect(layout.coverage.doubleBonds).toEqual(config.doubleBonds.map((b) => b.bondId));

        const read = readBack(mol, layout);
        expect(stereoDisagreements(config, read, layout.coverage)).toEqual([]);
        // The descriptors agree too, and they are letters, not undetermined.
        const before = letters(mol, config);
        expect(letters(mol, read)).toEqual(before);
        for (const letter of Object.values(before)) expect(letter).toMatch(/^[RSrs]$/);
        expect(relations(read)).toEqual(relations(config));
      });
    }
  }

  it("keeps every position exactly as drawn when neither turned nor mirrored", () => {
    const mol = load("d-glucose-open.mol");
    const layout = layoutOf(project(mol, stereoConfig(mol), planar()));
    for (const atomId of mol.atomIds) expect(layout.positions[atomId]).toEqual(mol.atoms[atomId]!.pos);
    expect(layout.derivedNodes).toEqual([]);
  });

  it("exchanges wedge and hash on a mirror, and the reader would catch a panel that did not", () => {
    const mol = load("d-glucose-open.mol");
    const config = stereoConfig(mol);
    const mirrored = layoutOf(project(mol, config, planar(0, true)));
    const wedges = mol.bondIds.filter((id) => mol.bonds[id]!.stereo === "wedge");
    expect(wedges.length).toBeGreaterThan(0);
    for (const id of wedges) expect(mirrored.marks[id]?.stereo).toBe("hash");

    // The same mirrored positions read with the AUTHOR's marks are the
    // enantiomer at every centre: the round trip above has teeth.
    const positions: Record<AtomId, { x: number; y: number }> = {};
    for (const atomId of mol.atomIds) positions[atomId] = mirrored.positions[atomId]!;
    const naive = readConfig({ mol, positions }, { kind: "wedgeHash" });
    if (naive.kind !== "read") throw new Error("refused");
    expect(letters(mol, naive.config)).toEqual({ a3: "S", a5: "R", a7: "S", a9: "S" });
    expect(letters(mol, readBack(mol, mirrored))).toEqual({ a3: "R", a5: "S", a7: "R", a9: "R" });
  });

  it("states the configuration it is given, not the drawing's: D-glucose's drawing asked for L-glucose", () => {
    const d = load("d-glucose-open.mol");
    const l = load("l-glucose-open.mol");
    // Same atoms, same ids, every centre inverted: L-glucose's configuration
    // is a valid configuration of D-glucose's graph.
    const layout = layoutOf(project(d, stereoConfig(l), planar(90)));
    expect(layout.unplaced).toEqual([]);
    expect(letters(d, readBack(d, layout))).toEqual({ a3: "S", a5: "R", a7: "S", a9: "S" });
  });

  it("never states more than its configuration: an unspecified centre loses its marks", () => {
    const mol = load("r-glyceraldehyde.mol");
    const config = stereoConfig(mol);
    const unstated: StereoConfig = {
      ...config,
      centres: config.centres.map((c) => ({ ...c, reading: { kind: "undetermined", reason: "no-stereo-bond" } })),
    };
    const layout = layoutOf(project(mol, unstated, planar()));
    expect(Object.values(layout.marks)).toEqual([]);
    expect(readBack(mol, layout).centres[0]!.reading.kind).toBe("undetermined");
    expect(layout.coverage.centres).toEqual(["a3"]);
  });

  it("gives each bond the depth its final mark draws: a wedge toward the viewer, a hash away", () => {
    const d = load("d-glucose-open.mol");
    const l = load("l-glucose-open.mol");
    const marked = d.bondIds.filter((id) => d.bonds[id]!.stereo === "wedge" || d.bonds[id]!.stereo === "hash");
    expect(marked.length).toBeGreaterThan(0);
    // As drawn, mirrored (marks exchanged), and corrected to L-glucose's
    // configuration (every centre's marks exchanged): depth follows the
    // marks the layout finally draws, never the author's.
    for (const layout of [
      layoutOf(project(d, stereoConfig(d), planar())),
      layoutOf(project(d, stereoConfig(d), planar(30, true))),
      layoutOf(project(d, stereoConfig(l), planar())),
    ]) {
      for (const bond of layout.bonds) {
        const stereo = layout.marks[bond.id]?.stereo;
        expect(layout.depth[bond.id], bond.id).toBe(stereo === "wedge" ? "front" : stereo === "hash" ? "back" : "inPlane");
      }
    }
    const plain = layoutOf(project(d, stereoConfig(d), planar()));
    const mirrored = layoutOf(project(d, stereoConfig(d), planar(0, true)));
    for (const id of marked) {
      expect(plain.depth[id], id).toBe(d.bonds[id]!.stereo === "wedge" ? "front" : "back");
      expect(mirrored.depth[id], id).toBe(d.bonds[id]!.stereo === "wedge" ? "back" : "front");
    }
  });

  it("writes a mark where the drawing has none, and lists a centre no mark can state", () => {
    const glyceraldehyde = load("r-glyceraldehyde.mol");
    const bare = setBondStereo(glyceraldehyde, mol0Wedge(glyceraldehyde), "none");
    const layout = layoutOf(project(bare, stereoConfig(glyceraldehyde), planar()));
    expect(layout.unplaced).toEqual([]);
    expect(layout.coverage.centres).toEqual(["a3"]);
    // ONE mark, on the hydroxyl, the one terminal atom (decision 178); hashed,
    // because that is what reads (R) back, not because a rule said so.
    expect(layout.marks).toEqual({ [bondBetween(bare, "a3", "a4")!.id]: { stereo: "hash", narrowEnd: "a3" } });
    expect(letters(bare, readBack(bare, layout))).toEqual({ a3: "R" });

    // The hydroxyl drawn on top of its carbon: every candidate reads a
    // zero-length ligand, so nothing can state C2 and it is listed.
    const crushed = setAtomPosition(bare, "a4", bare.atoms["a3"]!.pos);
    const nothing = layoutOf(project(crushed, stereoConfig(glyceraldehyde), planar()));
    expect(nothing.unplaced).toEqual([{ unit: { kind: "centre", atomId: "a3" }, reason: "no-mark-to-carry" }]);
    expect(nothing.coverage.centres).toEqual([]);
    expect(Object.keys(nothing.marks)).toEqual([]);
    expect(readBack(crushed, nothing).centres).toEqual([]);

    const cis = load("cis-2-butene.mol");
    const trans = load("trans-2-butene.mol");
    const crossed = layoutOf(project(cis, stereoConfig(trans), planar()));
    expect(crossed.unplaced.map((u) => u.reason)).toEqual(["drawn-geometry-disagrees"]);
    expect(crossed.coverage.doubleBonds).toEqual([]);
  });
});

function mol0Wedge(mol: Molecule): string {
  return mol.bondIds.find((id) => mol.bonds[id]!.stereo !== "none")!;
}

// ---------------------------------------------------------------------------
// The Fischer template
// ---------------------------------------------------------------------------

describe("the Fischer template", () => {
  it("draws D-glucose OH right, left, right, right, and reads (2R,3S,4R,5R) back from the cross", () => {
    const mol = load("d-glucose-open.mol");
    const config = stereoConfig(mol);
    const layout = layoutOf(project(mol, config, fischer(GLUCOSE_BACKBONE)));
    expect(layout.unplaced).toEqual([]);
    expect(layout.coverage).toEqual({ centres: ["a3", "a5", "a7", "a9"], doubleBonds: [] });

    // The textbook picture, checked against the textbook, not the reader.
    expect(["a4", "a6", "a8", "a10"].map((o, i) => sideOf(layout, ["a3", "a5", "a7", "a9"][i]!, o))).toEqual([
      "right",
      "left",
      "right",
      "right",
    ]);
    expect(labelText(layout, "a2.CHO")).toBe("CHO");
    expect(labelText(layout, "a11.CH2OH")).toBe("CH2OH");
    // CHO on top, CH2OH at the bottom, the backbone straight down the y axis.
    expect(layout.positions["a2.CHO"]!.y).toBeGreaterThan(layout.positions["a11.CH2OH"]!.y);
    for (const id of ["a2.CHO", "a3", "a5", "a7", "a9", "a11.CH2OH"]) expect(layout.positions[id]!.x).toBe(0);

    const read = readBack(mol, layout);
    expect(stereoDisagreements(config, read, layout.coverage)).toEqual([]);
    expect(letters(mol, read)).toEqual({ a3: "R", a5: "S", a7: "R", a9: "R" });
  });

  it("flips every side for L-glucose and exactly C4 for D-galactose", () => {
    const l = load("l-glucose-open.mol");
    const lLayout = layoutOf(project(l, stereoConfig(l), fischer(GLUCOSE_BACKBONE)));
    expect(["a4", "a6", "a8", "a10"].map((o, i) => sideOf(lLayout, ["a3", "a5", "a7", "a9"][i]!, o))).toEqual([
      "left",
      "right",
      "left",
      "left",
    ]);
    const gal = load("d-galactose-open.mol");
    const galLayout = layoutOf(project(gal, stereoConfig(gal), fischer(GLUCOSE_BACKBONE)));
    expect(["a4", "a6", "a8", "a10"].map((o, i) => sideOf(galLayout, ["a3", "a5", "a7", "a9"][i]!, o))).toEqual([
      "right",
      "left",
      "left",
      "right",
    ]);
  });

  it("puts D-glyceraldehyde's OH right and L-alanine's and L-cysteine's NH2 left, although L-cysteine is (R)", () => {
    const r = load("r-glyceraldehyde.mol");
    expect(sideOf(layoutOf(project(r, stereoConfig(r), fischer(["a2", "a3", "a5"]))), "a3", "a4")).toBe("right");
    const s = load("s-glyceraldehyde.mol");
    expect(sideOf(layoutOf(project(s, stereoConfig(s), fischer(["a2", "a3", "a5"]))), "a3", "a4")).toBe("left");

    const alanine = load("l-alanine.mol");
    const ala = layoutOf(project(alanine, stereoConfig(alanine), fischer(["a4", "a2", "a3"])));
    expect(sideOf(ala, "a2", "a1")).toBe("left");
    expect(labelText(ala, "a4.COOH")).toBe("COOH");
    expect(labelText(ala, "a3.CH3")).toBe("CH3");

    const cysteine = load("l-cysteine.mol");
    const cysConfig = stereoConfig(cysteine);
    expect(letters(cysteine, cysConfig)).toEqual({ a2: "R" });
    const cys = layoutOf(project(cysteine, cysConfig, fischer(["a5", "a2", "a3"])));
    expect(sideOf(cys, "a2", "a1")).toBe("left");
    expect(labelText(cys, "a3.CH2SH")).toBe("CH2SH");
    expect(sourceAtomsOf(cys, "a3.CH2SH")).toEqual(["a3", "a4"]);
  });

  it("turns the picture a half turn when the other end is on top, stating the same configuration", () => {
    const mol = load("d-glucose-open.mol");
    const config = stereoConfig(mol);
    const layout = layoutOf(project(mol, config, fischer(GLUCOSE_BACKBONE, "last")));
    expect(layout.positions["a11.CH2OH"]!.y).toBeGreaterThan(layout.positions["a2.CHO"]!.y);
    expect(["a4", "a6", "a8", "a10"].map((o, i) => sideOf(layout, ["a3", "a5", "a7", "a9"][i]!, o))).toEqual([
      "left",
      "right",
      "left",
      "left",
    ]);
    expect(letters(mol, readBack(mol, layout))).toEqual({ a3: "R", a5: "S", a7: "R", a9: "R" });
  });

  it("moves a lone arm across for the other enantiomer of a sulfoxide, whose fourth ligand is a lone pair", () => {
    const sides: string[] = [];
    const stated: string[] = [];
    for (const mark of ["wedge", "hash"] as const) {
      const mol = ethylMethylSulfoxide(mark);
      const config = stereoConfig(mol);
      const want = letters(mol, config);
      expect(want.a2, mark).toMatch(/^[RS]$/);
      const oxygen = mol.atomIds.find((id) => mol.atoms[id]!.element === "O")!;
      const layout = layoutOf(project(mol, config, fischer(["a1", "a2", "a3"])));
      // One explicit arm (the O) and no hydrogen: the lone pair is the empty arm.
      expect(layout.derivedNodes.filter((n) => n.host === "a2")).toEqual([]);
      expect(layoutNodeOf(layout, oxygen)).toBe(oxygen);
      expect(layout.unplaced).toEqual([]);
      expect(layout.coverage.centres).toEqual(["a2"]);
      expect(letters(mol, readBack(mol, layout))).toEqual(want);
      sides.push(sideOf(layout, "a2", oxygen));
      stated.push(want.a2!);
    }
    // Two enantiomers, so two letters and the oxygen on two sides.
    expect(new Set(stated).size).toBe(2);
    expect([...sides].sort()).toEqual(["left", "right"]);
  });

  it("gives every implicit hydrogen a synthetic node on the empty arm, named by its centre", () => {
    const mol = load("d-glucose-open.mol");
    const layout = layoutOf(project(mol, stereoConfig(mol), fischer(GLUCOSE_BACKBONE)));
    for (const [centre, oxygen] of [
      ["a3", "a4"],
      ["a5", "a6"],
      ["a7", "a8"],
      ["a9", "a10"],
    ] as const) {
      const h = `${centre}.H`;
      expect(sourceAtomsOf(layout, h)).toEqual([centre]);
      expect(layout.positions[h]!.y).toBe(layout.positions[centre]!.y);
      expect(Math.sign(layout.positions[h]!.x)).toBe(-Math.sign(layout.positions[layoutNodeOf(layout, oxygen)!]!.x));
      expect(layout.depth[`${h}.bond`]).toBe("front");
    }
    // The Fischer convention, carried: horizontal bonds front, vertical back.
    const vertical = bondBetween(mol, "a3", "a5")!.id;
    expect(layout.depth[vertical]).toBe("back");
    expect(layout.depth[bondBetween(mol, "a3", "a4")!.id]).toBe("front");
  });

  it("reads each synthetic hydrogen where it is drawn, not in whatever arm is left (decision 179)", () => {
    const mol = load("d-glucose-open.mol");
    const layout = layoutOf(project(mol, stereoConfig(mol), fischer(GLUCOSE_BACKBONE)));
    const moved = (to: { x: number; y: number }): ProjectedLayout => ({
      ...layout,
      positions: { ...layout.positions, "a5.H": to },
    });
    const c3 = layout.positions["a5"]!;
    const oxygen = layout.positions[layoutNodeOf(layout, "a6")!]!;
    // Onto the oxygen's own arm: two ligands on one slot state nothing.
    const stacked = readBack(mol, moved({ x: 2 * oxygen.x - c3.x, y: c3.y }));
    expect(stacked.centres.find((c) => c.atomId === "a5")!.reading.kind).toBe("undetermined");
    // Tilted off the axis: the cross refuses, as for an off-axis bond.
    const tilted = readProjection(mol, moved({ x: layout.positions["a5.H"]!.x, y: c3.y + 0.2 }));
    expect(tilted.kind === "unavailable" && tilted.reason).toBe("off-axis");
  });

  it("draws a two-hydrogen carbon of 2-deoxy-D-ribose with two synthetic hydrogens and no claim", () => {
    const mol = load("2-deoxy-d-ribose-open.mol");
    const config = stereoConfig(mol);
    // O=CC[C@H](O)[C@H](O)CO: C1 a2, C2 a3 (CH2), C3 a4, C4 a6, C5 a8.
    const layout = layoutOf(project(mol, config, fischer(["a2", "a3", "a4", "a6", "a8"])));
    expect(layout.unplaced).toEqual([]);
    expect(layout.coverage.centres).toEqual(["a4", "a6"]);
    expect(sourceAtomsOf(layout, "a3.H")).toEqual(["a3"]);
    expect(sourceAtomsOf(layout, "a3.H.2")).toEqual(["a3"]);
    expect(letters(mol, readBack(mol, layout))).toEqual({ a4: "S", a6: "R" });
  });

  it("draws a wavy arm for a mixture, and lists a centre the configuration leaves unspecified", () => {
    const mol = load("d-glucose-open.mol");
    const wavy = setBondStereo(mol, bondBetween(mol, "a3", "a4")!.id, "wavy");
    const layout = layoutOf(project(wavy, stereoConfig(wavy), fischer(GLUCOSE_BACKBONE)));
    expect(layout.unplaced).toEqual([]);
    expect(layout.marks[bondBetween(mol, "a3", "a4")!.id]).toEqual({ stereo: "wavy", narrowEnd: "a3" });
    expect(readBack(wavy, layout).centres[0]!.reading).toEqual({ kind: "mixture", of: "epimers" });

    // No marks at all: every centre undetermined. The cross still draws, and
    // says which centres it does not state (decision 146).
    let bare = mol;
    for (const id of mol.bondIds) bare = setBondStereo(bare, id, "none");
    const unstated = layoutOf(project(bare, stereoConfig(bare), fischer(GLUCOSE_BACKBONE)));
    expect(unstated.coverage.centres).toEqual([]);
    expect(unstated.unplaced.map((u) => [u.unit.kind === "centre" ? u.unit.atomId : "", u.reason])).toEqual([
      ["a3", "unspecified-in-config"],
      ["a5", "unspecified-in-config"],
      ["a7", "unspecified-in-config"],
      ["a9", "unspecified-in-config"],
    ]);
    expect(readBack(bare, unstated).centres).toEqual([]);
  });

  it("refuses what a cross cannot draw, with the atoms to fix", () => {
    const glucose = load("d-glucose-open.mol");
    expect(project(glucose, stereoConfig(glucose), fischer(["a2", "a3"]))).toMatchObject({
      kind: "unavailable",
      reason: "backbone-too-short",
    });
    expect(project(glucose, stereoConfig(glucose), fischer(["a2", "a5", "a7"]))).toMatchObject({
      kind: "unavailable",
      reason: "not-a-path",
      atomIds: ["a2", "a5"],
    });
    expect(project(glucose, stereoConfig(glucose), fischer(["a2", "a3", "a2"]))).toMatchObject({
      kind: "unavailable",
      reason: "repeated-atom",
    });

    // 1-phenylethanol: the phenyl on the arm has no linear spelling.
    const phenylethanol = buildMolecule((b) => {
      const methyl = b.atom("C", vec(-1, 0));
      const centre = b.atom("C", vec(0, 0));
      b.bond(methyl, centre);
      b.bond(centre, b.atom("O", vec(0, -1)), 1, "wedge");
      const ring: string[] = [];
      for (let k = 0; k < 6; k++) ring.push(b.atom("C", vec(2 + Math.cos((k * Math.PI) / 3), Math.sin((k * Math.PI) / 3))));
      for (let k = 0; k < 6; k++) b.bond(ring[k]!, ring[(k + 1) % 6]!, k % 2 === 0 ? 2 : 1);
      b.bond(centre, ring[3]!);
    });
    const oxygen = phenylethanol.atomIds.find((id) => phenylethanol.atoms[id]!.element === "O")!;
    const [methyl, centre] = phenylethanol.atomIds;
    expect(project(phenylethanol, stereoConfig(phenylethanol), fischer([methyl!, centre!, oxygen]))).toMatchObject({
      kind: "unavailable",
      reason: "substituent-too-large",
    });

    // A backbone through a ring: trans-1,2-dimethylcyclohexane's ring atoms
    // loop an arm back into the backbone.
    const cyclohexane = load("trans-1-2-dimethylcyclohexane.mol");
    const walk = rings(cyclohexane)[0]!.atomIds;
    const result = project(cyclohexane, stereoConfig(cyclohexane), fischer([walk[0]!, walk[1]!, walk[2]!]));
    expect(result).toMatchObject({ kind: "unavailable", reason: "backbone-in-ring" });
  });

  it("spells groups away from the crossing on either arm", () => {
    const isoleucine = load("l-isoleucine.mol");
    // CC[C@H](C)[C@H](N)C(=O)O: a1 CH3, a2 CH2, a3 Cβ, a4 CH3, a5 Cα, a6 N, a7 COOH.
    const layout = layoutOf(project(isoleucine, stereoConfig(isoleucine), fischer(["a7", "a5", "a3", "a2", "a1"])));
    expect(layout.unplaced).toEqual([]);
    expect(letters(isoleucine, readBack(isoleucine, layout))).toEqual({ a3: "S", a5: "S" });
    const methyl = layout.derivedNodes.find((n) => n.id === "a4.CH3")!;
    const onLeft = layout.positions[methyl.id]!.x < 0;
    expect(methyl.label.map((p) => p.text).join("")).toBe(onLeft ? "H3C" : "CH3");
    // The carbon the arm is bonded to sits on the node, whichever way it reads.
    expect(methyl.label[methyl.anchor]).toEqual({ kind: "symbol", text: "C" });
    expect(methyl.anchor).toBe(onLeft ? 2 : 0);
    expect(sourceAtomsOf(layout, "a1.CH3")).toEqual(["a1"]);
  });
});

describe("condensed group spelling", () => {
  it("writes the groups a Fischer terminus and arm carry the way chemists write them", () => {
    const glucose = load("d-glucose-open.mol");
    const spell = (root: AtomId, parent: AtomId) => {
      const result = condensedGroup(glucose, root, parent);
      if (result.kind !== "group") throw new Error(result.kind);
      return [
        result.group.east.map((p) => p.text).join(""),
        result.group.west.map((p) => p.text).join(""),
      ];
    };
    expect(spell("a2", "a3")).toEqual(["CHO", "OHC"]);
    expect(spell("a11", "a9")).toEqual(["CH2OH", "HOH2C"]);
    const hydroxymethyl = condensedGroup(glucose, "a11", "a9");
    if (hydroxymethyl.kind !== "group") throw new Error(hydroxymethyl.kind);
    expect(hydroxymethyl.group.westAnchor).toBe(4);
    expect(hydroxymethyl.group.west[4]).toEqual({ kind: "symbol", text: "C" });
    expect(spell("a4", "a3")).toEqual(["OH", "HO"]);
    // OC(=O)[C@H](O)[C@@H](O)C(=O)O: the carboxyl carbon a2 hangs off C2, a4.
    const tartaric = load("rr-tartaric-acid.mol");
    const result = condensedGroup(tartaric, "a2", "a4");
    if (result.kind !== "group") throw new Error(result.kind);
    expect(result.group.east.map((p) => p.text).join("")).toBe("COOH");
    expect(result.group.west.map((p) => p.text).join("")).toBe("HOOC");
    expect(result.group.atomIds).toEqual(["a1", "a2", "a3"]);
    // Past the fence it reports what it reached, and a ring is not spelled.
    expect(condensedGroup(tartaric, "a2", "a1", new Set(["a6"]))).toEqual({ kind: "reaches", atomId: "a6" });
    // From a methyl into cis-1,2-dimethylcyclohexane's ring: no linear spelling.
    const cyclohexane = load("cis-1-2-dimethylcyclohexane.mol");
    const ringAtoms = rings(cyclohexane)[0]!.atomIds;
    const methyl = cyclohexane.atomIds.find((id) => !ringAtoms.includes(id))!;
    const attached = ringAtoms.find((id) => bondBetween(cyclohexane, id, methyl) !== undefined)!;
    expect(condensedGroup(cyclohexane, attached, methyl)).toEqual({ kind: "cyclic" });
  });

  it("collapses repeated branches and brackets the rest", () => {
    // tert-butyl and isopropyl on a stub carbon.
    const mol = buildMolecule((b) => {
      const stub = b.atom("C", vec(0, 0));
      const quaternary = b.atom("C", vec(1, 0));
      b.bond(stub, quaternary);
      for (let k = 0; k < 3; k++) b.bond(quaternary, b.atom("C", vec(2, k)));
      const methine = b.atom("C", vec(-1, 0));
      b.bond(stub, methine);
      b.bond(methine, b.atom("C", vec(-2, 1)));
      b.bond(methine, b.atom("C", vec(-2, -1)));
    });
    const [stub, quaternary, , , , methine] = mol.atomIds;
    const text = (root: AtomId) => {
      const r = condensedGroup(mol, root, stub!);
      return r.kind === "group" ? r.group.east.map((p) => p.text).join("") : r.kind;
    };
    expect(text(quaternary!)).toBe("C(CH3)3");
    expect(text(methine!)).toBe("CH(CH3)2");
  });

  it("names the nuclide of every atom it folds: L-alanine-3,3,3-d3 and D-glyceraldehyde-3-13C", () => {
    // The label is the only place a folded atom is drawn, so a CD3 spelled
    // "CH3" would state the wrong compound. Alanine's methyl carries three
    // drawn deuterium atoms, which valence counts in place of its implicit H.
    let alanine = load("l-alanine.mol");
    const deuterium: AtomId[] = [];
    for (let k = 0; k < 3; k++) {
      const added = addAtom(alanine, { element: "H", isotope: 2, pos: vec(3, k) });
      alanine = addBond(added.molecule, { from: "a3", to: added.id }).molecule;
      deuterium.push(added.id);
    }
    expect(implicitHydrogenCount(alanine, "a3")).toBe(0);
    const ala = layoutOf(project(alanine, stereoConfig(alanine), fischer(["a4", "a2", "a3"])));
    expect(ala.unplaced).toEqual([]);
    expect(sideOf(ala, "a2", "a1")).toBe("left");
    const methyl = ala.derivedNodes.find((n) => n.host === "a3")!;
    expect(methyl.id).toBe("a3.C2H3");
    expect(methyl.label).toEqual([
      { kind: "symbol", text: "C" },
      { kind: "mass", text: "2" },
      { kind: "symbol", text: "H" },
      { kind: "count", text: "3" },
    ]);
    expect(methyl.label[methyl.anchor]).toEqual({ kind: "symbol", text: "C" });
    expect(sourceAtomsOf(ala, methyl.id)).toEqual(["a3", ...deuterium]);

    // A 13C terminus keeps its mass number glued to the symbol on the node,
    // reading "¹³CH2OH" east and "HOH2¹³C" west.
    const glyceraldehyde = setIsotope(load("r-glyceraldehyde.mol"), "a5", 13);
    const layout = layoutOf(project(glyceraldehyde, stereoConfig(glyceraldehyde), fischer(["a2", "a3", "a5"])));
    expect(layout.unplaced).toEqual([]);
    expect(sideOf(layout, "a3", "a4")).toBe("right");
    const terminus = layout.derivedNodes.find((n) => n.host === "a5")!;
    expect(terminus.id).toBe("a5.13CH2OH");
    expect(terminus.label.map((p) => `${p.kind}:${p.text}`)).toEqual([
      "mass:13",
      "symbol:C",
      "symbol:H",
      "count:2",
      "symbol:O",
      "symbol:H",
    ]);
    expect(terminus.anchor).toBe(1);
    const group = condensedGroup(glyceraldehyde, "a5", "a3");
    if (group.kind !== "group") throw new Error(group.kind);
    expect(group.group.west.map((p) => p.text).join("")).toBe("HOH213C");
    expect(group.group.west[group.group.westAnchor]).toEqual({ kind: "symbol", text: "C" });
    expect(group.group.west[group.group.westAnchor - 1]).toEqual({ kind: "mass", text: "13" });
    // The unlabelled terminus is unchanged: no mass part, anchor 0.
    const plain = condensedGroup(load("r-glyceraldehyde.mol"), "a5", "a3");
    if (plain.kind !== "group") throw new Error(plain.kind);
    expect(plain.group.east.map((p) => p.text).join("")).toBe("CH2OH");
    expect(plain.group.eastAnchor).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Frames: resolution by atom-id set, choices, refusals that never throw
// ---------------------------------------------------------------------------

describe("frame resolution", () => {
  it("resolves a ring named by its atom-id set after an unrelated atom is added", () => {
    const mol = load("trans-1-2-dimethylcyclohexane.mol");
    const walk = rings(mol)[0]!.atomIds;
    const shuffled = [...walk].reverse();
    const before = resolveProjectionFrame(mol, ring(shuffled));
    expect(before).toMatchObject({ kind: "available", frame: { kind: "ring", ringAtomIds: walk } });

    // An unrelated atom on a methyl: new ids, new bonds, same ring.
    const methyl = mol.atomIds.find((id) => !walk.includes(id) && mol.atoms[id]!.element === "C")!;
    const added = addAtom(mol, { element: "Cl", pos: vec(9, 9) });
    const grown = addBond(added.molecule, { from: methyl, to: added.id }).molecule;
    expect(rings(grown)).toHaveLength(1);
    expect(resolveProjectionFrame(grown, ring(shuffled))).toEqual(before);
    // And the same set written in any order is one frame.
    expect(resolveProjectionFrame(grown, ring([...walk].sort()))).toEqual(before);
  });

  it("names a deleted atom as unavailable, and resolves ids of the prototype chain to nothing", () => {
    const mol = load("trans-1-2-dimethylcyclohexane.mol");
    const walk = rings(mol)[0]!.atomIds;
    const deleted = removeAtoms(mol, [walk[2]!]);
    expect(resolveProjectionFrame(deleted, ring(walk))).toEqual({
      kind: "unavailable",
      reason: "missing-atom",
      atomIds: [walk[2]],
      bondIds: [],
    });
    expect(project(deleted, stereoConfig(deleted), ring(walk))).toMatchObject({ reason: "missing-atom" });
    for (const name of ["constructor", "toString", "__proto__"]) {
      expect(resolveProjectionFrame(mol, ring([name]))).toMatchObject({ reason: "missing-atom", atomIds: [name] });
      expect(resolveProjectionFrame(mol, fischer([name, walk[0]!, walk[1]!]))).toMatchObject({
        reason: "missing-atom",
      });
      expect(
        resolveProjectionFrame(mol, {
          kind: "sightedBond",
          template: "newman",
          frame: { front: name, back: walk[0]! },
          params: { torsionDeg: 0, rollDeg: 0 },
        }),
      ).toMatchObject({ reason: "missing-atom" });
    }
  });

  it("asks which ring when three could be meant, listing each as a complete atom-id set", () => {
    const adenosine = load("adenosine.mol");
    expect(rings(adenosine)).toHaveLength(3);
    const choice = resolveProjectionFrame(adenosine, ring([]));
    expect(choice.kind).toBe("needsChoice");
    if (choice.kind !== "needsChoice") return;
    expect(choice.candidates).toHaveLength(3);
    expect(new Set(choice.candidates.map((c) => c.length))).toEqual(new Set([5, 6]));
    // A listed candidate, stored back, resolves to exactly itself.
    for (const candidate of choice.candidates) {
      expect(resolveProjectionFrame(adenosine, ring(candidate))).toMatchObject({
        kind: "available",
        frame: { ringAtomIds: candidate },
      });
    }
    // The fusion atom of the purine is in two rings; the ribose's oxygen in one.
    const fused = choice.candidates[0]!.find((id) => choice.candidates.filter((c) => c.includes(id)).length === 2);
    const fusion = fused ?? choice.candidates[1]!.find((id) => choice.candidates[2]!.includes(id))!;
    const two = resolveProjectionFrame(adenosine, ring([fusion]));
    expect(two).toMatchObject({ kind: "needsChoice" });
    if (two.kind === "needsChoice") expect(two.candidates).toHaveLength(2);
    const riboseOxygen = adenosine.atomIds.find(
      (id) => adenosine.atoms[id]!.element === "O" && choice.candidates.some((c) => c.includes(id)),
    )!;
    expect(resolveProjectionFrame(adenosine, ring([riboseOxygen]))).toMatchObject({ kind: "available" });
    // The same question twice gets the same list in the same order.
    expect(resolveProjectionFrame(adenosine, ring([]))).toEqual(choice);
  });

  it("offers only the rings that hold a named reference atom", () => {
    const adenosine = load("adenosine.mol");
    const all = resolveProjectionFrame(adenosine, ring([]));
    if (all.kind !== "needsChoice") throw new Error(all.kind);
    const holding = (id: AtomId) => all.candidates.filter((c) => c.includes(id));
    const riboseOnly = adenosine.atomIds.find((id) => holding(id).length === 1 && holding(id)[0]!.length === 5 &&
      holding(id)[0]!.some((a) => adenosine.atoms[a]!.element === "O"))!;
    // A reference atom in one ring settles the choice outright...
    expect(resolveProjectionFrame(adenosine, ring([], riboseOnly))).toMatchObject({
      kind: "available",
      frame: { kind: "ring", ringAtomIds: holding(riboseOnly)[0], referenceAtomId: riboseOnly },
    });
    // ...and one in two fused rings narrows it to those two, each of which,
    // chosen, resolves with that reference.
    const fusion = adenosine.atomIds.find((id) => holding(id).length === 2)!;
    const two = resolveProjectionFrame(adenosine, ring([], fusion));
    if (two.kind !== "needsChoice") throw new Error(two.kind);
    expect(two.candidates).toEqual(holding(fusion));
    for (const candidate of two.candidates) {
      expect(resolveProjectionFrame(adenosine, ring(candidate, fusion))).toMatchObject({
        kind: "available",
        frame: { referenceAtomId: fusion },
      });
    }
    // A reference in no ring the set allows is not a ring, with both named.
    const sugarRing = holding(riboseOnly)[0]!;
    expect(resolveProjectionFrame(adenosine, ring([sugarRing[0]!], fusion))).toMatchObject({
      kind: "unavailable",
      reason: "not-a-ring",
    });
  });

  it("resolves a sighted bond's stored references, and says when one falls back rather than refusing", () => {
    // (2R,3R)-2,3-dibromobutane seen down C2-C3: a2 front (CH3 a1, Br a3),
    // a4 back (Br a5, CH3 a6) — the textbook Newman.
    const mol = load("rr-2-3-dibromobutane.mol");
    expect(resolveProjectionFrame(mol, newman("a2", "a4", { frontReference: "a3", backReference: "a5" }))).toMatchObject({
      kind: "available",
      frame: { frontReference: "a3", backReference: "a5", referenceFallbacks: [] },
    });
    // Omitted: the lowest-id substituent of each end, and both reported.
    expect(resolveProjectionFrame(mol, newman("a2", "a4"))).toMatchObject({
      frame: {
        frontReference: "a1",
        backReference: "a5",
        referenceFallbacks: [
          { end: "front", reason: "omitted" },
          { end: "back", reason: "omitted" },
        ],
      },
    });
    // The back's bromine named as the FRONT reference is not a substituent of
    // the front atom; a prototype-chain name is no atom at all.
    for (const [name, reason] of [
      ["a5", "not-a-substituent"],
      ["constructor", "missing-atom"],
      ["__proto__", "missing-atom"],
    ] as const) {
      expect(resolveProjectionFrame(mol, newman("a2", "a4", { frontReference: name, backReference: "a6" }))).toMatchObject({
        kind: "available",
        frame: { frontReference: "a1", backReference: "a6", referenceFallbacks: [{ end: "front", reason }] },
      });
    }
    // A deleted reference turns the picture, never empties the panel.
    const debrominated = removeAtoms(mol, ["a3"]);
    expect(resolveProjectionFrame(debrominated, newman("a2", "a4", { frontReference: "a3", backReference: "a5" }))).toMatchObject({
      kind: "available",
      frame: { frontReference: "a1", backReference: "a5", referenceFallbacks: [{ end: "front", reason: "missing-atom" }] },
    });
    // An end with only implicit hydrogens beside the sighted bond has no
    // substituent to name, so the template's own hydrogen takes the place.
    // (R)-ethanol-1-d seen down C1-C2: a2 the CHD carbinol (D a3, O a4), a1
    // the methyl, which has nothing drawn but the sighted bond.
    const ethanol = load("chd-ethanol.mol");
    const sighted = resolveProjectionFrame(ethanol, newman("a2", "a1"));
    if (sighted.kind !== "available" || sighted.frame.kind !== "sightedBond") throw new Error(sighted.kind);
    expect(sighted.frame.frontReference).toBe("a3");
    expect(Object.hasOwn(sighted.frame, "backReference")).toBe(false);
    expect(sighted.frame.referenceFallbacks).toEqual([
      { end: "front", reason: "omitted" },
      { end: "back", reason: "omitted" },
    ]);
  });

  it("keeps a ring's chair conformer as view state that frame resolution never reads", () => {
    const glucose = load("beta-d-glucopyranose.mol");
    const walk = rings(glucose)[0]!.atomIds;
    const chair = (frontAtomId: AtomId): RingView => ({
      kind: "ring",
      template: "chair",
      frame: { ringAtomIds: walk },
      params: { face: "front", conformer: { form: "chair", frontAtomId } },
    });
    // A ring flip is the same panel naming a ring neighbour instead.
    const one = chair(walk[0]!);
    const flipped = chair(walk[1]!);
    expect(canonicalProjectionView(one)).toMatchObject({ params: { conformer: { form: "chair", frontAtomId: walk[0] } } });
    expect(canonicalProjectionView(flipped)).toMatchObject({ params: { conformer: { frontAtomId: walk[1] } } });
    const { conformer: _dropped, ...flat } = one.params;
    expect(canonicalProjectionView({ ...one, params: flat })).not.toHaveProperty("params.conformer");
    // Conformation, not topology: both conformers resolve to one frame.
    expect(resolveProjectionFrame(glucose, flipped)).toBe(resolveProjectionFrame(glucose, one));
    expect(project(glucose, stereoConfig(glucose), one)).toMatchObject({ reason: "template-not-built" });
  });

  it("covers a ring's centres and a sighted bond's two ends, and nothing else", () => {
    const glucose = load("beta-d-glucopyranose.mol");
    const ringAtoms = rings(glucose)[0]!.atomIds;
    expect(projectionCoverage(glucose, ring(ringAtoms))).toEqual({
      centres: ["a3", "a5", "a7", "a9", "a11"].filter((id) => ringAtoms.includes(id)),
      doubleBonds: [],
    });
    const dibromo = load("rr-2-3-dibromobutane.mol");
    expect(
      projectionCoverage(dibromo, {
        kind: "sightedBond",
        template: "newman",
        frame: { front: "a2", back: "a4" },
        params: { torsionDeg: 60, rollDeg: 0 },
      }),
    ).toEqual({ centres: ["a2", "a4"], doubleBonds: [] });
    expect(
      resolveProjectionFrame(dibromo, {
        kind: "sightedBond",
        template: "newman",
        frame: { front: "a1", back: "a4" },
        params: { torsionDeg: 0, rollDeg: 0 },
      }),
    ).toMatchObject({ kind: "unavailable", reason: "not-bonded" });
  });

  it("projects a template owed by a later task as template-not-built, after the frame resolves", () => {
    const glucose = load("beta-d-glucopyranose.mol");
    const ringAtoms = rings(glucose)[0]!.atomIds;
    expect(resolveProjectionFrame(glucose, ring(ringAtoms)).kind).toBe("available");
    expect(project(glucose, stereoConfig(glucose), ring(ringAtoms))).toMatchObject({
      kind: "unavailable",
      reason: "template-not-built",
    });
    const sighted = newman(ringAtoms[0]!, ringAtoms[1]!);
    expect(resolveProjectionFrame(glucose, sighted).kind).toBe("available");
    expect(project(glucose, stereoConfig(glucose), sighted)).toMatchObject({ reason: "template-not-built" });
    const planarView: ProjectionView = { kind: "planar", template: "mills", frame: {}, params: { rotationDeg: 0, mirror: false } };
    const unlisted = { ...planarView, template: "hexagram" } as unknown as ProjectionView;
    expect(project(glucose, stereoConfig(glucose), unlisted)).toMatchObject({ reason: "template-not-built" });
  });

  it("refuses an empty molecule, an unknown element, a non-finite angle and another molecule's configuration", () => {
    const empty = buildMolecule(() => undefined);
    expect(project(empty, stereoConfig(empty), planar())).toMatchObject({ reason: "empty-molecule" });
    const placeholder = buildMolecule((b) => {
      b.bond(b.atom("C", vec(0, 0)), b.atom("R", vec(1, 0)));
    });
    expect(project(placeholder, { centres: [], doubleBonds: [], unrepresentable: [] }, planar())).toMatchObject({
      reason: "unknown-element",
    });
    const glucose = load("d-glucose-open.mol");
    expect(project(glucose, stereoConfig(glucose), planar(Number.NaN))).toMatchObject({ reason: "invalid-parameter" });
    const alanine = load("l-alanine.mol");
    expect(project(glucose, stereoConfig(alanine), planar())).toMatchObject({
      kind: "unavailable",
      reason: "config-mismatch",
      atomIds: ["a2"],
    });
  });

  it("treats 370 and 10 degrees, and -60 and 300, as one view", () => {
    const mol = load("pentane-2r3s-diol.mol");
    const config = stereoConfig(mol);
    expect(project(mol, config, planar(370))).toBe(project(mol, config, planar(10)));
    expect(project(mol, config, planar(-60))).toBe(project(mol, config, planar(300)));
  });
});

describe("turning a panel (decision 209)", () => {
  it("adds to a planar panel's rotation, a steroid panel's too, and a full turn gives the view back", () => {
    const turned = rotateProjectionView(planar(350, true), 30);
    expect(turned).toEqual({ kind: "rotated", view: planar(20, true) });
    const steroid: PlanarView = {
      kind: "planar",
      template: "steroid",
      frame: {},
      params: { rotationDeg: 0, mirror: false, skeleton: { name: "steroid", core: ["a3", "a1", "a2"] } },
    };
    const quarter = rotateProjectionView(steroid, 90);
    expect(quarter.kind === "rotated" && quarter.view).toEqual({
      ...steroid,
      params: { ...steroid.params, rotationDeg: 90 },
    });
    expect(rotateProjectionView(planar(40), 360)).toEqual({ kind: "rotated", view: canonicalProjectionView(planar(40)) });
  });

  it("turns a Newman by its roll and never by its torsion, the two numbers decision 162 keeps apart", () => {
    const turned = rotateProjectionView(newman("a2", "a4"), -90);
    expect(turned.kind === "rotated" && turned.view.params).toEqual({ torsionDeg: 60, rollDeg: 270 });
  });

  it("turns a Fischer only by half turns: the other end on top, the same configuration", () => {
    const mol = load("d-glucose-open.mol");
    const config = stereoConfig(mol);
    const half = rotateProjectionView(fischer(GLUCOSE_BACKBONE), 180);
    expect(half).toEqual({ kind: "rotated", view: fischer(GLUCOSE_BACKBONE, "last") });
    if (half.kind !== "rotated") throw new Error("refused");
    expect(letters(mol, readBack(mol, layoutOf(project(mol, config, half.view))))).toEqual({
      a3: "R",
      a5: "S",
      a7: "R",
      a9: "R",
    });
    expect(rotateProjectionView(fischer(GLUCOSE_BACKBONE, "last"), -180)).toEqual({
      kind: "rotated",
      view: fischer(GLUCOSE_BACKBONE),
    });
    expect(rotateProjectionView(fischer(GLUCOSE_BACKBONE), 720)).toEqual({ kind: "rotated", view: fischer(GLUCOSE_BACKBONE) });
    // A quarter turn states the enantiomer at every centre (T1): refused by name.
    for (const degrees of [90, 270, -90, 45, 179.5]) {
      expect(rotateProjectionView(fischer(GLUCOSE_BACKBONE), degrees)).toEqual({
        kind: "refused",
        reason: "fischer-quarter-turn",
      });
    }
  });

  it("refuses a template with no page rotation yet, and an angle that is not a number", () => {
    const natta: ChainView = { ...fischer(GLUCOSE_BACKBONE), template: "natta" };
    const overlay: ProjectionView = { kind: "annotationOverlay", template: "torsion", frame: { bondIds: [] }, params: {} };
    for (const view of [natta, ring(["a1"]), { ...ring(["a1"]), template: "chair" as const }, overlay]) {
      expect(rotateProjectionView(view, 180)).toEqual({ kind: "refused", reason: "no-page-rotation" });
    }
    expect(rotateProjectionView(planar(), Number.NaN)).toEqual({ kind: "refused", reason: "invalid-parameter" });
    expect(rotateProjectionView(newman("a2", "a4"), Number.POSITIVE_INFINITY)).toEqual({
      kind: "refused",
      reason: "invalid-parameter",
    });
  });
});

// ---------------------------------------------------------------------------
// Determinism, provenance, scale, memoisation, collisions
// ---------------------------------------------------------------------------

describe("determinism", () => {
  it("emits byte-identical layouts from two independent runs, every tiebreak included", () => {
    const views: [string, ProjectionView][] = [
      ["d-glucose-open.mol", planar(37, true)],
      ["d-glucose-open.mol", fischer(GLUCOSE_BACKBONE)],
      ["2-deoxy-d-ribose-open.mol", fischer(["a2", "a3", "a4", "a6", "a8"], "last")],
      ["5alpha-androstane.mol", planar(123)],
    ];
    for (const [file, view] of views) {
      // Two molecules read separately: no shared instance, no shared result.
      const first = load(file);
      const second = load(file);
      const a = JSON.stringify(project(first, stereoConfig(first), view));
      const b = JSON.stringify(project(second, stereoConfig(second), view));
      expect(a).toBe(b);
      expect(a.length).toBeGreaterThan(200);
    }
  });

  it("orders nodes as source atoms in molecule order, then derived nodes by host", () => {
    const mol = load("d-glucose-open.mol");
    const layout = layoutOf(project(mol, stereoConfig(mol), fischer(GLUCOSE_BACKBONE)));
    expect(Object.keys(layout.positions)).toEqual([
      "a3",
      "a4",
      "a5",
      "a6",
      "a7",
      "a8",
      "a9",
      "a10",
      "a2.CHO",
      "a3.H",
      "a5.H",
      "a7.H",
      "a9.H",
      "a11.CH2OH",
    ]);
  });
});

describe("provenance", () => {
  it("is total over the layout's nodes and leads a condensed node back to every atom it folds", () => {
    for (const [file, view] of [
      ["d-glucose-open.mol", fischer(GLUCOSE_BACKBONE)],
      ["l-isoleucine.mol", fischer(["a7", "a5", "a3", "a2", "a1"])],
      ["5alpha-androstane.mol", planar(90, true)],
    ] as const) {
      const mol = load(file);
      const layout = layoutOf(project(mol, stereoConfig(mol), view));
      expect(Object.keys(layout.provenance)).toEqual(Object.keys(layout.positions));
      for (const [node, atoms] of Object.entries(layout.provenance)) {
        expect(atoms.length, node).toBeGreaterThan(0);
        for (const atomId of atoms) expect(Object.hasOwn(mol.atoms, atomId), `${node} -> ${atomId}`).toBe(true);
      }
      // Every atom of the projected molecule is drawn by exactly one node.
      expect(Object.keys(layout.drawnAs)).toEqual(mol.atomIds);
      for (const node of layout.derivedNodes) expect(Object.hasOwn(mol.atoms, node.id)).toBe(false);
    }
    const glucose = load("d-glucose-open.mol");
    const layout = layoutOf(project(glucose, stereoConfig(glucose), fischer(GLUCOSE_BACKBONE)));
    // Clicking the condensed CH2OH selects C6 AND O6; the CHO, C1 and its O.
    expect(sourceAtomsOf(layout, "a11.CH2OH")).toEqual(["a11", "a12"]);
    expect(sourceAtomsOf(layout, "a2.CHO")).toEqual(["a1", "a2"]);
    expect(layoutNodeOf(layout, "a12")).toBe("a11.CH2OH");
    expect(sourceAtomsOf(layout, "constructor")).toEqual([]);
    expect(layoutNodeOf(layout, "constructor")).toBeUndefined();
  });

  it("refuses a derived id a document already uses rather than colliding", () => {
    const base = buildMolecule((b) => {
      const c1 = b.atom("C", vec(0, 1));
      const c2 = b.atom("C", vec(0, 0));
      const c3 = b.atom("C", vec(0, -1));
      b.bond(c1, c2);
      b.bond(c2, c3);
      b.bond(c2, b.atom("O", vec(1, 0)), 1, "wedge");
      b.bond(c2, b.atom("Cl", vec(-1, 0)));
    });
    // A hand-edited file holding an atom literally called "a2.H" would clash
    // with C2's synthetic hydrogen, if C2 had one; a methyl's "a1.CH3" does.
    const rogue: Molecule = {
      ...base,
      atoms: { ...base.atoms, "a1.CH3": { ...base.atoms["a1"]!, id: "a1.CH3", pos: vec(5, 5) } },
      atomIds: [...base.atomIds, "a1.CH3"],
    };
    expect(project(rogue, stereoConfig(rogue), fischer(["a1", "a2", "a3"]))).toMatchObject({
      kind: "unavailable",
      reason: "id-conflict",
      atomIds: ["a1.CH3"],
    });
  });
});

describe("the shared bond scale (decision 145)", () => {
  it("draws a Fischer's rungs and arms at the same bond length as the planar panel of the same molecule", () => {
    // Drawn at 1.5 units per bond, as RDKit writes a molfile, so the shared
    // length is visibly not the house standard of 1.
    const mol = normalizeBondLength(load("d-glucose-open.mol"), 1.5);
    const b = medianBondLength(mol)!;
    expect(b).toBeCloseTo(1.5, 9);
    const flat = layoutOf(project(mol, stereoConfig(mol), planar(37)));
    const cross = layoutOf(project(mol, stereoConfig(mol), fischer(GLUCOSE_BACKBONE)));
    expect(flat.bondLength).toBe(b);
    expect(cross.bondLength).toBe(b);
    // The planar panel's own median bond, measured on its layout, is b.
    const lengths = flat.bonds.map((bond) => {
      const p = flat.positions[bond.from]!;
      const q = flat.positions[bond.to]!;
      return Math.sqrt((q.x - p.x) ** 2 + (q.y - p.y) ** 2);
    });
    lengths.sort((x, y) => x - y);
    expect(lengths[lengths.length >> 1]).toBeCloseTo(b, 9);
    // The Fischer's rung and arm are their characteristic multiples of it.
    const rung = cross.positions["a3"]!.y - cross.positions["a5"]!.y;
    expect(rung).toBeCloseTo(CHARACTERISTIC_LENGTHS.chain.rung * b, 12);
    expect(Math.abs(cross.positions["a3.H"]!.x)).toBeCloseTo(CHARACTERISTIC_LENGTHS.chain.arm * b, 12);

    // Rescale the drawing and the Fischer follows it.
    const unit = normalizeBondLength(mol, 1);
    const small = layoutOf(project(unit, stereoConfig(unit), fischer(GLUCOSE_BACKBONE)));
    expect(small.bondLength).toBeCloseTo(1, 9);
    expect(small.positions["a3"]!.y - small.positions["a5"]!.y).toBeCloseTo(CHARACTERISTIC_LENGTHS.chain.rung, 9);
  });
});

describe("memoisation", () => {
  it("recomputes the topology once over 40 re-projections, and returns the same result", () => {
    // D-ribose is projected as a Fischer nowhere else in this file, so the
    // first call really computes and the count is not a warm cache's zero.
    const mol = load("d-ribose-open.mol");
    const config = stereoConfig(mol);
    const view = fischer(["a2", "a3", "a5", "a7", "a9"]);
    resetProjectionTopologyComputationCount();
    const first = project(mol, config, view);
    expect(first.kind).toBe("available");
    for (let k = 0; k < 40; k++) expect(project(mol, config, fischer(["a2", "a3", "a5", "a7", "a9"]))).toBe(first);
    expect(projectionTopologyComputationCount()).toBe(1);
    // A fresh instance of the same drawing reuses the topology, not the result.
    const again = load("d-ribose-open.mol");
    const other = project(again, stereoConfig(again), view);
    expect(other).not.toBe(first);
    expect(other).toEqual(first);
    expect(projectionTopologyComputationCount()).toBe(1);
  });

  it("reuses the topology across a 40-frame drag and a 40-step turn of the page", () => {
    let mol = load("5alpha-androstane.mol");
    stereoConfig(mol);
    project(mol, stereoConfig(mol), planar());
    resetProjectionTopologyComputationCount();
    resetRingPerceptionComputationCount();
    resetStereoTopologyComputationCount();
    const dragged = mol.atomIds[3]!;
    for (let k = 0; k < 40; k++) {
      mol = setAtomPosition(mol, dragged, vec(mol.atoms[dragged]!.pos.x + 0.001, mol.atoms[dragged]!.pos.y));
      expect(project(mol, stereoConfig(mol), planar(k)).kind).toBe("available");
    }
    expect(projectionTopologyComputationCount()).toBe(0);
    expect(ringPerceptionComputationCount()).toBe(0);
    expect(stereoTopologyComputationCount()).toBe(0);
  });

  it("recomputes when the topology really changes", () => {
    const mol = load("r-glyceraldehyde.mol");
    project(mol, stereoConfig(mol), planar());
    resetProjectionTopologyComputationCount();
    const grown = addAtom(mol, { element: "C", pos: vec(9, 9) }).molecule;
    project(grown, stereoConfig(grown), planar());
    expect(projectionTopologyComputationCount()).toBe(1);
  });

  it("reuses a Fischer's topology across a 40-frame drag, while every frame gets its own layout", () => {
    // The planar drag above never exercises a template's resolve (it is a
    // constant there); a Fischer's condenses groups and names nodes, and a
    // drag produces a fresh molecule per pointer frame with only a position
    // changed, so it must reuse that work, not the previous frame's result.
    let mol = load("d-galactose-open.mol");
    const view = fischer(GLUCOSE_BACKBONE);
    let previous = project(mol, stereoConfig(mol), view);
    expect(previous.kind).toBe("available");
    resetProjectionTopologyComputationCount();
    for (let k = 0; k < 40; k++) {
      mol = setAtomPosition(mol, "a12", vec(mol.atoms["a12"]!.pos.x + 0.001, mol.atoms["a12"]!.pos.y));
      const next = project(mol, stereoConfig(mol), view);
      expect(next.kind).toBe("available");
      expect(next).not.toBe(previous);
      previous = next;
    }
    expect(projectionTopologyComputationCount()).toBe(0);
  });

  it("keeps a bounded number of views per configuration, so a page-turn gesture does not keep every frame", () => {
    const mol = load("pentane-2r3s-diol.mol");
    const config = stereoConfig(mol);
    const results = new Map<number, ProjectionResult>();
    for (let k = 1; k <= 40; k++) results.set(k, project(mol, config, planar(k)));
    // The most recent views are still the same objects...
    for (let k = 40; k > 40 - RESULTS_PER_CONFIGURATION; k--) {
      expect(project(mol, config, planar(k)), `${k} degrees`).toBe(results.get(k));
    }
    // ...and the first is recomputed: equal, but no longer kept.
    const again = project(mol, config, planar(1));
    expect(again).not.toBe(results.get(1));
    expect(again).toEqual(results.get(1));
  });
});

describe("collisions are reported, never nudged", () => {
  it("lists two atoms drawn on top of each other and leaves both where the author put them", () => {
    const mol = buildMolecule((b) => {
      const c1 = b.atom("C", vec(0, 0));
      const c2 = b.atom("C", vec(1, 0));
      b.bond(c1, c2);
      b.bond(c1, b.atom("O", vec(0.5, 0.8)));
      b.bond(c2, b.atom("O", vec(0.55, 0.82)));
    });
    const layout = layoutOf(project(mol, stereoConfig(mol), planar()));
    expect(layout.collisions).toHaveLength(1);
    expect(layout.collisions[0]).toMatchObject({ a: mol.atomIds[2], b: mol.atomIds[3] });
    for (const atomId of mol.atomIds) expect(layout.positions[atomId]).toEqual(mol.atoms[atomId]!.pos);
    const glucose = load("d-glucose-open.mol");
    expect(layoutOf(project(glucose, stereoConfig(glucose), fischer(GLUCOSE_BACKBONE))).collisions).toEqual([]);
  });
});

describe("the conformation step", () => {
  it("changes nothing on a frame whose conformation is fixed by convention, by reference", () => {
    const mol = load("meso-2-3-dibromobutane.mol");
    const layout = layoutOf(project(mol, stereoConfig(mol), planar(45)));
    expect(applyConformation(layout, { kind: "none" })).toBe(layout);
    expect(applyConformation(layout, { kind: "torsion", torsionDeg: 60 })).toBe(layout);
    expect(readBack(mol, applyConformation(layout, { kind: "torsion", torsionDeg: 180 }))).toEqual(readBack(mol, layout));
  });
});

describe("the engine's own sources", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => {
      // Code only: a comment is allowed to name what the code must not do.
      const text = readFileSync(join(dir, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      return [f, text] as const;
    });

  it("never scales to px, never negates a y, and never mints an id from the document counter", () => {
    expect(sources.map(([f]) => f)).toContain("engine.ts");
    for (const [file, code] of sources) {
      expect(code, file).not.toMatch(/bondLengthPx|modelToPx|pxPerModelUnit/);
      // A unary minus on a y: the flip belongs to chem-render's modelToPx alone.
      expect(code, file).not.toMatch(/(?:^|[=(,:?]|return)\s*-\s*[\w.]*\.y\b/m);
      expect(code, file).not.toMatch(/\bnextId\b/);
    }
  });

  it("names rings by atom set and never keeps an index into rings(mol)", () => {
    for (const [file, code] of sources) expect(code, file).not.toMatch(/rings\([^)]*\)\s*\[/);
  });

  it("scales by the bond length only lengths declared in CHARACTERISTIC_LENGTHS (decision 145)", () => {
    let scaled = 0;
    for (const [file, code] of sources) {
      for (const match of code.matchAll(/([\w.]+)\s*\*\s*(?:draft\.)?bondLength\b/g)) {
        scaled++;
        expect(match[1], `${file}: ${match[0]}`).toMatch(/^(?:CHARACTERISTIC_LENGTHS\.[\w.]+|LAYOUT_COLLISION_DISTANCE)$/);
      }
    }
    // The revealed hydrogen's length and clearance, and the collision distance.
    expect(scaled).toBeGreaterThanOrEqual(3);
  });
});

/** A finished layout as `placementOfLayout` reads it, as `readProjection` builds it. */
function accessOf(layout: ProjectedLayout): LayoutAccess {
  return {
    convention: layout.convention,
    position: (node) => layout.positions[node],
    nodeOf: (atomId) => layout.drawnAs[atomId],
    bondFor: (bondId) => layout.bonds.find((b) => b.sourceBondId === bondId),
    mark: (bondId) => layout.marks[bondId],
    hydrogenNodes: () => layout.derivedNodes.filter((node) => node.kind === "hydrogen"),
  };
}

describe("reading a layout", () => {
  it("reads the layout's own marks and positions, never the molecule's", () => {
    const mol = load("rr-tartaric-acid.mol");
    const config = stereoConfig(mol);
    const layout = layoutOf(project(mol, config, planar(180, true)));
    const placement = placementOfLayout(mol, accessOf(layout));
    for (const atomId of mol.atomIds) expect(placement.positions![atomId]).toEqual(layout.positions[atomId]);
    // Every source bond has an explicit mark entry, "none" included.
    expect(Object.keys(placement.marks!)).toEqual(mol.bondIds);
    expect(letters(mol, readBack(mol, layout))).toEqual({ a4: "R", a6: "R" });
  });

  it("reports units outside the coverage as absent, not undetermined", () => {
    const mol = load("d-glucose-open.mol");
    const config = stereoConfig(mol);
    const restricted = restrictStereoConfig(config, { centres: ["a5"], doubleBonds: [] });
    expect(restricted.centres.map((c) => c.atomId)).toEqual(["a5"]);
    // A configuration that mentions only C3, carried into a planar panel:
    // C3 is stated, and every other centre is unreported and unmarked.
    const layout = layoutOf(project(mol, restricted, planar()));
    expect(layout.coverage.centres).toEqual(["a5"]);
    expect(layout.unplaced.map((u) => u.reason)).toEqual([
      "unspecified-in-config",
      "unspecified-in-config",
      "unspecified-in-config",
    ]);
    expect(readBack(mol, layout).centres.map((c) => c.atomId)).toEqual(["a5"]);
    for (const [, mark] of Object.entries(layout.marks)) expect(mark.narrowEnd).toBe("a5");
  });

  it("reads a Fischer beside a second species drawn off the page axes, scoped to its coverage (decision 171)", () => {
    // A scheme is one Molecule: D-glucose with L-alanine drawn beside it.
    const glucose = load("d-glucose-open.mol");
    const alanine = load("l-alanine.mol");
    const { molecule: mol, atomIdMap } = insertFragment(glucose, alanine, { offset: vec(10, 0) });
    const alpha = atomIdMap.get(stereoConfig(alanine).centres[0]!.atomId)!;
    const config = stereoConfig(mol);
    // Every centre reads a letter before anything is projected.
    expect(letters(mol, config)).toEqual({ a3: "R", a5: "S", a7: "R", a9: "R", [alpha]: "S" });

    // Three of glucose's four crossings need their arms exchanged, so the
    // template's own read-back is exercised as well as the engine's.
    const layout = layoutOf(project(mol, config, fischer(GLUCOSE_BACKBONE)));
    expect(layout.unplaced).toEqual([]);
    expect(layout.coverage).toEqual({ centres: ["a3", "a5", "a7", "a9"], doubleBonds: [] });
    expect(letters(mol, readBack(mol, layout))).toEqual({ a3: "R", a5: "S", a7: "R", a9: "R" });

    // The layout draws no alanine atom and gives none a position, so each
    // keeps the molecule's own coordinates. Nothing parks them: only the
    // scope keeps alanine's off-axis bonds from refusing the whole reading.
    const placement = placementOfLayout(mol, accessOf(layout));
    for (const atomId of atomIdMap.values()) {
      expect(Object.hasOwn(layout.drawnAs, atomId), atomId).toBe(false);
      expect(Object.hasOwn(placement.positions!, atomId), atomId).toBe(false);
    }
    expect(readConfig(placement, layout.convention)).toEqual({
      kind: "unavailable",
      reason: "off-axis",
      atomIds: [alpha],
    });
    const scoped = readConfig(placement, layout.convention, layout.coverage);
    if (scoped.kind !== "read") throw new Error(`the scoped read refused: ${scoped.reason}`);
    expect(scoped.config.centres.find((c) => c.atomId === alpha)?.reading).toEqual({
      kind: "undetermined",
      reason: "not-covered",
    });
  });
});

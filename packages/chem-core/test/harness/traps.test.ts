/**
 * THE FRAME-AGNOSTIC TRAPS this task lands, against the planar frame and
 * against placements read through the fischer convention, plus the registry
 * of the traps it does not (T4, T5, T7).
 *
 *   T1  a Fischer turned a quarter turn in the page states the enantiomer at
 *       every centre, a half turn the same molecule; read back through the
 *       convention-aware reader, never by comparing coordinates. And turning
 *       a Fischer VIEW a quarter turn is refused by name (decision 209).
 *   T2  D-glyceraldehyde as a bare Fischer reads (R); the same drawing read
 *       with the wedge/hash convention does NOT: a convention-blind reader
 *       would report "no stereochemistry" at every centre of glucose and make
 *       every later round trip pass vacuously.
 *   T3  each of the six pairwise transpositions at a centre inverts it; a
 *       3-cycle holding one group fixed preserves it.
 *   T6  a mirror image inverts every tetrahedral parity and no cis/trans
 *       relation: R and S swap (r and s do not: they are reflection-
 *       invariant), E and Z stay. Achirality is proved per atom, under the
 *       automorphism `isAchiral` returns, never by comparing letter sets.
 *
 * Every trap is read from geometry the test changed, never from the model's
 * own wedges, and every baseline is asserted to be a letter first.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isAchiral } from "../../src/achirality.js";
import { bondBetween } from "../../src/molecule.js";
import { project, readProjection } from "../../src/projection/engine.js";
import { rotateProjectionView, stereoDisagreements } from "../../src/projection/frames.js";
import type { ChainView, PlanarView, ProjectedLayout } from "../../src/projection/types.js";
import {
  readConfig,
  stereoConfig,
  type CentreConfig,
  type PlacedHydrogen,
  type PlacedMark,
  type Placement,
  type StereoConfig,
} from "../../src/stereo-config.js";
import type { AtomId, BondStereo, Molecule } from "../../src/types.js";
import type { Vec2 } from "../../src/vec.js";
import { HARNESS_FIXTURES, fixtureName, loadFixture, viewFor, type HarnessFixture } from "./fixtures.js";
import {
  doubleBondLetters,
  isLetter,
  letters,
  matrixRows,
  mergeReadings,
  mirrorLetter,
  pick,
  readBack,
  reflectLayout,
  relations,
  rowName,
  scopedTo,
  turnLayout,
  withConvention,
  type Row,
} from "./law.js";
import { OWED_TRAPS } from "./traps.js";

type Built = Extract<Row, { status: "built" }>;
const BUILT = matrixRows().filter((row): row is Built => row.status === "built");
const FISCHERS = BUILT.filter((row) => row.key === "chain/fischer" && row.layout.coverage.centres.length > 0);

function fixture(file: string): HarnessFixture {
  return HARNESS_FIXTURES.find((f) => f.file === file)!;
}

function built(file: string, key: Built["key"]): Built {
  return BUILT.find((row) => row.fixture.file === file && row.key === key)!;
}

function parityOf(config: StereoConfig, atomId: AtomId): number | undefined {
  const reading = config.centres.find((c) => c.atomId === atomId)?.reading;
  return reading?.kind === "specified" ? reading.parity : undefined;
}

/** The model's configuration with every tetrahedral parity negated: its mirror image. */
function inverted(config: StereoConfig): StereoConfig {
  return {
    ...config,
    centres: config.centres.map(
      (c): CentreConfig =>
        c.reading.kind === "specified" ? { ...c, reading: { kind: "specified", parity: c.reading.parity === 1 ? -1 : 1 } } : c,
    ),
  };
}

// ---------------------------------------------------------------------------
// T1
// ---------------------------------------------------------------------------

describe("T1: a Fischer turned in the page", () => {
  it("has a Fischer row with centres for every sugar, amino acid and scheme the matrix declares one for", () => {
    expect(FISCHERS.length).toBeGreaterThanOrEqual(22);
  });

  for (const row of FISCHERS) {
    it(`${rowName(row)}: a quarter turn inverts every centre, a half turn none`, () => {
      const mol = loadFixture(row.fixture);
      const config = stereoConfig(mol);
      expect(row.layout.convention.kind).toBe("fischer");
      const base = readBack(mol, row.layout);
      const baseLetters = pick(letters(mol, mergeReadings(config, base)), row.layout.coverage.centres);
      for (const letter of Object.values(baseLetters)) expect(isLetter(letter)).toBe(true);
      for (const degrees of [90, 180, 270, 360]) {
        // Still on the page axes, so the fischer reader reads it rather than refusing.
        const read = readBack(mol, turnLayout(row.layout, degrees));
        const quarter = degrees % 180 === 90;
        for (const atomId of row.layout.coverage.centres) {
          expect(parityOf(read, atomId), `${degrees} ${atomId}`).toBe((quarter ? -1 : 1) * parityOf(base, atomId)!);
        }
        const model = quarter ? inverted(config) : config;
        const turned = pick(letters(mol, mergeReadings(model, read)), row.layout.coverage.centres);
        expect(turned, `${degrees}`).toEqual(
          quarter ? Object.fromEntries(Object.entries(baseLetters).map(([id, l]) => [id, mirrorLetter(l)])) : baseLetters,
        );
      }
    });
  }

  it("turns D-glucose a quarter turn into L-glucose's letters, which is why it is refused", () => {
    const d = built("d-glucose-open.mol", "chain/fischer");
    const l = loadFixture(fixture("l-glucose-open.mol"));
    const mol = loadFixture(d.fixture);
    const read = readBack(mol, turnLayout(d.layout, 90));
    // The two files number their atoms alike (both RDKit from one SMILES shape).
    expect(letters(mol, mergeReadings(inverted(stereoConfig(mol)), read))).toEqual(letters(l, stereoConfig(l)));
    expect(letters(l, stereoConfig(l))).toEqual({ a3: "S", a5: "R", a7: "S", a9: "S" });
  });

  it("refuses to turn a Fischer VIEW a quarter turn, by name, and turns it a half turn into the other end on top", () => {
    const d = built("d-glucose-open.mol", "chain/fischer");
    const view = d.view as ChainView;
    for (const degrees of [90, 270, -90, 30]) {
      expect(rotateProjectionView(view, degrees)).toEqual({ kind: "refused", reason: "fischer-quarter-turn" });
    }
    const half = rotateProjectionView(view, 180);
    if (half.kind !== "rotated") throw new Error("a half turn was refused");
    expect(half.view).toEqual({ ...view, params: { top: "last" } });
    const mol = loadFixture(d.fixture);
    const again = project(mol, stereoConfig(mol), half.view);
    if (again.kind !== "available") throw new Error(again.kind);
    expect(letters(mol, readBack(mol, again.layout))).toEqual({ a3: "R", a5: "S", a7: "R", a9: "R" });
  });
});

// ---------------------------------------------------------------------------
// T2
// ---------------------------------------------------------------------------

/**
 * D-glyceraldehyde as a bare Fischer cross, built by hand: C2 (a3) at the
 * crossing, CHO (a2) up, CH2OH (a5) down, OH (a4) right, H left. No wedge
 * anywhere; the cross is the whole statement.
 */
function bareFischer(mol: Molecule, slots: Readonly<Record<"up" | "down" | "left" | "right", string>>): Placement {
  const at: Record<string, Vec2> = { up: { x: 0, y: 1 }, down: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
  const positions: Record<AtomId, Vec2> = { a3: { x: 0, y: 0 } };
  const hydrogens: Record<AtomId, PlacedHydrogen> = {};
  for (const [slot, ligand] of Object.entries(slots)) {
    if (ligand === "H") hydrogens["a3"] = { position: at[slot]!, stereo: "none" };
    else positions[ligand] = at[slot]!;
  }
  const marks: Record<string, PlacedMark> = {};
  for (const bondId of mol.bondIds) marks[bondId] = { stereo: "none", narrowEnd: mol.bonds[bondId]!.from };
  return { mol, positions, marks, hydrogens };
}

const D_GLYCERALDEHYDE_CROSS = { up: "a2", down: "a5", left: "H", right: "a4" } as const;

describe("T2: the convention is part of the reading", () => {
  it("reads D-glyceraldehyde as a bare Fischer cross as (R), and the same drawing under wedge/hash as nothing", () => {
    const mol = loadFixture(fixture("r-glyceraldehyde.mol"));
    expect(letters(mol, stereoConfig(mol))).toEqual({ a3: "R" });
    const cross = bareFischer(mol, D_GLYCERALDEHYDE_CROSS);
    const fischer = readConfig(cross, { kind: "fischer" }, { centres: ["a3"] });
    if (fischer.kind !== "read") throw new Error(fischer.reason);
    expect(letters(mol, fischer.config)).toEqual({ a3: "R" });

    // The negative control: the SAME placement, read as if its lines were
    // wedge-and-hash bonds, does not match the model.
    const blind = readConfig(cross, { kind: "wedgeHash" }, { centres: ["a3"] });
    if (blind.kind !== "read") throw new Error(blind.reason);
    expect(letters(mol, blind.config)).not.toEqual({ a3: "R" });
    expect(stereoDisagreements(stereoConfig(mol), blind.config, { centres: ["a3"], doubleBonds: [] })).toEqual([
      { kind: "centre", atomId: "a3" },
    ]);
  });

  for (const row of FISCHERS) {
    it(`${rowName(row)}: the template's cross, read under wedge/hash, states none of its centres`, () => {
      const mol = loadFixture(row.fixture);
      const blind = readProjection(mol, withConvention(row.layout, { kind: "wedgeHash" }));
      if (blind.kind !== "read") throw new Error(blind.reason);
      expect(stereoDisagreements(stereoConfig(mol), blind.config, row.layout.coverage)).toHaveLength(
        row.layout.coverage.centres.length,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// T3
// ---------------------------------------------------------------------------

/** Every pair of slot indices, and every 3-cycle that holds one slot fixed. */
const TRANSPOSITIONS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 3],
];
const THREE_CYCLES: readonly (readonly [number, number, number])[] = [0, 1, 2, 3].flatMap((fixed) => {
  const [a, b, c] = [0, 1, 2, 3].filter((i) => i !== fixed) as [number, number, number];
  return [
    [a, b, c],
    [a, c, b],
  ] as const;
});

function transposed<T>(items: readonly T[], [i, j]: readonly [number, number]): T[] {
  const out = [...items];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

function cycled<T>(items: readonly T[], [i, j, k]: readonly [number, number, number]): T[] {
  const out = [...items];
  [out[i], out[j], out[k]] = [items[k]!, items[i]!, items[j]!];
  return out;
}

/**
 * (R)-glyceraldehyde's C2 (a3) drawn with its four ligands in four SLOTS,
 * two in the plane and a wedge and a hash side by side: a slot is a place
 * and a mark, so moving a ligand to another slot moves its mark with it.
 */
const WEDGE_SLOTS: readonly { readonly pos: Vec2; readonly stereo: BondStereo }[] = [
  { pos: { x: -0.866, y: -0.5 }, stereo: "none" },
  { pos: { x: 0.866, y: -0.5 }, stereo: "none" },
  { pos: { x: -0.259, y: 0.966 }, stereo: "wedge" },
  { pos: { x: 0.259, y: 0.966 }, stereo: "hash" },
];

function wedgePlacement(mol: Molecule, ligands: readonly string[]): Placement {
  const positions: Record<AtomId, Vec2> = { a3: { x: 0, y: 0 } };
  const marks: Record<string, PlacedMark> = {};
  const hydrogens: Record<AtomId, PlacedHydrogen> = {};
  ligands.forEach((ligand, slot) => {
    const { pos, stereo } = WEDGE_SLOTS[slot]!;
    if (ligand === "H") hydrogens["a3"] = { position: pos, stereo };
    else {
      positions[ligand] = pos;
      marks[bondBetween(mol, "a3", ligand)!.id] = { stereo, narrowEnd: "a3" };
    }
  });
  return { mol, positions, marks, hydrogens };
}

function fischerPlacement(mol: Molecule, ligands: readonly string[]): Placement {
  const [up, down, left, right] = ligands as [string, string, string, string];
  return bareFischer(mol, { up, down, left, right });
}

function readA3(placement: Placement, convention: "wedgeHash" | "fischer"): number | undefined {
  const read = readConfig(placement, { kind: convention }, { centres: ["a3"] });
  if (read.kind !== "read") throw new Error(read.reason);
  return parityOf(read.config, "a3");
}

describe("T3: transpositions at a centre", () => {
  const mol = loadFixture(fixture("r-glyceraldehyde.mol"));
  const LIGANDS = ["a2", "a5", "H", "a4"] as const;

  for (const [name, convention, place] of [
    ["a hand-built Fischer cross", "fischer", fischerPlacement],
    ["a hand-built wedge-and-hash drawing", "wedgeHash", wedgePlacement],
  ] as const) {
    it(`${name}: all six transpositions invert C2, all eight 3-cycles keep it`, () => {
      const base = readA3(place(mol, LIGANDS), convention);
      expect(base === 1 || base === -1).toBe(true);
      for (const pair of TRANSPOSITIONS) {
        expect(readA3(place(mol, transposed(LIGANDS, pair)), convention), `swap ${pair}`).toBe(-base!);
      }
      for (const cycle of THREE_CYCLES) {
        expect(readA3(place(mol, cycled(LIGANDS, cycle)), convention), `cycle ${cycle}`).toBe(base);
      }
      // And the base drawing is D-glyceraldehyde either way: (R). In the
      // wedge drawing the H is the wedge, toward the viewer, and OH, CHO,
      // CH2OH run counter-clockwise as seen, so clockwise from behind.
      const read = readConfig(place(mol, LIGANDS), { kind: convention }, { centres: ["a3"] });
      if (read.kind !== "read") throw new Error(read.reason);
      expect(letters(mol, read.config)).toEqual({ a3: "R" });
    });
  }

  it("the planar frame's own layout: exchanging two drawn ligands' places and marks inverts C2, cycling all three keeps it", () => {
    const row = built("r-glyceraldehyde.mol", "planar/wedgeDash");
    const layout = scopedTo(row.layout, ["a3"]);
    const drawn = ["a2", "a4", "a5"];
    const lineTo = (atomId: string) => row.layout.bonds.find((b) => b.sourceBondId === bondBetween(mol, "a3", atomId)!.id)!.id;
    /** The layout with `order[i]` moved into the slot `drawn[i]` held. */
    const moved = (order: readonly string[]): ProjectedLayout => {
      const positions = { ...layout.positions };
      const marks: Record<string, ProjectedLayout["marks"][string]> = { ...layout.marks };
      drawn.forEach((slot, i) => {
        positions[order[i]!] = layout.positions[slot]!;
        const mark = layout.marks[lineTo(slot)];
        if (mark === undefined) delete marks[lineTo(order[i]!)];
        else marks[lineTo(order[i]!)] = mark;
      });
      return { ...layout, positions, marks };
    };
    const base = parityOf(readBack(mol, layout), "a3")!;
    expect(letters(mol, readBack(mol, layout))).toEqual({ a3: "R" });
    for (const pair of [[0, 1], [0, 2], [1, 2]] as const) {
      expect(parityOf(readBack(mol, moved(transposed(drawn, pair))), "a3"), `swap ${pair}`).toBe(-base);
    }
    for (const cycle of [[0, 1, 2], [0, 2, 1]] as const) {
      expect(parityOf(readBack(mol, moved(cycled(drawn, cycle))), "a3"), `cycle ${cycle}`).toBe(base);
    }
  });
});

// ---------------------------------------------------------------------------
// T6
// ---------------------------------------------------------------------------

describe("T6: the mirror image", () => {
  for (const row of BUILT.filter((r) => r.layout.coverage.centres.length + r.layout.coverage.doubleBonds.length > 0)) {
    it(`${rowName(row)}: inverts every parity and no cis/trans; R and S swap, r, s, E and Z stay`, () => {
      const mol = loadFixture(row.fixture);
      const config = stereoConfig(mol);
      const base = readBack(mol, row.layout);
      const mirror = readBack(mol, reflectLayout(row.layout));
      for (const atomId of row.layout.coverage.centres) {
        expect(parityOf(mirror, atomId), atomId).toBe(-parityOf(base, atomId)!);
      }
      expect(relations(mirror)).toEqual(relations(base));
      const baseLetters = pick(letters(mol, mergeReadings(config, base)), row.layout.coverage.centres);
      const mirrorLetters = pick(letters(mol, mergeReadings(inverted(config), mirror)), row.layout.coverage.centres);
      expect(mirrorLetters).toEqual(Object.fromEntries(Object.entries(baseLetters).map(([id, l]) => [id, mirrorLetter(l)])));
      const bonds = row.layout.coverage.doubleBonds;
      expect(pick(doubleBondLetters(mol, mergeReadings(inverted(config), mirror)), bonds)).toEqual(
        pick(doubleBondLetters(mol, mergeReadings(config, base)), bonds),
      );
    });
  }

  it("is not the planar panel's own mirror, which re-poses the same molecule", () => {
    for (const row of BUILT.filter((r) => r.key === "planar/wedgeDash" || r.key === "planar/mills")) {
      const mol = loadFixture(row.fixture);
      const view = row.view as PlanarView;
      const turned = project(mol, stereoConfig(mol), { ...view, params: { ...view.params, mirror: true } });
      if (turned.kind !== "available") throw new Error(`${rowName(row)}: ${turned.kind}`);
      expect(stereoDisagreements(stereoConfig(mol), readBack(mol, turned.layout), turned.layout.coverage), rowName(row)).toEqual([]);
    }
    // The steroid panel refuses to be mirrored at all (decision 187).
    const steroid = built("cholesterol.mol", "planar/steroid");
    const view = steroid.view as PlanarView;
    const mol = loadFixture(steroid.fixture);
    expect(project(mol, stereoConfig(mol), { ...view, params: { ...view.params, mirror: true } })).toMatchObject({
      kind: "unavailable",
      reason: "mirror-not-drawn",
    });
  });

  const ACHIRAL: readonly [string, "achiral" | "chiral"][] = [
    ["meso-tartaric-acid.mol", "achiral"],
    ["pentane-2r3s-diol.mol", "chiral"],
    ["rr-tartaric-acid.mol", "chiral"],
    ["meso-2-3-dibromobutane.mol", "achiral"],
    ["rr-2-3-dibromobutane.mol", "chiral"],
    ["ribaric-acid.mol", "achiral"],
    ["cis-1-2-dimethylcyclohexane.mol", "achiral"],
    ["trans-1-2-dimethylcyclohexane.mol", "chiral"],
    ["syndiotactic-pentamer.mol", "chiral"],
  ];

  for (const [file, verdict] of ACHIRAL) {
    it(`${file} is ${verdict}, proved atom by atom on the mirror image of its projections`, () => {
      const mol = loadFixture(fixture(file));
      const config = stereoConfig(mol);
      const result = isAchiral(mol);
      expect(result.kind).toBe(verdict);
      // Descriptor multisets cannot tell these apart: meso-tartaric acid and
      // (2R,3S)-pentane-2,3-diol are both {R, S}, and so are their mirror
      // images. The map from atom to atom is what decides.
      for (const row of BUILT.filter((r) => r.fixture.file === file && r.layout.coverage.centres.length > 0)) {
        const baseLetters = letters(mol, mergeReadings(config, readBack(mol, row.layout)));
        const mirror = letters(mol, mergeReadings(inverted(config), readBack(mol, reflectLayout(row.layout))));
        if (result.kind === "achiral") {
          for (const atomId of row.layout.coverage.centres) {
            const image = result.mapping.get(atomId)!;
            expect(mirror[image], `${rowName(row)}: σ(${atomId}) = ${image}`).toBe(baseLetters[atomId]);
          }
        } else {
          // No symmetry maps the mirror image back: the identity does not.
          expect(pick(mirror, row.layout.coverage.centres), rowName(row)).not.toEqual(pick(baseLetters, row.layout.coverage.centres));
        }
      }
    });
  }

  it("maps meso-tartaric acid's C2 onto C3 and (2R,3S)-pentane-2,3-diol's onto nothing", () => {
    const tartaric = isAchiral(loadFixture(fixture("meso-tartaric-acid.mol")));
    if (tartaric.kind !== "achiral") throw new Error(tartaric.kind);
    expect(tartaric.mapping.get("a4")).toBe("a6");
    expect(tartaric.mapping.get("a6")).toBe("a4");
    expect(isAchiral(loadFixture(fixture("pentane-2r3s-diol.mol")))).toEqual({ kind: "chiral" });
  });
});

// ---------------------------------------------------------------------------
// T4, T5, T7: owed by later tasks
// ---------------------------------------------------------------------------

const CHEM_CORE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("the traps owed by later tasks (T4, T5, T7)", () => {
  for (const owed of OWED_TRAPS) {
    const mol = loadFixture(owed.probe);
    const chosen = viewFor(owed.probe, mol, owed.template);
    if (chosen.kind !== "view") throw new Error(`${owed.trap}: ${fixtureName(owed.probe)} declares no ${owed.template} frame`);
    const result = project(mol, stereoConfig(mol), chosen.view);
    const pending = result.kind === "unavailable" && result.reason === "template-not-built";
    const label = `${owed.trap}, owed by ${owed.owner} (${owed.template}): ${owed.statement}`;
    if (pending) {
      it.todo(`${label} — pending while ${owed.template} projects template-not-built`);
    } else if (owed.landedIn === undefined) {
      it(label, () => {
        expect.fail(
          `${owed.template} now projects ${fixtureName(owed.probe)} (${result.kind}) but ${owed.trap} has not landed: ` +
            `${owed.owner} lands it and sets landedIn in test/harness/traps.ts`,
        );
      });
    } else {
      it(`${label} — landed in ${owed.landedIn}`, () => {
        const file = join(CHEM_CORE, owed.landedIn!);
        expect(existsSync(file), file).toBe(true);
        expect(readFileSync(file, "utf8")).toContain(owed.trap);
      });
    }
  }

  it("names each owed trap's owner as a task of the projection epic, and leaves none unowned", () => {
    expect(OWED_TRAPS.map((t) => t.trap)).toEqual(["T4", "T5", "T7"]);
    const owners = OWED_TRAPS.map((t) => t.owner);
    expect(owners).toEqual([
      "chair-conformers-fused-systems-and-depth-rendering",
      "torsion-conformer-newman-and-sawhorse",
      "fischer-and-haworth-projections",
    ]);
  });
});

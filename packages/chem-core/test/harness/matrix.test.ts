/**
 * THE PROJECTION ROUND-TRIP INVARIANT MATRIX: every fixture against every
 * listed template, generated, so a thirteenth projection adds a column and
 * every ordered pair of frames is exercised for free.
 *
 *   the law        read(project(M, C, F)) restricted to the layout's coverage
 *                  equals C restricted the same way, and the CIP descriptors
 *                  (R/S and E/Z) agree there; `unplaced` is empty and the
 *                  coverage is the frame's whole reach (decision 146), so a
 *                  layout that placed nothing cannot pass
 *   cross-ports    for every ordered pair of built frames of a fixture, the
 *                  configuration read from F1's layout, projected into F2 and
 *                  read back, agrees on coverage(F1) ∩ coverage(F2)
 *   negative law   read(applyConformation(L, k)) = read(L) for every k
 *   marks          one mark per centre, none between two centres, none
 *                  touching an atom twice, on every Mills and steroid panel
 *                  and wherever the writer draws the marks; a wedge-dash
 *                  panel keeps the author's own (decision 148)
 *
 * A LISTED TEMPLATE THAT IS NOT BUILT IS A PENDING ROW, never an absent one:
 * a todo here and a line in the golden, and the whole law the day `project`
 * returns a layout for it, with no edit to this file.
 *
 * Chemistry only. The pictures are chem-render's goldens, drawn from the
 * golden this file writes, so a hexagon-aspect tweak never reads as a
 * stereochemistry regression here.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { setBondStereo } from "../../src/ops.js";
import { applyConformation, project, readProjection } from "../../src/projection/engine.js";
import type { Conformation, ProjectedLayout } from "../../src/projection/types.js";
import { stereoConfig, stereoTopology } from "../../src/stereo-config.js";
import type { Molecule } from "../../src/types.js";
import { HARNESS_FIXTURES, TEMPLATE_KEYS, fixtureName, loadFixture } from "./fixtures.js";
import {
  crossPort,
  doubleBondLetters,
  isLetter,
  lawOutcome,
  letters,
  matrixRows,
  readBack,
  relations,
  rowName,
  type Row,
} from "./law.js";

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), "__golden__", "matrix.json");

const ROWS = matrixRows();
type Built = Extract<Row, { status: "built" }>;
const BUILT = ROWS.filter((row): row is Built => row.status === "built");

// ---------------------------------------------------------------------------
// The law, one row at a time
// ---------------------------------------------------------------------------

/** Every conformation a panel can ask for, the ones no built template moves included. */
function conformationsOf(layout: ProjectedLayout, mol: Molecule): readonly Conformation[] {
  const ringAtom = mol.atomIds[0]!;
  void layout;
  return [
    { kind: "none" },
    { kind: "torsion", torsionDeg: 0 },
    { kind: "torsion", torsionDeg: 60 },
    { kind: "torsion", torsionDeg: 180 },
    { kind: "torsion", torsionDeg: 299.5 },
    { kind: "ringConformer", conformer: { form: "chair", frontAtomId: ringAtom } },
  ];
}

describe("the round-trip law, per row", () => {
  for (const row of ROWS) {
    switch (row.status) {
      case "built":
        it(`${rowName(row)}: states its whole reach and reads the configuration back`, () => {
          const mol = loadFixture(row.fixture);
          const config = stereoConfig(mol);
          // Descriptors are letters before anything is compared.
          for (const letter of Object.values(letters(mol, config))) expect(isLetter(letter)).toBe(true);

          const outcome = lawOutcome(mol, row.view, row.layout);
          expect(outcome.unplaced).toEqual([]);
          expect(outcome.coverage).toEqual(outcome.reach);
          expect(outcome.disagreements).toEqual([]);
          expect(outcome.readLetters).toEqual(outcome.expectedLetters);
          for (const letter of Object.values(outcome.readLetters)) expect(isLetter(letter)).toBe(true);
          expect(outcome.readRelations).toEqual(outcome.expectedRelations);
          expect(outcome.readBondLetters).toEqual(outcome.expectedBondLetters);
          for (const letter of Object.values(outcome.readBondLetters)) expect(["E", "Z"]).toContain(letter);
        });
        it(`${rowName(row)}: no conformation changes what it states (the negative law)`, () => {
          const mol = loadFixture(row.fixture);
          const config = stereoConfig(mol);
          const read = readBack(mol, row.layout);
          for (const k of conformationsOf(row.layout, mol)) {
            expect(readBack(mol, applyConformation(row.layout, k)), JSON.stringify(k)).toEqual(read);
            const again = project(mol, config, row.view, k);
            if (again.kind !== "available") throw new Error(`${JSON.stringify(k)}: ${again.kind}`);
            expect(readBack(mol, again.layout), JSON.stringify(k)).toEqual(read);
          }
        });
        break;
      case "pending":
        it.todo(`${rowName(row)}: owed, the template projects template-not-built; the law runs here the day it projects`);
        break;
      case "refused":
        it(`${rowName(row)}: refused for a reason the template documents and the fixture table declares`, () => {
          expect(row.result.kind === "unavailable" ? row.result.reason : row.result.kind).toBe(row.declared);
        });
        break;
      case "not-applicable":
        break;
    }
  }

  it("leaves no listed template without a row, and runs the law on every built template", () => {
    expect(ROWS).toHaveLength(HARNESS_FIXTURES.length * TEMPLATE_KEYS.length);
    const built = new Set(BUILT.map((row) => row.key));
    // Today's four; a template that lands joins this list by projecting.
    expect([...built].sort()).toEqual(["chain/fischer", "planar/mills", "planar/steroid", "planar/wedgeDash"]);
    for (const key of TEMPLATE_KEYS.filter((k) => !built.has(k))) {
      const rows = ROWS.filter((row) => row.key === key);
      // An unbuilt template's rows are pending wherever a frame is declared:
      // never silently absent, never passed.
      expect(rows.some((row) => row.status === "pending"), key).toBe(true);
      expect(rows.every((row) => row.status === "pending" || row.status === "not-applicable"), key).toBe(true);
    }
  });

  it("is not vacuous: most rows state something, and every fixture with a unit is stated somewhere", () => {
    const stated = BUILT.filter((row) => row.layout.coverage.centres.length + row.layout.coverage.doubleBonds.length > 0);
    expect(stated.length).toBeGreaterThan(100);
    for (const fixture of HARNESS_FIXTURES) {
      const config = stereoConfig(loadFixture(fixture));
      const units = config.centres.length + config.doubleBonds.length;
      const covered = BUILT.filter((row) => row.fixture === fixture).some(
        (row) => row.layout.coverage.centres.length + row.layout.coverage.doubleBonds.length === units,
      );
      expect(covered, fixtureName(fixture)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-ports: every ordered pair of built frames
// ---------------------------------------------------------------------------

interface CrossPortRecord {
  readonly fixture: string;
  readonly from: string;
  readonly to: string;
  readonly centres: number;
  readonly doubleBonds: number;
}

const CROSS_PORTS: CrossPortRecord[] = [];

describe("cross-ports: configuration carried from F1 to F2 agrees on coverage(F1) ∩ coverage(F2)", () => {
  for (const fixture of HARNESS_FIXTURES) {
    const built = BUILT.filter((row) => row.fixture === fixture);
    for (const from of built) {
      for (const to of built) {
        if (from === to) continue;
        const mol = loadFixture(fixture);
        const carried = crossPort(mol, from, to);
        CROSS_PORTS.push({
          fixture: fixtureName(fixture),
          from: from.key,
          to: to.key,
          centres: carried.carried.length,
          doubleBonds: carried.carriedBonds.length,
        });
        it(`${fixtureName(fixture)}: ${from.key} -> ${to.key}`, () => {
          expect(carried.lost).toEqual([]);
        });
      }
    }
  }

  it("carries real units: every Fischer centre survives the trip to a planar panel and back", () => {
    const fischerToPlanar = CROSS_PORTS.filter((c) => c.from === "chain/fischer" && c.to === "planar/wedgeDash");
    expect(fischerToPlanar.length).toBeGreaterThan(15);
    for (const port of fischerToPlanar) {
      const fischer = BUILT.find((row) => fixtureName(row.fixture) === port.fixture && row.key === "chain/fischer")!;
      expect(port.centres, port.fixture).toBe(fischer.layout.coverage.centres.length);
    }
    expect(CROSS_PORTS.reduce((total, c) => total + c.centres, 0)).toBeGreaterThan(300);
  });
});

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

/** Every way the layout's marks break decision 178's policy, as sentences. */
function markViolations(mol: Molecule, layout: ProjectedLayout): string[] {
  const centres = new Set(stereoTopology(mol).centres.map((c) => c.atomId));
  const out: string[] = [];
  const perCentre = new Map<string, number>();
  const touched = new Map<string, number>();
  for (const [lineId, mark] of Object.entries(layout.marks)) {
    // The crossed double bond states "geometry unknown" and is no centre mark.
    if (mark.stereo === "either") continue;
    const line = layout.bonds.find((b) => b.id === lineId)!;
    const far = line.from === mark.narrowEnd ? line.to : line.from;
    if (!centres.has(mark.narrowEnd)) out.push(`${lineId} is narrow at ${mark.narrowEnd}, which is no centre`);
    if (centres.has(far)) out.push(`${lineId} joins two centres, ${mark.narrowEnd} and ${far}`);
    perCentre.set(mark.narrowEnd, (perCentre.get(mark.narrowEnd) ?? 0) + 1);
    for (const node of [line.from, line.to]) touched.set(node, (touched.get(node) ?? 0) + 1);
  }
  for (const [centre, count] of perCentre) if (count > 1) out.push(`${centre} carries ${count} marks`);
  for (const [node, count] of touched) if (count > 1) out.push(`${node} is touched by ${count} marks`);
  return out;
}

/** The drawing with every wedge, hash and wavy line removed. */
function bare(mol: Molecule): Molecule {
  let out = mol;
  for (const bondId of mol.bondIds) {
    const stereo = mol.bonds[bondId]!.stereo;
    if (stereo === "wedge" || stereo === "hash" || stereo === "wavy") out = setBondStereo(out, bondId, "none");
  }
  return out;
}

describe("marks: one per centre, none between two centres, none touching an atom twice", () => {
  for (const row of BUILT.filter((r) => r.key === "planar/mills" || r.key === "planar/steroid")) {
    it(`${rowName(row)}: every mark is the writer's and keeps the policy`, () => {
      expect(markViolations(loadFixture(row.fixture), row.layout)).toEqual([]);
    });
  }

  for (const row of BUILT.filter((r) => r.key === "planar/wedgeDash")) {
    it(`${rowName(row)}: keeps every author mark, and marks the writer puts on the bare drawing keep the policy`, () => {
      const mol = loadFixture(row.fixture);
      // Decision 148: the author's marks, exactly as drawn.
      const authored = Object.fromEntries(
        mol.bondIds
          .filter((id) => mol.bonds[id]!.stereo !== "none")
          .map((id) => [id, { stereo: mol.bonds[id]!.stereo, narrowEnd: mol.bonds[id]!.from }]),
      );
      expect(row.layout.marks).toEqual(authored);
      // The writer's own, where the drawing says nothing (decision 178).
      const drawing = bare(mol);
      const written = project(drawing, stereoConfig(mol), row.view);
      if (written.kind !== "available") throw new Error(written.kind);
      expect(written.layout.unplaced).toEqual([]);
      expect(markViolations(drawing, written.layout)).toEqual([]);
      const read = readProjection(drawing, written.layout);
      if (read.kind !== "read") throw new Error(read.reason);
      expect(letters(drawing, read.config)).toEqual(letters(mol, stereoConfig(mol)));
    });
  }

  it("keeps cortisol's RDKit mark between two centres on the wedge-dash panel, and writes none on its steroid and Mills panels", () => {
    const rows = BUILT.filter((row) => row.fixture.file === "cortisol.mol");
    const mol = loadFixture(rows[0]!.fixture);
    const between = (layout: ProjectedLayout) =>
      markViolations(mol, layout).filter((sentence) => sentence.includes("joins two centres"));
    expect(between(rows.find((r) => r.key === "planar/wedgeDash")!.layout)).not.toEqual([]);
    expect(between(rows.find((r) => r.key === "planar/steroid")!.layout)).toEqual([]);
    expect(between(rows.find((r) => r.key === "planar/mills")!.layout)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The golden: the matrix as data
// ---------------------------------------------------------------------------

describe("the matrix golden", () => {
  it("records every row, what it states and why a row states nothing", async () => {
    const fixtures = HARNESS_FIXTURES.map((fixture) => {
      const mol = loadFixture(fixture);
      const config = stereoConfig(mol);
      return {
        fixture: fixtureName(fixture),
        family: fixture.family,
        letters: letters(mol, config),
        doubleBonds: doubleBondLetters(mol, config),
        ...(config.unrepresentable.length === 0 ? {} : { unrepresentable: config.unrepresentable.map((u) => u.kind) }),
      };
    });
    const rows = ROWS.map((row) => {
      const base = { fixture: fixtureName(row.fixture), template: row.key, status: row.status };
      switch (row.status) {
        case "built": {
          const mol = loadFixture(row.fixture);
          const outcome = lawOutcome(mol, row.view, row.layout);
          return {
            ...base,
            view: row.view,
            coverage: row.layout.coverage,
            letters: outcome.readLetters,
            doubleBonds: outcome.readBondLetters,
            marks: Object.keys(row.layout.marks).length,
            derivedNodes: row.layout.derivedNodes.map((n) => n.id),
            collisions: row.layout.collisions.length,
          };
        }
        case "pending":
          return { ...base, view: row.view };
        case "refused":
          return { ...base, view: row.view, reason: row.result.kind === "unavailable" ? row.result.reason : row.result.kind };
        case "not-applicable":
          return { ...base, why: row.why };
      }
    });
    const golden = { fixtures, rows, crossPorts: CROSS_PORTS };
    await expect(`${JSON.stringify(golden, null, 2)}\n`).toMatchFileSnapshot(GOLDEN);
  });

  it("relations read by the golden are the model's own", () => {
    // A guard on the golden's inputs: the fixture letters it records are the
    // drawn molecule's, not a read-back's.
    for (const fixture of HARNESS_FIXTURES) {
      const mol = loadFixture(fixture);
      expect(Object.keys(relations(stereoConfig(mol)))).toEqual(stereoConfig(mol).doubleBonds.map((b) => b.bondId));
    }
  });
});

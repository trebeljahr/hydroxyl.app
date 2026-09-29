/**
 * The Mills template (decisions 164 and 180): rings re-laid as regular
 * polygons, marks written after the layout, the document never touched.
 *
 * Asserted on the RDKit reference set and the steroids. Descriptors are
 * letters before anything is projected, and every layout must place every
 * unit, so a panel that stated nothing cannot pass.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readMolblock } from "../molblock-read.js";
import { setAtomPosition } from "../ops.js";
import { compareIds } from "../selection.js";
import { rings, ringMembership } from "../rings.js";
import { descriptorFromConfig, stereoConfig, type StereoConfig } from "../stereo-config.js";
import type { AtomId, Molecule } from "../types.js";
import { project, readProjection } from "./engine.js";
import type { PlanarView, ProjectedLayout, ProjectionResult } from "./types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures");

function load(dir: "projection" | "steroid", file: string): Molecule {
  return readMolblock(readFileSync(join(ROOT, dir, file), "utf8")).molecule;
}

const FIXTURES: readonly (readonly ["projection" | "steroid", string])[] = [
  ...readdirSync(join(ROOT, "projection"))
    .filter((f) => f.endsWith(".mol"))
    .sort()
    .map((f) => ["projection", f] as const),
  ...readdirSync(join(ROOT, "steroid"))
    .filter((f) => f.endsWith(".mol") && f !== "ent-kaurene.mol")
    .sort()
    .map((f) => ["steroid", f] as const),
];

function mills(rotationDeg = 0, mirror = false): PlanarView {
  return { kind: "planar", template: "mills", frame: {}, params: { rotationDeg, mirror } };
}

function layoutOf(result: ProjectionResult): ProjectedLayout {
  if (result.kind !== "available") throw new Error(`not available: ${JSON.stringify(result)}`);
  return result.layout;
}

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

function distance(p: { x: number; y: number }, q: { x: number; y: number }): number {
  return Math.hypot(q.x - p.x, q.y - p.y);
}

/** Every ring's bonds are b long and its atoms equidistant from its centre. */
function expectRegularRings(mol: Molecule, layout: ProjectedLayout): void {
  const b = layout.bondLength;
  for (const ring of rings(mol)) {
    const points = ring.atomIds.map((id) => layout.positions[id]!);
    for (let i = 0; i < points.length; i++) {
      expect(distance(points[i]!, points[(i + 1) % points.length]!), `${ring.atomIds.join(",")} edge ${i}`).toBeCloseTo(b, 9);
    }
    const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
    const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
    const r = b / (2 * Math.sin(Math.PI / points.length));
    for (const p of points) expect(distance(p, { x: cx, y: cy })).toBeCloseTo(r, 9);
  }
}

describe("the Mills template on the reference set", () => {
  for (const [dir, file] of FIXTURES) {
    it(`${dir}/${file}: regular rings, marks after the layout, the drawn molecule's descriptors`, () => {
      const mol = load(dir, file);
      const config = stereoConfig(mol);
      const before = letters(mol, config);
      for (const letter of Object.values(before)) expect(letter).toMatch(/^[RSrs]$/);
      for (const b of config.doubleBonds) expect(b.reading.kind).toBe("specified");
      const drawn = JSON.stringify(mol);

      const layout = layoutOf(project(mol, config, mills()));
      expect(layout.template).toBe("mills");
      expect(layout.unplaced).toEqual([]);
      expect(layout.coverage.centres).toEqual(config.centres.map((c) => c.atomId));
      const read = readProjection(mol, layout);
      if (read.kind !== "read") throw new Error("refused");
      expect(letters(mol, read.config)).toEqual(before);
      expect(relations(read.config)).toEqual(relations(config));
      expectRegularRings(mol, layout);
      // A view: the document's geometry is exactly as drawn afterwards.
      expect(JSON.stringify(mol)).toBe(drawn);
    });
  }
});

describe("what Mills keeps and what it changes", () => {
  it("straightens a squashed ring and still states trans-1,2-dimethylcyclohexane", () => {
    const drawn = load("projection", "trans-1-2-dimethylcyclohexane.mol");
    // The ring drawn in perspective: every y halved.
    let squashed = drawn;
    for (const id of drawn.atomIds) {
      const p = drawn.atoms[id]!.pos;
      squashed = setAtomPosition(squashed, id, { x: p.x, y: p.y / 2 });
    }
    const config = stereoConfig(drawn);
    expect(letters(drawn, config)).toEqual({ a2: "S", a7: "S" });
    const layout = layoutOf(project(squashed, config, mills()));
    expect(layout.unplaced).toEqual([]);
    expectRegularRings(squashed, layout);
    const read = readProjection(squashed, layout);
    if (read.kind !== "read") throw new Error("refused");
    expect(letters(squashed, read.config)).toEqual({ a2: "S", a7: "S" });
  });

  it("keeps each substituent's drawn direction and length from its ring atom", () => {
    const mol = load("steroid", "cholesterol.mol");
    const layout = layoutOf(project(mol, stereoConfig(mol), mills()));
    const membership = ringMembership(mol);
    const inRing = (id: AtomId) => (membership.atoms[id] ?? []).length > 0;
    let checked = 0;
    for (const bondId of mol.bondIds) {
      const bond = mol.bonds[bondId]!;
      if (inRing(bond.from) === inRing(bond.to)) continue;
      const [ringAtom, sub] = inRing(bond.from) ? [bond.from, bond.to] : [bond.to, bond.from];
      const drawnVector = {
        x: mol.atoms[sub]!.pos.x - mol.atoms[ringAtom]!.pos.x,
        y: mol.atoms[sub]!.pos.y - mol.atoms[ringAtom]!.pos.y,
      };
      const laid = {
        x: layout.positions[sub]!.x - layout.positions[ringAtom]!.x,
        y: layout.positions[sub]!.y - layout.positions[ringAtom]!.y,
      };
      expect(laid.x).toBeCloseTo(drawnVector.x, 9);
      expect(laid.y).toBeCloseTo(drawnVector.y, 9);
      checked++;
    }
    // C3-O, C10-C19, C13-C18, C17-C20.
    expect(checked).toBe(4);
  });

  it("turns and mirrors the re-laid page without changing a descriptor", () => {
    const mol = load("steroid", "testosterone.mol");
    const config = stereoConfig(mol);
    const before = letters(mol, config);
    for (const view of [mills(90), mills(200, true)]) {
      const layout = layoutOf(project(mol, config, view));
      expect(layout.unplaced).toEqual([]);
      const read = readProjection(mol, layout);
      if (read.kind !== "read") throw new Error("refused");
      expect(letters(mol, read.config)).toEqual(before);
      expectRegularRings(mol, layout);
    }
  });

  it("refuses a bridged ring system, naming its rings, rather than draw one that is not regular", () => {
    // ent-kaurene: rings of 6, 6, 6 and 5, the last two sharing two bonds.
    const mol = load("steroid", "ent-kaurene.mol");
    expect(rings(mol).map((r) => r.size).sort()).toEqual([5, 6, 6, 6]);
    const result = project(mol, stereoConfig(mol), mills());
    expect(result.kind).toBe("unavailable");
    if (result.kind !== "unavailable") return;
    expect(result.reason).toBe("bridged-ring-system");
    // The bicyclo[3.2.1]octane: eight atoms.
    expect(result.atomIds).toHaveLength(8);
  });

  it("measures a peri-fused system and refuses one whose polygons do not close, naming it (decision 186)", () => {
    const millsFixture = (file: string) => readMolblock(readFileSync(join(ROOT, "mills", file), "utf8")).molecule;
    // Pyrene's four hexagons tile the plane: every ring comes out regular.
    const pyrene = millsFixture("pyrene.mol");
    const laid = layoutOf(project(pyrene, stereoConfig(pyrene), mills()));
    expect(rings(pyrene)).toHaveLength(4);
    expectRegularRings(pyrene, laid);
    // Acenaphthene's five-membered ring cannot sit on naphthalene's peri
    // position as a regular pentagon; cubane's squares cannot lie flat.
    for (const [file, atoms] of [["acenaphthene.mol", 12], ["cubane.mol", 8]] as const) {
      const mol = millsFixture(file);
      const result = project(mol, stereoConfig(mol), mills());
      expect(result, file).toMatchObject({ kind: "unavailable", reason: "no-regular-layout" });
      // Every atom of either is in the ring system, and all are named.
      if (result.kind === "unavailable") expect(result.atomIds, file).toEqual([...mol.atomIds].sort(compareIds));
      expect(mol.atomIds, file).toHaveLength(atoms);
    }
  });

  it("emits the same bytes from two independent loads", () => {
    const one = layoutOf(project(load("steroid", "cholesterol.mol"), stereoConfig(load("steroid", "cholesterol.mol")), mills(30)));
    const again = load("steroid", "cholesterol.mol");
    const two = layoutOf(project(again, stereoConfig(again), mills(30)));
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
  });
});

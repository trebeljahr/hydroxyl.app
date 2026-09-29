/**
 * The wedge-placement policy (decision 178), asserted on real molecules: the
 * RDKit reference set, and the steroids, whose ring-fusion centres are where
 * a careless policy puts a wedge on a ring bond or between two centres.
 *
 * Every molecule is asked to state its OWN configuration from a drawing with
 * every centre mark stripped, so each mark in the layout is one the writer
 * chose. Descriptors are asserted to be letters before anything is compared.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { bondBetween } from "../molecule.js";
import { readMolblock } from "../molblock-read.js";
import { setBondStereo } from "../ops.js";
import { ringMembership } from "../rings.js";
import { descriptorFromConfig, stereoConfig, stereoTopology, type StereoConfig } from "../stereo-config.js";
import type { AtomId, Molecule } from "../types.js";
import { project, readProjection } from "./engine.js";
import { derivedBondId, hydrogenNodeId, sourceAtomsOf } from "./nodes.js";
import { CHARACTERISTIC_LENGTHS, type PlanarView, type ProjectedLayout } from "./types.js";

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
    .filter((f) => f.endsWith(".mol"))
    .sort()
    .map((f) => ["steroid", f] as const),
];

const WEDGE_DASH: PlanarView = { kind: "planar", template: "wedgeDash", frame: {}, params: { rotationDeg: 0, mirror: false } };

/** The drawing with every wedge, hash and wavy line removed: positions only. */
function bare(mol: Molecule): Molecule {
  let out = mol;
  for (const bondId of mol.bondIds) {
    const stereo = mol.bonds[bondId]!.stereo;
    if (stereo === "wedge" || stereo === "hash" || stereo === "wavy") out = setBondStereo(out, bondId, "none");
  }
  return out;
}

function layoutOf(mol: Molecule, config: StereoConfig, view: PlanarView = WEDGE_DASH): ProjectedLayout {
  const result = project(mol, config, view);
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

/** Each mark's two layout nodes, by line id. */
function ends(layout: ProjectedLayout, lineId: string): readonly [string, string] {
  const line = layout.bonds.find((b) => b.id === lineId)!;
  return [line.from, line.to];
}

describe("the wedge-placement policy on a drawing with no marks", () => {
  for (const [dir, file] of FIXTURES) {
    it(`${dir}/${file}: states every centre with one mark each, never between two centres`, () => {
      const mol = load(dir, file);
      const config = stereoConfig(mol);
      const before = letters(mol, config);
      for (const letter of Object.values(before)) expect(letter).toMatch(/^[RSrs]$/);

      const drawing = bare(mol);
      const layout = layoutOf(drawing, config);
      expect(layout.unplaced).toEqual([]);
      expect(layout.coverage.centres).toEqual(config.centres.map((c) => c.atomId));
      const read = readProjection(drawing, layout);
      if (read.kind !== "read") throw new Error("refused");
      expect(letters(drawing, read.config)).toEqual(before);

      const centres = new Set(stereoTopology(mol).centres.map((c) => c.atomId));
      const perCentre = new Map<string, number>();
      const touchedBy = new Map<string, number>();
      for (const [lineId, mark] of Object.entries(layout.marks)) {
        if (mark.stereo === "either") continue;
        const [from, to] = ends(layout, lineId);
        const far = from === mark.narrowEnd ? to : from;
        // Narrow end at a centre; never a centre at the wide end.
        expect(centres.has(mark.narrowEnd), `${lineId} narrow end`).toBe(true);
        expect(centres.has(far), `${lineId} joins two centres`).toBe(false);
        perCentre.set(mark.narrowEnd, (perCentre.get(mark.narrowEnd) ?? 0) + 1);
        for (const node of [from, to]) touchedBy.set(node, (touchedBy.get(node) ?? 0) + 1);
      }
      for (const [centre, count] of perCentre) expect(count, centre).toBe(1);
      // No atom at either end of two marks: a gem-disubstituted carbon is
      // never wedged twice.
      for (const [node, count] of touchedBy) expect(count, node).toBe(1);
    });
  }
});

describe("which bond the policy picks", () => {
  it("puts a fused ring system's marks on its methyls and its revealed hydrogens, never on a ring bond", () => {
    // RDKit drew 5alpha-androstane's four ring-fusion hydrogens as wedges on
    // RING bonds; the policy moves every one off the rings.
    const mol = load("projection", "5alpha-androstane.mol");
    expect(mol.bondIds.filter((id) => mol.bonds[id]!.stereo !== "none" && (ringMembership(mol).bonds[id] ?? []).length > 0))
      .not.toEqual([]);
    const layout = layoutOf(bare(mol), stereoConfig(mol));
    const membership = ringMembership(mol);
    for (const lineId of Object.keys(layout.marks)) {
      expect((membership.bonds[lineId] ?? []).length, lineId).toBe(0);
    }
    // a2 and a15 carry the two angular methyls (C13 and C10); the other four
    // centres are CH and show their hydrogen.
    const revealed = layout.derivedNodes.filter((n) => n.kind === "hydrogen").map((n) => n.host);
    expect(revealed).toEqual(["a6", "a7", "a10", "a16"]);
    expect(layout.marks[bondBetween(mol, "a2", "a1")!.id]?.narrowEnd).toBe("a2");
    expect(layout.marks[bondBetween(mol, "a15", "a19")!.id]?.narrowEnd).toBe("a15");
  });

  it("reveals a hydrogen one bond length out, in the widest gap, as a node of its centre", () => {
    const mol = load("projection", "5alpha-androstane.mol");
    const layout = layoutOf(bare(mol), stereoConfig(mol));
    const b = layout.bondLength;
    for (const host of ["a6", "a7", "a10", "a16"]) {
      const node = hydrogenNodeId(host, 0);
      expect(sourceAtomsOf(layout, node)).toEqual([host]);
      const at = layout.positions[node]!;
      const centre = layout.positions[host]!;
      expect(Math.hypot(at.x - centre.x, at.y - centre.y)).toBeCloseTo(CHARACTERISTIC_LENGTHS.planar.revealedHydrogen * b, 9);
      // On the bisector of the widest gap between the centre's drawn bonds.
      const angle = (p: { x: number; y: number }) => Math.atan2(p.y - centre.y, p.x - centre.x);
      const bonds = mol.bondIds
        .map((id) => mol.bonds[id]!)
        .filter((bond) => bond.from === host || bond.to === host)
        .map((bond) => angle(layout.positions[bond.from === host ? bond.to : bond.from]!))
        .sort((p, q) => p - q);
      const gaps = bonds.map((from, i) => {
        const to = i + 1 < bonds.length ? bonds[i + 1]! : bonds[0]! + 2 * Math.PI;
        return { from, width: to - from };
      });
      const h = angle(at);
      const own = gaps.find((g) => ((h - g.from + 4 * Math.PI) % (2 * Math.PI)) < g.width)!;
      expect(own.width).toBeGreaterThanOrEqual(Math.max(...gaps.map((g) => g.width)) - 1e-6);
      expect(((h - own.from + 4 * Math.PI) % (2 * Math.PI))).toBeCloseTo(own.width / 2, 9);
      const mark = layout.marks[derivedBondId(node)]!;
      expect(mark.narrowEnd).toBe(host);
      expect(["wedge", "hash"]).toContain(mark.stereo);
      expect(layout.depth[derivedBondId(node)]).toBe(mark.stereo === "wedge" ? "front" : "back");
    }
  });

  it("gives 17alpha-methyltestosterone's gem-disubstituted C17 one mark, on one of its two terminal groups", () => {
    const mol = load("steroid", "methyltestosterone.mol");
    const config = stereoConfig(mol);
    const c17 = config.centres.find((c) => {
      const neighbours = c.order.filter((id) => mol.bonds[bondBetween(mol, c.atomId, id)!.id] !== undefined);
      return neighbours.some((id) => mol.atoms[id]!.element === "O");
    })!.atomId;
    const layout = layoutOf(bare(mol), config);
    const atC17 = Object.entries(layout.marks).filter(([lineId]) => ends(layout, lineId).includes(c17));
    expect(atC17).toHaveLength(1);
    const [lineId, mark] = atC17[0]!;
    expect(mark.narrowEnd).toBe(c17);
    const [from, to] = ends(layout, lineId);
    const far = from === c17 ? to : from;
    // The methyl or the hydroxyl: terminal, so rank 1, never the ring.
    expect(mol.bondIds.filter((id) => mol.bonds[id]!.from === far || mol.bonds[id]!.to === far)).toHaveLength(1);
  });

  it("keeps an author's mark and writes only where the drawing says nothing", () => {
    // Glucose with ONE of its four wedges removed: three kept as drawn, one
    // written.
    const mol = load("projection", "d-glucose-open.mol");
    const marked = mol.bondIds.filter((id) => mol.bonds[id]!.stereo !== "none");
    expect(marked.length).toBe(4);
    const drawing = setBondStereo(mol, marked[0]!, "none");
    const layout = layoutOf(drawing, stereoConfig(mol));
    expect(layout.unplaced).toEqual([]);
    for (const id of marked.slice(1)) {
      expect(layout.marks[id]).toEqual({ stereo: mol.bonds[id]!.stereo, narrowEnd: mol.bonds[id]!.from });
    }
    expect(Object.keys(layout.marks)).toHaveLength(4);
  });
});

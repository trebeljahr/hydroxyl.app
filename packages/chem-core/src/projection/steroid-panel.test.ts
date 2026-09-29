/**
 * The steroid panel and a planar panel's accepted skeleton (decisions 163,
 * 181, 182), on the PubChem steroids of test/fixtures/steroid.
 *
 * Every centre's letter is asserted before a layout runs (steroid.test.ts
 * pins them against RDKit), every layout must place every unit, and the
 * wedge/hash assertions are made against the FACES read from the
 * configuration, so a panel that drew beta as a hash cannot pass by
 * agreeing with itself.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { bondBetween } from "../molecule.js";
import { readMolblock } from "../molblock-read.js";
import { removeAtoms, setAtomPosition } from "../ops.js";
import { suggestSteroidSkeleton } from "../skeleton/steroid.js";
import type { AcceptedSkeleton } from "../skeleton/table.js";
import { descriptorFromConfig, stereoConfig, stereoTopology, type StereoConfig } from "../stereo-config.js";
import { rotateAtoms } from "../transform.js";
import type { AtomId, Molecule } from "../types.js";
import { project, readProjection } from "./engine.js";
import { canonicalProjectionView, restrictStereoConfig } from "./frames.js";
import { derivedBondId, hydrogenNodeId } from "./nodes.js";
import type { PlanarView, ProjectedLayout, ProjectionResult } from "./types.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures", "steroid");

function load(file: string): Molecule {
  return readMolblock(readFileSync(join(FIXTURES, file), "utf8")).molecule;
}

const STEROIDS = [
  "cholesterol.mol",
  "testosterone.mol",
  "estradiol.mol",
  "5alpha-cholestane.mol",
  "5beta-cholestane.mol",
  "cortisol.mol",
  "methyltestosterone.mol",
  "abiraterone.mol",
  "cholesteryl-alpha-d-glucopyranoside.mol",
] as const;

function accept(mol: Molecule): AcceptedSkeleton {
  const suggestion = suggestSteroidSkeleton(mol);
  if (suggestion.kind !== "match") throw new Error(`no match: ${JSON.stringify(suggestion)}`);
  return suggestion.skeleton;
}

function view(template: PlanarView["template"], skeleton?: AcceptedSkeleton, rotationDeg = 0, mirror = false): PlanarView {
  return {
    kind: "planar",
    template,
    frame: {},
    params: skeleton === undefined ? { rotationDeg, mirror } : { rotationDeg, mirror, skeleton },
  };
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

/** "17β-OH" as chem-render will print it, for readable pins. */
function labelTexts(layout: ProjectedLayout): string[] {
  return layout.faceLabels.map(
    (l) => `${l.locant}${l.face === "alpha" ? "α" : "β"}${l.group === undefined ? "" : `-${l.group}`}`,
  );
}

describe("the steroid template", () => {
  it("is unavailable until a skeleton is accepted, and names the atoms of one that no longer fits", () => {
    const mol = load("testosterone.mol");
    expect(project(mol, stereoConfig(mol), view("steroid"))).toMatchObject({
      kind: "unavailable",
      reason: "skeleton-not-accepted",
    });
    const accepted = accept(mol);
    // C-18 deleted: the core still fits, only the numbering shrinks.
    const noMethyl = removeAtoms(mol, ["a1"]);
    expect(project(noMethyl, stereoConfig(noMethyl), view("steroid", accepted)).kind).toBe("available");
    // C-16 deleted: ring D is broken and the acceptance is stale.
    const c16 = accepted.core[15]!;
    const broken = removeAtoms(mol, [c16]);
    const stale = project(broken, stereoConfig(broken), view("steroid", accepted));
    expect(stale).toMatchObject({ kind: "unavailable", reason: "skeleton-mismatch" });
    if (stale.kind === "unavailable") expect(stale.atomIds).toContain(c16);
    // The same acceptance on a wedge-dash panel is refused the same way.
    expect(project(broken, stereoConfig(broken), view("wedgeDash", accepted))).toMatchObject({
      reason: "skeleton-mismatch",
    });
  });

  for (const file of STEROIDS) {
    it(`${file}: standard orientation, every centre stated, beta a wedge and alpha a hash`, () => {
      const mol = load(file);
      const config = stereoConfig(mol);
      const before = letters(mol, config);
      for (const letter of Object.values(before)) expect(letter).toMatch(/^[RSrs]$/);
      const accepted = accept(mol);
      const layout = layoutOf(project(mol, config, view("steroid", accepted)));
      expect(layout.template).toBe("steroid");
      expect(layout.unplaced).toEqual([]);
      const read = readProjection(mol, layout);
      if (read.kind !== "read") throw new Error("refused");
      expect(letters(mol, read.config)).toEqual(before);

      // Rings A to D left to right, ring C above ring B.
      const at = (locant: number) => layout.positions[accepted.core[locant - 1]!]!;
      const centroid = (locants: readonly number[]) => ({
        x: locants.reduce((s, l) => s + at(l).x, 0) / locants.length,
        y: locants.reduce((s, l) => s + at(l).y, 0) / locants.length,
      });
      const [a, b, c, d] = [[1, 2, 3, 4, 5, 10], [5, 6, 7, 8, 9, 10], [8, 9, 11, 12, 13, 14], [13, 14, 15, 16, 17]].map(centroid);
      expect(a!.x).toBeLessThan(b!.x);
      expect(b!.x).toBeLessThan(c!.x);
      expect(c!.x).toBeLessThan(d!.x);
      expect(c!.y).toBeGreaterThan(b!.y);

      // Each mark at a core centre is a wedge exactly when the ligand it
      // points to is beta. The faces come from the configuration, the marks
      // from read-back: two routes that must agree.
      const core = new Set(accepted.core);
      const centres = new Set(stereoTopology(mol).centres.map((c) => c.atomId));
      const faces = new Map<string, string>();
      for (const label of layout.faceLabels) {
        const key = label.ligand.kind === "atom" ? label.ligand.atomId : hydrogenNodeId(label.atomId, 0);
        faces.set(`${label.atomId}>${key}`, label.face);
      }
      let checked = 0;
      for (const [lineId, mark] of Object.entries(layout.marks)) {
        if (mark.stereo === "either" || !core.has(mark.narrowEnd)) continue;
        const line = layout.bonds.find((l) => l.id === lineId)!;
        const far = line.from === mark.narrowEnd ? line.to : line.from;
        expect(centres.has(far), `${lineId} joins two centres`).toBe(false);
        const face = faces.get(`${mark.narrowEnd}>${far}`);
        if (face === undefined) continue;
        expect(mark.stereo, `${lineId} to a ${face} ligand`).toBe(face === "beta" ? "wedge" : "hash");
        expect(layout.depth[lineId]).toBe(face === "beta" ? "front" : "back");
        checked++;
      }
      expect(checked).toBeGreaterThan(2);
    });
  }

  it("draws the C-5 hydrogen of 5alpha- and 5beta-cholestane with a mark on it, hashed and wedged", () => {
    for (const [file, stereo, text] of [
      ["5alpha-cholestane.mol", "hash", "5α-H"],
      ["5beta-cholestane.mol", "wedge", "5β-H"],
    ] as const) {
      const mol = load(file);
      const accepted = accept(mol);
      const c5 = accepted.core[4]!;
      const layout = layoutOf(project(mol, stereoConfig(mol), view("steroid", accepted)));
      const node = hydrogenNodeId(c5, 0);
      expect(layout.derivedNodes.find((n) => n.id === node)).toMatchObject({ kind: "hydrogen", host: c5 });
      expect(layout.marks[derivedBondId(node)]).toEqual({ stereo, narrowEnd: c5 });
      expect(labelTexts(layout)).toContain(text);
      // The A/B fusion: C-19 on C-10 is beta in both, so 5α is trans, 5β cis.
      expect(labelTexts(layout)).toContain("10β");
      // Where the textbook prints the ring-fusion hydrogens: 5-H and 9-H
      // straight down, 8-H straight up (decision 178's placement), with
      // nothing crowded.
      for (const [locant, sign] of [[5, -1], [8, 1], [9, -1]] as const) {
        const host = accepted.core[locant - 1]!;
        const h = layout.positions[hydrogenNodeId(host, 0)]!;
        const at = layout.positions[host]!;
        const angle = Math.atan2(h.y - at.y, h.x - at.x);
        expect(Math.abs(Math.sin(angle)), `${locant}-H`).toBeGreaterThan(Math.cos((10 * Math.PI) / 180));
        expect(Math.sign(h.y - at.y), `${locant}-H`).toBe(sign);
      }
      expect(layout.collisions).toEqual([]);
    }
  });

  it("labels the literature's composites and prints the steroid numbering", () => {
    const cholesterol = load("cholesterol.mol");
    const layout = layoutOf(project(cholesterol, stereoConfig(cholesterol), view("steroid", accept(cholesterol))));
    expect(labelTexts(layout)).toEqual(["17β", "14α-H", "13β", "9α-H", "8β-H", "10β", "3β-OH"]);
    expect(layout.locants["a24"]).toBe("3");
    expect(layout.locants["a28"]).toBe("18");
    expect(layout.locants["a2"]).toBe("20");

    const cortisol = load("cortisol.mol");
    const c = layoutOf(project(cortisol, stereoConfig(cortisol), view("steroid", accept(cortisol))));
    expect(labelTexts(c)).toEqual(expect.arrayContaining(["11β-OH", "17α-OH", "17β"]));
  });

  it("keeps every label and the picture when the drawing is turned 180 degrees, and flips every label in the mirror image", () => {
    const mol = load("testosterone.mol");
    const accepted = accept(mol);
    const layout = layoutOf(project(mol, stereoConfig(mol), view("steroid", accepted)));
    const turned = rotateAtoms(mol, mol.atomIds, { x: 3, y: -2 }, Math.PI);
    const turnedLayout = layoutOf(project(turned, stereoConfig(turned), view("steroid", accepted)));
    expect(turnedLayout.faceLabels).toEqual(layout.faceLabels);
    // The same picture up to where it sits on the page.
    const shift = {
      x: turnedLayout.positions["a2"]!.x - layout.positions["a2"]!.x,
      y: turnedLayout.positions["a2"]!.y - layout.positions["a2"]!.y,
    };
    for (const id of mol.atomIds) {
      expect(turnedLayout.positions[id]!.x - shift.x).toBeCloseTo(layout.positions[id]!.x, 6);
      expect(turnedLayout.positions[id]!.y - shift.y).toBeCloseTo(layout.positions[id]!.y, 6);
    }
    expect(turnedLayout.marks).toEqual(layout.marks);

    let mirrored = mol;
    for (const id of mol.atomIds) mirrored = setAtomPosition(mirrored, id, { x: -mol.atoms[id]!.pos.x, y: mol.atoms[id]!.pos.y });
    const ent = layoutOf(project(mirrored, stereoConfig(mirrored), view("steroid", accepted)));
    expect(ent.faceLabels.map((l) => l.face)).toEqual(layout.faceLabels.map((l) => (l.face === "alpha" ? "beta" : "alpha")));
  });

  it("states faces only for the centres its layout states", () => {
    const mol = load("cholesterol.mol");
    const config = stereoConfig(mol);
    const accepted = accept(mol);
    const c3 = accepted.core[2]!;
    const without = restrictStereoConfig(config, {
      centres: config.centres.map((c) => c.atomId).filter((id) => id !== c3),
      doubleBonds: [],
    });
    const layout = layoutOf(project(mol, without, view("steroid", accepted)));
    expect(layout.coverage.centres).not.toContain(c3);
    expect(layout.faceLabels.some((l) => l.atomId === c3)).toBe(false);
    expect(layout.faceLabels.length).toBeGreaterThan(0);
  });
});

describe("an accepted skeleton on the other planar templates", () => {
  it("numbers and labels a wedge-dash or Mills panel only while the params carry it", () => {
    const mol = load("estradiol.mol");
    const config = stereoConfig(mol);
    const accepted = accept(mol);
    for (const template of ["wedgeDash", "mills"] as const) {
      const plain = layoutOf(project(mol, config, view(template)));
      expect(plain.locants).toEqual({});
      expect(plain.faceLabels).toEqual([]);
      const labelled = layoutOf(project(mol, config, view(template, accepted)));
      expect(labelTexts(labelled)).toEqual(expect.arrayContaining(["17β-OH", "13β", "8β-H", "9α-H", "14α-H"]));
      expect(Object.keys(labelled.locants)).toHaveLength(18);
    }
  });

  it("is kept, in locant order, by the canonical view, and keyed apart from the plain panel", () => {
    const mol = load("estradiol.mol");
    const accepted = accept(mol);
    const canonical = canonicalProjectionView(view("wedgeDash", accepted, 370));
    expect(canonical).toEqual(view("wedgeDash", accepted, 10));
    const config = stereoConfig(mol);
    expect(project(mol, config, view("wedgeDash", accepted))).not.toBe(project(mol, config, view("wedgeDash")));
  });

  it("never reads a drawn coordinate to decide a face", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const file of [
      join(here, "..", "skeleton", "table.ts"),
      join(here, "..", "skeleton", "steroid.ts"),
      join(here, "skeleton-labels.ts"),
    ]) {
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/\.pos\b/);
    }
    // The bond whose face is asked about exists in the model.
    const mol = load("cholesterol.mol");
    expect(bondBetween(mol, "a24", "a26")).toBeDefined();
  });
});

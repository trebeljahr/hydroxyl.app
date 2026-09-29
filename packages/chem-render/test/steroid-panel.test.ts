/**
 * Drawing the planar frame's new marks and labels (decisions 177-182): the
 * hashed-wedge narrow-end switch, a marked hydrogen the model does not
 * store, and a steroid panel's alpha/beta runs.
 *
 * The chemistry is chem-core's and asserted there; these tests pin that
 * chem-render draws what the layout says, and nothing the layout does not.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  cipDescriptor,
  derivedBondId,
  hydrogenNodeId,
  project,
  readMolblock,
  stereoConfig,
  suggestSteroidSkeleton,
} from "@starter/chem-core";
import type { AcceptedSkeleton, Molecule, PlanarView, ProjectedLayout } from "@starter/chem-core";

import { annotationLayout, buildScene } from "../src/scene/build.js";
import { representation } from "../src/representation.js";
import type { PathPrimitive, ScenePrimitive } from "../src/scene/types.js";
import { modelToPx, PUBLICATION_STYLE, SCREEN_STYLE, withStyle } from "../src/style.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = join(HERE, "..", "..", "chem-core", "test", "fixtures");

function load(dir: "projection" | "steroid", file: string): Molecule {
  return readMolblock(readFileSync(join(CORE, dir, file), "utf8")).molecule;
}

function steroidView(skeleton: AcceptedSkeleton): PlanarView {
  return { kind: "planar", template: "steroid", frame: {}, params: { rotationDeg: 0, mirror: false, skeleton } };
}

function layoutFor(mol: Molecule, view: PlanarView): ProjectedLayout {
  const result = project(mol, stereoConfig(mol), view);
  if (result.kind !== "available") throw new Error(JSON.stringify(result));
  return result.layout;
}

function accepted(mol: Molecule): AcceptedSkeleton {
  const suggestion = suggestSteroidSkeleton(mol);
  if (suggestion.kind !== "match") throw new Error("no steroid");
  return suggestion.skeleton;
}

function byId(primitives: readonly ScenePrimitive[], id: string): ScenePrimitive | undefined {
  return primitives.find((p) => p.id === id);
}

/** Each bar of a hash path, as its midpoint and its length. */
function bars(path: PathPrimitive): { mid: { x: number; y: number }; length: number }[] {
  const numbers = path.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const out: { mid: { x: number; y: number }; length: number }[] = [];
  for (let i = 0; i + 3 < numbers.length; i += 4) {
    const [ax, ay, bx, by] = numbers.slice(i, i + 4) as [number, number, number, number];
    out.push({ mid: { x: (ax + bx) / 2, y: (ay + by) / 2 }, length: Math.hypot(bx - ax, by - ay) });
  }
  return out;
}

describe("the hashed-wedge narrow-end switch (decision 177)", () => {
  it("draws the narrow end at the stereocentre by default and at the substituent when the style asks, stating the same centre", () => {
    // (R)-glyceraldehyde: the hydroxyl on a hash from C2 (a3).
    const mol = load("projection", "r-glyceraldehyde.mol");
    const hashBond = mol.bondIds.find((id) => mol.bonds[id]!.stereo === "hash")!;
    expect(mol.bonds[hashBond]!.from).toBe("a3");
    const centre = modelToPx(PUBLICATION_STYLE, mol.atoms["a3"]!.pos);
    const nearest = (style: typeof PUBLICATION_STYLE) => {
      const scene = buildScene(mol, style, representation("skeletal"));
      const ladder = bars(byId(scene.primitives, `bond:${hashBond}:hash`) as PathPrimitive);
      const byDistance = [...ladder].sort(
        (p, q) => Math.hypot(p.mid.x - centre.x, p.mid.y - centre.y) - Math.hypot(q.mid.x - centre.x, q.mid.y - centre.y),
      );
      return { closest: byDistance[0]!.length, farthest: byDistance[byDistance.length - 1]!.length };
    };
    for (const preset of [PUBLICATION_STYLE, SCREEN_STYLE]) expect(preset.hashedWedgeNarrowEnd).toBe("centre");
    const iupac = nearest(PUBLICATION_STYLE);
    expect(iupac.closest).toBeLessThan(iupac.farthest);
    const perspective = nearest(withStyle(PUBLICATION_STYLE, { hashedWedgeNarrowEnd: "substituent" }));
    expect(perspective.closest).toBeGreaterThan(perspective.farthest);
    // Drawing only: the molecule still says (R).
    expect(cipDescriptor(mol, "a3")).toEqual({ kind: "R" });
  });
});

describe("a steroid panel's scene", () => {
  it("draws 5alpha-cholestane's C-5 hydrogen hashed and its C-8 hydrogen wedged, sourced to their layout nodes", () => {
    const mol = load("steroid", "5alpha-cholestane.mol");
    const skeleton = accepted(mol);
    const layout = layoutFor(mol, steroidView(skeleton));
    const c5 = skeleton.core[4]!;
    const c8 = skeleton.core[7]!;
    expect(layout.marks[derivedBondId(hydrogenNodeId(c5, 0))]?.stereo).toBe("hash");
    expect(layout.marks[derivedBondId(hydrogenNodeId(c8, 0))]?.stereo).toBe("wedge");
    const scene = buildScene(mol, PUBLICATION_STYLE, representation("skeletal"), { layout });
    const hash = byId(scene.primitives, `projected:${c5}.H:hash`);
    const wedge = byId(scene.primitives, `projected:${c8}.H:wedge`);
    expect(hash?.type).toBe("path");
    expect(wedge?.type).toBe("polygon");
    expect(hash?.source).toEqual({ kind: "projected", nodeId: `${c5}.H`, atomIds: [c5] });
    // No plain stem is drawn under a marked one.
    expect(byId(scene.primitives, `projected:${c5}.H:line`)).toBeUndefined();
    // A drawing with its marks off draws the stem plain.
    const unmarked = buildScene(mol, PUBLICATION_STYLE, representation("skeletal", { showStereoBonds: false }), { layout });
    expect(byId(unmarked.primitives, `projected:${c5}.H:line`)?.type).toBe("line");
  });

  it("prints alpha/beta instead of R/S at the core centres, and the side chain keeps its letter", () => {
    const mol = load("steroid", "cholesterol.mol");
    const layout = layoutFor(mol, steroidView(accepted(mol)));
    const rep = representation("skeletal", { showStereoDescriptors: true });
    const annotations = annotationLayout(mol, SCREEN_STYLE, rep, { layout });
    const texts = new Map(annotations.placements.map((p) => [p.id, p.text]));
    expect(texts.get("atom:a24:alphaBeta")).toBe("3β-OH");
    expect(texts.get("atom:a17:alphaBeta")).toBe("8β-H");
    expect(texts.get("atom:a21:alphaBeta")).toBe("10β");
    expect(texts.get("atom:a24:descriptor")).toBeUndefined();
    // C-20 is in the side chain: no face, so its (R) stays.
    expect(texts.get("atom:a2:descriptor")).toBe("(R)");
    expect(texts.has("atom:a2:alphaBeta")).toBe(false);
    // Off with the stereo descriptors, as every stereo annotation is.
    const off = annotationLayout(mol, SCREEN_STYLE, representation("skeletal"), { layout });
    expect(off.placements.filter((p) => p.id.endsWith(":alphaBeta"))).toEqual([]);
  });

  it("joins two statements at one centre into one run, by ligand id: 17α, 17β-OH at 17alpha-methyltestosterone's C-17", () => {
    const mol = load("steroid", "methyltestosterone.mol");
    const layout = layoutFor(mol, steroidView(accepted(mol)));
    const annotations = annotationLayout(mol, SCREEN_STYLE, representation("skeletal", { showStereoDescriptors: true }), {
      layout,
    });
    expect(annotations.placements.find((p) => p.id === "atom:a19:alphaBeta")?.text).toBe("17α, 17β-OH");
  });

  it("draws the panel's steroid numbering under the caller's own locants", () => {
    const mol = load("steroid", "testosterone.mol");
    const layout = layoutFor(mol, steroidView(accepted(mol)));
    const rep = representation("skeletal", { showLocants: true });
    const own = annotationLayout(mol, SCREEN_STYLE, rep, { layout });
    const locant = (layoutResult: typeof own, atomId: string) =>
      layoutResult.placements.find((p) => p.id === `atom:${atomId}:locant`)?.text;
    expect(locant(own, "a10")).toBe("17");
    expect(locant(own, "a1")).toBe("18");
    // The caller's numbering wins where it says anything, "" included.
    const overridden = annotationLayout(mol, SCREEN_STYLE, rep, { layout, locants: { a10: "C17", a1: "" } });
    expect(locant(overridden, "a10")).toBe("C17");
    expect(locant(overridden, "a1")).toBeUndefined();
    expect(locant(overridden, "a2")).toBe("13");
  });
});

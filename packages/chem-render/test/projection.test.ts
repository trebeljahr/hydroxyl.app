/**
 * Drawing a projection: `buildScene(mol, style, representation, {layout})`.
 *
 * The layout is chem-core's value, in model units, y up. These tests pin that
 * chem-render only DRAWS it: positions go through `modelToPx` and nothing
 * else, labels and descriptors still come from the molecule, a condensed group
 * is one word sourced to every atom it stands for, and nothing folded into a
 * word is drawn a second time.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { bondBetween, project, readMolblock, rings, stereoConfig } from "@starter/chem-core";
import type { ChainView, Molecule, PlanarView, ProjectedLayout, RingView } from "@starter/chem-core";

import { projectedViewAvailability } from "../src/availability.js";
import { representation } from "../src/representation.js";
import { buildAnnotatedScene, buildScene } from "../src/scene/build.js";
import type { ScenePrimitive, TextRunPrimitive } from "../src/scene/types.js";
import { modelToPx, PUBLICATION_STYLE, SCREEN_STYLE } from "../src/style.js";
import { serializeScene } from "../src/svg/serialize.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "..", "chem-core", "test", "fixtures", "projection");

function load(file: string): Molecule {
  return readMolblock(readFileSync(join(FIXTURES, file), "utf8")).molecule;
}

const GLUCOSE_BACKBONE = ["a2", "a3", "a5", "a7", "a9", "a11"];

function planar(rotationDeg = 0, mirror = false): PlanarView {
  return { kind: "planar", template: "wedgeDash", frame: {}, params: { rotationDeg, mirror } };
}

function fischer(backbone: readonly string[]): ChainView {
  return { kind: "chain", template: "fischer", frame: { backbone }, params: { top: "first" } };
}

function layoutOf(mol: Molecule, view: PlanarView | ChainView): ProjectedLayout {
  const result = project(mol, stereoConfig(mol), view);
  if (result.kind !== "available") throw new Error(JSON.stringify(result));
  return result.layout;
}

function runs(primitives: readonly ScenePrimitive[]): TextRunPrimitive[] {
  return primitives.filter((p): p is TextRunPrimitive => p.type === "textRun");
}

function text(run: TextRunPrimitive): string {
  return run.spans.map((s) => (s.script === "sub" ? `_${s.text}` : s.text)).join("");
}

const skeletal = representation("skeletal");

describe("a planar layout", () => {
  it("draws exactly the scene of the drawing itself when neither turned nor mirrored", () => {
    for (const file of ["d-glucose-open.mol", "5alpha-androstane.mol", "cis-2-butene.mol", "adenosine.mol"]) {
      const mol = load(file);
      for (const style of [PUBLICATION_STYLE, SCREEN_STYLE]) {
        const plain = buildScene(mol, style, skeletal);
        const projected = buildScene(mol, style, skeletal, { layout: layoutOf(mol, planar()) });
        expect(JSON.stringify(projected), file).toBe(JSON.stringify(plain));
      }
    }
  });

  it("draws a mirrored panel's wedges as hashes, so the panel states the same enantiomer", () => {
    const mol = load("d-glucose-open.mol");
    const wedged = mol.bondIds.filter((id) => mol.bonds[id]!.stereo === "wedge");
    const hashed = mol.bondIds.filter((id) => mol.bonds[id]!.stereo === "hash");
    expect(wedged.length + hashed.length).toBeGreaterThan(0);
    const scene = buildScene(mol, PUBLICATION_STYLE, skeletal, { layout: layoutOf(mol, planar(0, true)) });
    const ids = new Set(scene.primitives.map((p) => p.id));
    for (const id of wedged) {
      expect(ids.has(`bond:${id}:wedge`), id).toBe(false);
      expect([...ids].some((p) => p.startsWith(`bond:${id}:hash`)), id).toBe(true);
    }
    // And its (R)/(S) labels are the molecule's: a mirror is a view, not an edit.
    const withDescriptors = representation("skeletal", { showStereoDescriptors: true });
    const layout = layoutOf(mol, planar(0, true));
    const descriptors = buildAnnotatedScene(mol, SCREEN_STYLE, withDescriptors, { layout }).annotations;
    const plain = buildAnnotatedScene(mol, SCREEN_STYLE, withDescriptors).annotations;
    const byAtom = (layoutPlacements: typeof plain) =>
      Object.fromEntries(layoutPlacements.placements.map((p) => [p.id, p.text]));
    expect(byAtom(descriptors)).toEqual(byAtom(plain));
    expect(Object.values(byAtom(plain)).sort()).toEqual(["(R)", "(R)", "(R)", "(S)"]);
  });

  it("puts every atom where modelToPx puts the layout's position, and nowhere else", () => {
    const mol = load("pentane-2r3s-diol.mol");
    const layout = layoutOf(mol, planar(90));
    const scene = buildScene(mol, SCREEN_STYLE, skeletal, { layout });
    for (const primitive of scene.primitives) {
      if (primitive.type !== "circle" || primitive.source.kind !== "atom") continue;
      expect(primitive.centre).toEqual(modelToPx(SCREEN_STYLE, layout.positions[primitive.source.atomId]!));
    }
    expect(scene.primitives.some((p) => p.type === "circle" && p.source.kind === "atom")).toBe(true);
  });
});

describe("a Fischer layout", () => {
  const mol = load("d-glucose-open.mol");
  const layout = layoutOf(mol, fischer(GLUCOSE_BACKBONE));

  it("draws the termini as one word each, sourced to every atom the word stands for", () => {
    const scene = buildScene(mol, PUBLICATION_STYLE, skeletal, { layout });
    const byId = new Map(runs(scene.primitives).map((r) => [r.id, r]));
    const cho = byId.get("projected:a2.CHO:label")!;
    const ch2oh = byId.get("projected:a11.CH2OH:label")!;
    expect(text(cho)).toBe("CHO");
    expect(text(ch2oh)).toBe("CH_2OH");
    expect(cho.source).toEqual({ kind: "projected", nodeId: "a2.CHO", atomIds: ["a1", "a2"] });
    expect(ch2oh.source).toEqual({ kind: "projected", nodeId: "a11.CH2OH", atomIds: ["a11", "a12"] });
    // The CHO sits above the CH2OH on the page (scene y grows downward).
    expect(cho.origin.y).toBeLessThan(ch2oh.origin.y);
  });

  it("draws nothing of an atom folded into a word, and no bond inside one", () => {
    const scene = buildScene(mol, PUBLICATION_STYLE, skeletal, { layout });
    const folded = new Set(["a1", "a12"]);
    for (const p of scene.primitives) {
      if (p.source.kind === "atom") expect(folded.has(p.source.atomId), p.id).toBe(false);
    }
    const inside = [bondBetween(mol, "a1", "a2")!.id, bondBetween(mol, "a11", "a12")!.id];
    for (const bondId of inside) {
      expect(scene.primitives.some((p) => p.source.kind === "bond" && p.source.bondId === bondId), bondId).toBe(false);
    }
    // The bonds INTO the words are drawn, trimmed against them.
    for (const bondId of [bondBetween(mol, "a2", "a3")!.id, bondBetween(mol, "a9", "a11")!.id]) {
      expect(scene.primitives.some((p) => p.id === `bond:${bondId}:line`), bondId).toBe(true);
    }
  });

  it("draws each synthetic hydrogen as a stem and an H sourced to its centre, on the empty arm", () => {
    const scene = buildScene(mol, PUBLICATION_STYLE, skeletal, { layout });
    for (const centre of ["a3", "a5", "a7", "a9"]) {
      const label = scene.primitives.find((p) => p.id === `projected:${centre}.H:label`) as TextRunPrimitive;
      const stem = scene.primitives.find((p) => p.id === `projected:${centre}.H:line`);
      expect(text(label)).toBe("H");
      expect(label.source).toEqual({ kind: "projected", nodeId: `${centre}.H`, atomIds: [centre] });
      expect(stem?.type).toBe("line");
    }
    // The hydroxyls are the molecule's own oxygens, labelled as any oxygen is.
    const oxygen = runs(scene.primitives).find((r) => r.id === "atom:a4:label")!;
    expect(["OH", "HO"]).toContain(text(oxygen));
    expect(text(oxygen)).toBe(layout.positions["a4"]!.x > 0 ? "OH" : "HO");
  });

  it("fans no second set of hydrogens in the explicit-H view", () => {
    const explicit = representation("explicitH");
    const scene = buildScene(mol, PUBLICATION_STYLE, explicit, { layout });
    const hosts = scene.primitives.flatMap((p) => (p.source.kind === "hydrogen" ? [p.source.hostAtomId] : []));
    for (const host of ["a1", "a2", "a3", "a5", "a7", "a9", "a11", "a12"]) expect(hosts, host).not.toContain(host);
    // The hydroxyl hydrogens are still the view's to draw.
    expect(hosts).toContain("a4");
  });

  it("prints the molecule's descriptors beside the crossings", () => {
    const withDescriptors = representation("skeletal", { showStereoDescriptors: true });
    const { annotations } = buildAnnotatedScene(mol, SCREEN_STYLE, withDescriptors, { layout });
    const letters = Object.fromEntries(
      annotations.placements.filter((p) => p.source.kind === "atom").map((p) => [p.source.kind === "atom" ? p.source.atomId : "", p.text]),
    );
    expect(letters).toEqual({ a3: "(R)", a5: "(S)", a7: "(R)", a9: "(R)" });
  });

  it("serialises byte for byte the same on two runs, and marks derived nodes in the SVG", () => {
    const again = load("d-glucose-open.mol");
    const a = serializeScene(buildScene(mol, PUBLICATION_STYLE, skeletal, { layout }));
    const b = serializeScene(buildScene(again, PUBLICATION_STYLE, skeletal, { layout: layoutOf(again, fischer(GLUCOSE_BACKBONE)) }));
    expect(a).toBe(b);
    expect(a).toContain('data-projected-node="a11.CH2OH" data-projected-atoms="a11 a12"');
  });
});

describe("projected view availability", () => {
  it("is available with the layout to draw, and refuses a text view", () => {
    const mol = load("d-glucose-open.mol");
    const ok = projectedViewAvailability(mol, "skeletal", fischer(GLUCOSE_BACKBONE));
    expect(ok.status).toBe("available");
    const text = projectedViewAvailability(mol, "sumFormula", fischer(GLUCOSE_BACKBONE));
    expect(text).toMatchObject({ status: "unavailable", reason: "text-view" });
  });

  it("asks which ring rather than drawing an empty panel, and names what is not built yet", () => {
    const adenosine = load("adenosine.mol");
    const anyRing: RingView = { kind: "ring", template: "haworth", frame: { ringAtomIds: [] }, params: { face: "front" } };
    const choice = projectedViewAvailability(adenosine, "skeletal", anyRing);
    expect(choice.status).toBe("needsChoice");
    if (choice.status === "needsChoice") {
      expect(choice.candidates).toHaveLength(3);
      expect(choice.message).toBe("3 rings fit this view; choose the one to draw.");
    }
    const one: RingView = { ...anyRing, frame: { ringAtomIds: rings(adenosine)[0]!.atomIds } };
    expect(projectedViewAvailability(adenosine, "skeletal", one)).toMatchObject({
      status: "unavailable",
      reason: "template-not-built",
      message: "This projection is not available yet.",
    });
  });

  it("reports the representation's own refusal first", () => {
    const empty = readMolblock("\n  test\n\n  0  0  0  0  0  0  0  0  0  0999 V2000\nM  END\n").molecule;
    expect(projectedViewAvailability(empty, "skeletal", planar())).toMatchObject({
      status: "unavailable",
      reason: "empty-molecule",
    });
  });
});

describe("chem-render's one scaling function", () => {
  it("keeps bondLengthPx out of every source file but style.ts", () => {
    const src = join(HERE, "..", "src");
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(path);
      }
    };
    walk(src);
    expect(files.some((f) => f.endsWith("projected.ts"))).toBe(true);
    for (const file of files) {
      if (file.endsWith(join("src", "style.ts"))) continue;
      // Code only: a comment may name the rule it keeps.
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/bondLengthPx/);
    }
  });
});

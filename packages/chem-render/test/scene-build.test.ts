/**
 * What `buildScene` is contractually required to emit.
 *
 * These are the assertions the goldens cannot make. A golden proves the bytes
 * did not change; it says nothing about *why* they are what they are, and it
 * cannot fail for the right reason. "Benzene is six lines" is the statement
 * that actually breaks when someone implements the second line of a double
 * bond and forgets that this pass is the foundation only.
 */

import { describe, expect, it } from "vitest";

import { benzene, getAtom, molecularFormula } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";

import { acetate, ethanol, FIXTURES, heavyChain } from "../src/fixtures.js";
import { representation } from "../src/representation.js";
import { buildScene } from "../src/scene/build.js";
import type { ScenePrimitive, TextRunPrimitive } from "../src/scene/types.js";
import { modelToPx, PUBLICATION_STYLE, SCREEN_STYLE, withStyle } from "../src/style.js";

const SKELETAL = representation("skeletal");

function ofType(
  primitives: readonly ScenePrimitive[],
  type: ScenePrimitive["type"],
): ScenePrimitive[] {
  return primitives.filter((p) => p.type === type);
}

describe("fixtures", () => {
  it("are the molecules they claim to be", () => {
    // If a fixture's chemistry drifts, every golden below is re-blessing a
    // picture of the wrong compound. Check the formula before anything else.
    expect(FIXTURES.map((f) => f.name)).toEqual(["benzene", "ethanol", "acetate"]);
    expect(molecularFormula(benzene())).toBe("C6H6");
    expect(molecularFormula(ethanol())).toBe("C2H6O");
    expect(molecularFormula(acetate())).toBe("[C2H3O2]-");
  });

  it("gives the benchmark subject exactly the heavy-atom count it advertises", () => {
    const chain = heavyChain(300);
    expect(chain.atomIds).toHaveLength(300);
    expect(chain.bondIds).toHaveLength(299);
    expect(molecularFormula(chain)).toBe("C299H600O");
  });
});

describe("buildScene, structural views", () => {
  it("draws benzene as exactly six lines", () => {
    const scene = buildScene(benzene(), PUBLICATION_STYLE, SKELETAL);
    // Six, not nine. A Kekule benzene has three double bonds, and the second
    // line of each is a later task; a scene that suddenly has nine lines means
    // bond geometry landed here rather than in its own pass.
    expect(ofType(scene.primitives, "line")).toHaveLength(6);
    expect(ofType(scene.primitives, "circle")).toHaveLength(6);
    expect(scene.primitives).toHaveLength(12);
  });

  it("emits bonds before atoms, each in the molecule's insertion order", () => {
    const mol = benzene();
    const scene = buildScene(mol, PUBLICATION_STYLE, SKELETAL);
    expect(scene.primitives.map((p) => p.id)).toEqual([
      ...mol.bondIds.map((id) => `bond:${id}:line`),
      ...mol.atomIds.map((id) => `atom:${id}:dot`),
    ]);
  });

  it("puts every coordinate through the one model-to-px conversion", () => {
    // The invariant this whole package exists for: geometry leaves here in
    // final px with y already flipped, and nothing re-derives the scale.
    const mol = ethanol();
    const scene = buildScene(mol, SCREEN_STYLE, SKELETAL);
    const dots = ofType(scene.primitives, "circle");

    mol.atomIds.forEach((atomId, index) => {
      const atom = getAtom(mol, atomId);
      const dot = dots[index];
      if (atom === undefined || dot === undefined || dot.type !== "circle") {
        throw new Error(`Missing atom or dot at ${index}`);
      }
      expect(dot.centre).toEqual(modelToPx(SCREEN_STYLE, atom.pos));
      // y-down, spelled out rather than left to modelToPx to agree with itself.
      expect(dot.centre.y).toBeCloseTo(-atom.pos.y * SCREEN_STYLE.bondLengthPx, 12);
    });
  });

  it("carries a source back-reference on every primitive", () => {
    const scene = buildScene(acetate(), PUBLICATION_STYLE, SKELETAL);
    for (const primitive of scene.primitives) {
      // A structural scene has no decorations, so every primitive must be
      // traceable to a model entity — that is what makes a click on a line
      // select the right bond.
      expect(primitive.source.kind).not.toBe("decoration");
      if (primitive.source.kind === "bond") {
        expect(primitive.id).toBe(`bond:${primitive.source.bondId}:line`);
      } else if (primitive.source.kind === "atom") {
        expect(primitive.id).toBe(`atom:${primitive.source.atomId}:dot`);
      }
    }
  });

  it("suppresses the placeholder dots when the style asks for none", () => {
    const style = withStyle(PUBLICATION_STYLE, { atomDotRadiusPx: 0 });
    const scene = buildScene(benzene(), style, SKELETAL);
    expect(scene.primitives).toHaveLength(6);
    expect(ofType(scene.primitives, "circle")).toHaveLength(0);
  });

  it("skips a bond with a missing endpoint instead of throwing", () => {
    // A molecule mid-edit — an undo landing while a drag is in flight — is an
    // ordinary UI race. Blanking the canvas over it would be the worse bug.
    const mol = benzene();
    const [dropped] = mol.atomIds;
    if (dropped === undefined) throw new Error("benzene has no atoms");
    const atoms = { ...mol.atoms };
    delete atoms[dropped];
    const mangled: Molecule = {
      ...mol,
      atoms,
      atomIds: mol.atomIds.filter((id) => id !== dropped),
    };

    const scene = buildScene(mangled, PUBLICATION_STYLE, SKELETAL);
    // The dropped atom was in two of the six ring bonds.
    expect(ofType(scene.primitives, "line")).toHaveLength(4);
    expect(ofType(scene.primitives, "circle")).toHaveLength(5);
  });

  it("treats every structural kind the same for now", () => {
    // Display flags are not consulted yet. Pinning that keeps the eventual
    // divergence honest: whoever wires the flags up has to change this test on
    // purpose rather than discover it was never covered.
    const kinds = ["skeletal", "kekule", "explicitH", "lewis"] as const;
    const scenes = kinds.map((kind) =>
      buildScene(benzene(), PUBLICATION_STYLE, representation(kind)),
    );
    for (const scene of scenes) {
      expect(scene.primitives).toHaveLength(12);
    }
  });
});

describe("buildScene, text views", () => {
  function textRun(mol: Molecule, kind: "condensed" | "sumFormula"): TextRunPrimitive {
    const scene = buildScene(mol, PUBLICATION_STYLE, representation(kind));
    expect(scene.primitives).toHaveLength(1);
    const [run] = scene.primitives;
    if (run === undefined || run.type !== "textRun") {
      throw new Error("expected a single text run");
    }
    return run;
  }

  it("renders a sum formula as one glyph run with real subscripts", () => {
    const run = textRun(benzene(), "sumFormula");
    expect(run.spans).toEqual([
      { text: "C" },
      { text: "6", script: "sub" },
      { text: "H" },
      { text: "6", script: "sub" },
    ]);
  });

  it("sets acetate's charge as a superscript", () => {
    const run = textRun(acetate(), "sumFormula");
    expect(run.spans.at(-1)).toEqual({ text: "-", script: "super" });
    // The digits stay subscripts; only the charge rises.
    expect(run.spans.filter((s) => s.script === "sub").map((s) => s.text)).toEqual([
      "2",
      "3",
      "2",
    ]);
  });

  it("belongs to no model entity, so clicking it selects nothing", () => {
    const run = textRun(ethanol(), "sumFormula");
    expect(run.source).toEqual({ kind: "decoration" });
    expect(run.id).toBe("text:sumFormula:formula");
  });

  it("gives condensed its own id while it shares the placeholder run", () => {
    // Condensed is really "CH3CH2OH", walked from the graph. Until that pass
    // exists it borrows the sum formula, which is at least chemically true.
    const condensed = textRun(ethanol(), "condensed");
    const sum = textRun(ethanol(), "sumFormula");
    expect(condensed.id).toBe("text:condensed:formula");
    expect(condensed.spans).toEqual(sum.spans);
  });
});

describe("determinism", () => {
  it("builds the same scene twice, structurally identical", () => {
    const a = buildScene(benzene(), PUBLICATION_STYLE, SKELETAL);
    const b = buildScene(benzene(), PUBLICATION_STYLE, SKELETAL);
    // Two independently built molecules, not one molecule built twice: ids
    // come out of chem-core's monotonic counter, so this also proves the
    // scene's ids are derived from the source rather than from a global.
    expect(JSON.stringify(a.primitives)).toBe(JSON.stringify(b.primitives));
  });
});

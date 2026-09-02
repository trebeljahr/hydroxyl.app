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

import {
  aromaticRings,
  benzene,
  getAtom,
  molecularFormula,
  rings,
  valenceIssues,
} from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";

import {
  acetate,
  benzylAlcoholAbbreviated,
  bromomethane,
  butan2olWedged,
  chrysene,
  dimethylSulfone,
  ethanol,
  ethanolMirrored,
  FIXTURES,
  heavyChain,
  iodomethane,
  methane,
  methanol13C,
  methyleneCarbene,
  methylRadical,
  naphthalene,
  tertButylCation,
  unmergedDropOverlap,
} from "../src/fixtures.js";
import {
  composeAtomLabel,
  labelPlainText,
  symbolSpanIndex,
} from "../src/label/compose.js";
import type { LabelSide } from "../src/label/compose.js";
import { representation } from "../src/representation.js";
import { buildScene } from "../src/scene/build.js";
import type { ScenePrimitive, TextRunPrimitive } from "../src/scene/types.js";
import { modelToPx, PUBLICATION_STYLE, SCREEN_STYLE, withStyle } from "../src/style.js";
import { BUNDLED_MEASURER, measureTextRun } from "../src/text/measurer.js";

const SKELETAL = representation("skeletal");

function ofType(
  primitives: readonly ScenePrimitive[],
  type: ScenePrimitive["type"],
): ScenePrimitive[] {
  return primitives.filter((p) => p.type === type);
}

/**
 * Where the atom's own SYMBOL sits inside a drawn label run, in scene px.
 *
 * Derived from the run the scene actually emitted plus the measurer, not from
 * `placeAtomLabel` — asserting a placement against the function that produced
 * it proves nothing. The two things borrowed from the label layer are which
 * span is the symbol and how wide a glyph is; the arithmetic that puts them on
 * the atom is redone here.
 */
function symbolCentreOf(
  run: TextRunPrimitive,
  mol: Molecule,
  atomId: string,
): { x: number; y: number } {
  const label = composeAtomLabel(mol, atomId, SKELETAL);
  if (label === undefined) throw new Error(`atom ${atomId} composed no label`);
  // Read the orientation back off the run that was drawn rather than assuming
  // one: "HO" and "OH" hold the same spans in opposite orders.
  const drawn = run.spans.map((s) => s.text).join("");
  const side: LabelSide = labelPlainText(label, "west") === drawn ? "west" : "east";
  const index = symbolSpanIndex(label, side);

  const box = measureTextRun(
    run.spans,
    {
      fontFamily: run.fontFamily,
      fontSizePx: run.fontSizePx,
      subscriptScale: SCREEN_STYLE.subscriptScale,
      anchor: run.anchor,
      baseline: run.baseline,
    },
    BUNDLED_MEASURER,
  );
  const symbol = box.spans[index];
  if (symbol === undefined) throw new Error("no symbol span");
  return {
    x: run.origin.x + box.startXPx + symbol.startXPx + symbol.advanceWidthPx / 2,
    // The baseline sits half a cap height below the atom, so the cap band's
    // midline — what a reader sees as the middle of a capital — is on it.
    y: run.origin.y + box.baselineYPx - box.capHeightPx / 2,
  };
}

describe("fixtures", () => {
  it("are the molecules they claim to be", () => {
    // If a fixture's chemistry drifts, every golden below is re-blessing a
    // picture of the wrong compound. Check the formula before anything else.
    expect(FIXTURES.map((f) => f.name)).toEqual([
      "benzene",
      "ethanol",
      "ethanolMirrored",
      "acetate",
      "methane",
      "methylRadical",
      "methyleneCarbene",
      "tertButylCation",
      "bromomethane",
      "iodomethane",
      "benzylAlcoholAbbreviated",
      "methanol13C",
      "butan2olWedged",
      "naphthalene",
      "dimethylSulfone",
      "chrysene",
      "unmergedDropOverlap",
    ]);
    expect(molecularFormula(benzene())).toBe("C6H6");
    expect(molecularFormula(ethanol())).toBe("C2H6O");
    expect(molecularFormula(acetate())).toBe("[C2H3O2]-");

    // The label fixtures earn their place by their chemistry, not their
    // picture. A radical is a radical because `radicalElectrons` took a
    // hydrogen off the formula, and if that stops being true the fixture is
    // no longer testing what its name says.
    expect(molecularFormula(methane())).toBe("CH4");
    expect(molecularFormula(methylRadical())).toBe("CH3");
    expect(molecularFormula(methyleneCarbene())).toBe("CH2");
    expect(molecularFormula(tertButylCation())).toBe("[C4H9]+");
    expect(molecularFormula(bromomethane())).toBe("CH3Br");
    expect(molecularFormula(iodomethane())).toBe("CH3I");
    expect(molecularFormula(methanol13C())).toBe("CH4O");
    expect(molecularFormula(butan2olWedged())).toBe("C4H10O");
    // The mirror is a rigid motion: same compound, opposite side of the page.
    expect(molecularFormula(ethanolMirrored())).toBe("C2H6O");

    // The bond-geometry fixtures. Naphthalene and chrysene are checked as
    // chemistry rather than as pictures because `fuseRingOnBond` is strict
    // about Kekule alternation: fusing across a single bond would still draw
    // the ring, and the only visible symptom would be a valence issue nobody
    // is looking at.
    expect(molecularFormula(naphthalene())).toBe("C10H8");
    expect(valenceIssues(naphthalene())).toHaveLength(0);
    expect(molecularFormula(chrysene())).toBe("C18H12");
    expect(valenceIssues(chrysene())).toHaveLength(0);
    expect(rings(chrysene())).toHaveLength(4);
    expect(aromaticRings(chrysene())).toHaveLength(4);
    // All six of sulfur's valences used: two S-C and two S=O, no hydrogen.
    expect(molecularFormula(dimethylSulfone())).toBe("C2H6O2S");
    expect(valenceIssues(dimethylSulfone())).toHaveLength(0);
    // Two disconnected fragments, which is what "a drop that never merged"
    // means: an ethanol and a methanol sitting on top of each other.
    expect(molecularFormula(unmergedDropOverlap())).toBe("C3H10O2");
  });

  it("gives the benchmark subject exactly the heavy-atom count it advertises", () => {
    const chain = heavyChain(300);
    expect(chain.atomIds).toHaveLength(300);
    expect(chain.bondIds).toHaveLength(299);
    expect(molecularFormula(chain)).toBe("C299H600O");
  });
});

describe("buildScene, structural views", () => {
  it("draws benzene as nine lines: six edges and three inner", () => {
    const scene = buildScene(benzene(), PUBLICATION_STYLE, SKELETAL);
    // Nine, because a Kekule benzene has three double bonds and each draws a
    // second line. Six would mean bond order is being ignored again.
    expect(ofType(scene.primitives, "line")).toHaveLength(9);
    expect(ofType(scene.primitives, "circle")).toHaveLength(6);
    expect(scene.primitives).toHaveLength(15);
  });

  it("emits bonds before atoms, each in the molecule's insertion order", () => {
    const mol = benzene();
    const scene = buildScene(mol, PUBLICATION_STYLE, SKELETAL);
    expect(scene.primitives.map((p) => p.id)).toEqual([
      ...mol.bondIds.flatMap((id) =>
        mol.bonds[id]?.order === 2
          ? [`bond:${id}:line`, `bond:${id}:line2`]
          : [`bond:${id}:line`],
      ),
      ...mol.atomIds.map((id) => `atom:${id}:dot`),
    ]);
  });

  it("puts every coordinate through the one model-to-px conversion", () => {
    // The invariant this whole package exists for: geometry leaves here in
    // final px with y already flipped, and nothing re-derives the scale.
    // Ethanol is two bare carbons and one labelled oxygen, so it exercises
    // both ways an atom can be drawn.
    const mol = ethanol();
    const scene = buildScene(mol, SCREEN_STYLE, SKELETAL);

    for (const atomId of mol.atomIds) {
      const atom = getAtom(mol, atomId);
      if (atom === undefined) throw new Error(`no atom ${atomId}`);
      const expected = modelToPx(SCREEN_STYLE, atom.pos);
      // y-down, spelled out rather than left to modelToPx to agree with itself.
      expect(expected.y).toBeCloseTo(-atom.pos.y * SCREEN_STYLE.bondLengthPx, 12);

      const dot = scene.primitives.find((p) => p.id === `atom:${atomId}:dot`);
      if (dot !== undefined) {
        if (dot.type !== "circle") throw new Error("a dot must be a circle");
        expect(dot.centre).toEqual(expected);
        continue;
      }

      // A labelled atom instead. The atom does not sit at the run's origin —
      // the run is anchored at its start — but the SYMBOL block's advance
      // midpoint must land exactly on it, which is what keeps a bond meeting
      // the oxygen of "OH" rather than the gap between its two letters.
      const run = scene.primitives.find((p) => p.id === `atom:${atomId}:label`);
      if (run === undefined || run.type !== "textRun") {
        throw new Error(`atom ${atomId} drew neither a dot nor a label`);
      }
      expect(symbolCentreOf(run, mol, atomId).x).toBeCloseTo(expected.x, 9);
      expect(symbolCentreOf(run, mol, atomId).y).toBeCloseTo(expected.y, 9);
    }
  });

  it("carries a source back-reference on every primitive", () => {
    // The carbene is the fixture that reaches all three atom forms at once: a
    // labelled atom, its two radical dots, and nothing else.
    for (const mol of [acetate(), methyleneCarbene(), benzene()]) {
      const scene = buildScene(mol, PUBLICATION_STYLE, SKELETAL);
      for (const primitive of scene.primitives) {
        // A structural scene has no decorations, so every primitive must be
        // traceable to a model entity — that is what makes a click on a line
        // select the right bond.
        expect(primitive.source.kind).not.toBe("decoration");
        if (primitive.source.kind === "bond") {
          // The extra lines of a double or triple bond are named from the
          // SOURCE too — `line2`, `line3` — never from a counter over the
          // emitted list, which would renumber the whole scene when one bond
          // changed order.
          expect(primitive.id).toMatch(
            new RegExp(`^bond:${primitive.source.bondId}:line[23]?$`),
          );
        } else if (primitive.source.kind === "atom") {
          // Every id is a pure function of the atom it came from. The trailing
          // index on a radical dot indexes ONE ATOM'S OWN cluster, so it is
          // stable too — unlike a counter that advances as iteration reaches
          // atoms, which would renumber the whole scene when one atom changed.
          expect(primitive.id).toMatch(
            new RegExp(`^atom:${primitive.source.atomId}:(dot|label|radical:\\d+)$`),
          );
        }
      }
      // Nothing is drawn twice under the same id, which is what a stable id
      // scheme is actually for.
      const ids = scene.primitives.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("draws a bare vertex or a label, never both", () => {
    // A dot beside a symbol is the universal notation for an unpaired
    // electron, so a labelled atom that also kept its placeholder dot would
    // turn every charged carbon into a radical cation.
    for (const { molecule } of FIXTURES) {
      const scene = buildScene(molecule, PUBLICATION_STYLE, SKELETAL);
      for (const atomId of molecule.atomIds) {
        const dot = scene.primitives.some((p) => p.id === `atom:${atomId}:dot`);
        const label = scene.primitives.some((p) => p.id === `atom:${atomId}:label`);
        expect(dot && label).toBe(false);
        expect(dot || label).toBe(true);
      }
    }
  });

  it("suppresses the placeholder dots when the style asks for none", () => {
    const style = withStyle(PUBLICATION_STYLE, { atomDotRadiusPx: 0 });
    const scene = buildScene(benzene(), style, SKELETAL);
    expect(scene.primitives).toHaveLength(9);
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
    // The dropped atom was in two of the six ring bonds — one single and one
    // double, so three of benzene's nine lines go with it.
    expect(ofType(scene.primitives, "line")).toHaveLength(6);
    expect(ofType(scene.primitives, "circle")).toHaveLength(5);
  });

  it("makes the structural kinds differ, starting with the carbon labels", () => {
    // This is the first pass at which the four structural views stop being the
    // same picture. Skeletal leaves benzene's carbons as bare vertices;
    // kekule, explicitH and lewis all set `showCarbonLabels`, so every vertex
    // becomes a "CH". Bond ORDER is the same in all four — nine lines
    // throughout — because it is the molecule's, not the view's; what the
    // aromaticCircles flag changes is a separate test.
    const bare = buildScene(benzene(), PUBLICATION_STYLE, SKELETAL);
    expect(ofType(bare.primitives, "circle")).toHaveLength(6);
    expect(ofType(bare.primitives, "textRun")).toHaveLength(0);

    for (const kind of ["kekule", "explicitH", "lewis"] as const) {
      const scene = buildScene(benzene(), PUBLICATION_STYLE, representation(kind));
      expect(ofType(scene.primitives, "line")).toHaveLength(9);
      expect(ofType(scene.primitives, "circle")).toHaveLength(0);
      const runs = ofType(scene.primitives, "textRun");
      expect(runs).toHaveLength(6);

      // Not six identical "CH"s: the hydrogen goes into the free space, which
      // for a ring vertex is radially OUTWARD. The two vertices on the left of
      // the ring therefore read "HC", exactly as a chemist would draw them,
      // and a renderer that wrote "CH" on all six would be making the mistake
      // this whole pass exists to avoid.
      const texts = runs.map((run) => {
        if (run.type !== "textRun") throw new Error("expected a text run");
        return run.spans.map((s) => s.text).join("");
      });
      expect(texts.filter((t) => t === "CH")).toHaveLength(4);
      expect(texts.filter((t) => t === "HC")).toHaveLength(2);
    }
  });

  it("puts a ring vertex's hydrogen on the outside of the ring", () => {
    // The same rule stated where it can actually fail: for every benzene
    // carbon, the H block must sit on the far side of the atom from the ring
    // centre. Benzene is centred on the origin, so the test is a sign check.
    const mol = benzene();
    const scene = buildScene(mol, PUBLICATION_STYLE, representation("kekule"));
    for (const primitive of scene.primitives) {
      if (primitive.type !== "textRun" || primitive.source.kind !== "atom") continue;
      const atom = getAtom(mol, primitive.source.atomId);
      if (atom === undefined) throw new Error("missing atom");
      const text = primitive.spans.map((s) => s.text).join("");
      // A vertex on the vertical axis has both horizontals equally free; the
      // tie-break sends it east, which is a decision, not an accident.
      if (Math.abs(atom.pos.x) < 1e-9) {
        expect(text).toBe("CH");
        continue;
      }
      expect(text).toBe(atom.pos.x > 0 ? "CH" : "HC");
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

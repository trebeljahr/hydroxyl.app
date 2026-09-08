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
  cis2Butene,
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
  trans2Butene,
  unmergedDropOverlap,
  wedgeOnNonStereocentre,
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

// Skeletal now DEFAULTS to the aromatic circle — the forced consequence of
// decision 11, which stripped Kekulé's carbon labels and left the circle as
// the only thing telling the two views apart. This file's baseline is the
// plain structural drawing with its Kekulé alternation intact, so it asks for
// the circle to be off rather than relying on a default that has moved.
const SKELETAL = representation("skeletal", { aromaticCircles: false });

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
      "cis2Butene",
      "trans2Butene",
      "wedgeOnNonStereocentre",
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
    // The E/Z pair is one compound drawn two ways: same formula, and the only
    // difference between the two fixtures is where one methyl sits.
    expect(molecularFormula(cis2Butene())).toBe("C4H8");
    expect(molecularFormula(trans2Butene())).toBe("C4H8");
    // Propan-2-ol. The wedge on it is the error the fixture exists for, and it
    // changes no chemistry at all — which is exactly why it renders perfectly.
    expect(molecularFormula(wedgeOnNonStereocentre())).toBe("C3H8O");
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
            new RegExp(
              `^bond:${primitive.source.bondId}:` +
                `(line[23]?|wedge|hash|wavy|cross2?|descriptor)$`,
            ),
          );
        } else if (primitive.source.kind === "atom") {
          // Every id is a pure function of the atom it came from. The trailing
          // index on a radical dot indexes ONE ATOM'S OWN cluster, so it is
          // stable too — unlike a counter that advances as iteration reaches
          // atoms, which would renumber the whole scene when one atom changed.
          expect(primitive.id).toMatch(
            new RegExp(
              `^atom:${primitive.source.atomId}:` +
                `(dot|label|descriptor|radical:\\d+)$`,
            ),
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

  it("makes all four structural kinds different pictures", () => {
    // THE POINT OF HAVING FOUR OF THEM. Until decision 11 and the vertex pass
    // landed, skeletal and kekule were the same picture and explicitH and
    // lewis differed from kekule only in flags nothing honoured.
    const counts = (kind: "skeletal" | "kekule" | "explicitH" | "lewis") => {
      const scene = buildScene(benzene(), PUBLICATION_STYLE, representation(kind));
      return {
        lines: ofType(scene.primitives, "line").length,
        circles: ofType(scene.primitives, "circle").length,
        runs: ofType(scene.primitives, "textRun").length,
      };
    };

    // Skeletal: six bare vertices, six trimmed ring edges, and ONE inscribed
    // circle standing for the delocalisation — the alternation's second lines
    // are suppressed by it.
    expect(counts("skeletal")).toEqual({ lines: 6, circles: 7, runs: 0 });

    // Kekulé: the same bare vertices (decision 11 — Kekulé does NOT spell its
    // carbons out) with the localised alternation drawn instead of the
    // circle. Nine lines: six edges plus the three inner ones.
    expect(counts("kekule")).toEqual({ lines: 9, circles: 6, runs: 0 });

    // Fully explicit: every carbon labelled and every hydrogen promoted to
    // its own vertex, so six more stems and twelve more runs — six "C" and
    // six "H". No bare-vertex dots left, because every carbon now has a
    // label, and no circle, because the alternation is what a fully explicit
    // drawing shows.
    expect(counts("explicitH")).toEqual({ lines: 15, circles: 0, runs: 12 });

    // Lewis: explicitH plus the electron marks. Benzene's carbons have no
    // lone pairs, so it draws the same picture — which is correct, and is
    // exactly why the lone-pair count is tested on water and a carbonyl.
    expect(counts("lewis")).toEqual({ lines: 15, circles: 0, runs: 12 });

    // And the labels are not six identical "CH"s any more either: the
    // hydrogens are drawn, so the carbon labels are bare.
    const explicit = buildScene(
      benzene(),
      PUBLICATION_STYLE,
      representation("explicitH"),
    );
    const texts = ofType(explicit.primitives, "textRun").map((run) => {
      if (run.type !== "textRun") throw new Error("expected a text run");
      return run.spans.map((s) => s.text).join("");
    });
    expect(texts.filter((t) => t === "C")).toHaveLength(6);
    expect(texts.filter((t) => t === "H")).toHaveLength(6);
  });

  it("puts a ring vertex's hydrogen on the outside of the ring", () => {
    // The same rule stated where it can actually fail: for every benzene
    // carbon, the H block must sit on the far side of the atom from the ring
    // centre. Benzene is centred on the origin, so the test is a sign check.
    const mol = benzene();
    // Carbon labels asked for explicitly: Kekulé leaves them bare (decision
    // 11), and the rule under test is about where a label's HYDROGEN BLOCK
    // goes, so the view has to be one that puts hydrogens on labels at all.
    const scene = buildScene(
      mol,
      PUBLICATION_STYLE,
      representation("kekule", { showCarbonLabels: true }),
    );
    let checked = 0;
    for (const primitive of scene.primitives) {
      if (primitive.type !== "textRun" || primitive.source.kind !== "atom") continue;
      const atom = getAtom(mol, primitive.source.atomId);
      if (atom === undefined) throw new Error("missing atom");
      const text = primitive.spans.map((s) => s.text).join("");
      // A vertex on the vertical axis has both horizontals equally free; the
      // tie-break sends it east, which is a decision, not an accident.
      if (Math.abs(atom.pos.x) < 1e-9) {
        checked++;
        expect(text).toBe("CH");
        continue;
      }
      checked++;
      expect(text).toBe(atom.pos.x > 0 ? "CH" : "HC");
    }
    // A view that stopped drawing carbon labels would make the loop above
    // vacuous and this test green for the wrong reason.
    expect(checked).toBeGreaterThan(0);
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

  it("sets acetate's charge as a superscript, with a real minus sign", () => {
    // U+2212 MINUS SIGN, not the ASCII hyphen chem-core's `formulaParts`
    // produces. That divergence is deliberate on chem-core's side — it makes
    // plain text a user pastes elsewhere — and wrong here: a hyphen is drawn
    // short and set low in every text face, so beside a superscript it reads
    // as a bond, which is precisely the wrong thing in a structural drawing.
    // `compose.ts` makes the same substitution for an atom label's charge.
    const run = textRun(acetate(), "sumFormula");
    expect(run.spans.at(-1)).toEqual({ text: "\u2212", script: "super" });
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

  it("walks the graph for the condensed formula instead of summing it", () => {
    // "CH3CH2OH", not "C2H6O". Ethanol and dimethyl ether have the same sum
    // formula and different condensed ones, which is the whole reason the
    // second text view exists.
    const condensed = textRun(ethanol(), "condensed");
    const sum = textRun(ethanol(), "sumFormula");
    expect(condensed.id).toBe("text:condensed:formula");
    expect(condensed.spans.map((s) => s.text).join("")).toBe("CH3CH2OH");
    expect(sum.spans.map((s) => s.text).join("")).toBe("C2H6O");
    expect(condensed.spans).not.toEqual(sum.spans);
    // Real subscripts, not digits inside a flat string.
    expect(condensed.spans.filter((s) => s.script === "sub")).toEqual([
      { text: "3", script: "sub" },
      { text: "2", script: "sub" },
    ]);
  });

  it("falls back to the sum formula for a ring, which has no condensed form", () => {
    // `representationAvailability` is what a panel consults first, and it
    // refuses `condensed` for a ring with a reason. A caller that skipped the
    // check gets a true formula rather than an exception: a scene builder
    // that throws blanks the canvas.
    const run = textRun(benzene(), "condensed");
    expect(run.spans.map((s) => s.text).join("")).toBe("C6H6");
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

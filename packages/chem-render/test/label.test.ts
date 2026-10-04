/**
 * What the label layer is contractually required to decide, say and place.
 *
 * Three modules, one file, because the three answer one question between them:
 * `visibility` decides whether an atom draws, `compose` decides what it says,
 * and `placement` decides where the glyphs sit. Splitting the tests would make
 * the seams between them — an override that suppresses hydrogens, a block that
 * reorders without reordering its own spans — nobody's test.
 *
 * Molecules are built inline with `buildMolecule` rather than pulled from
 * `fixtures.ts`, except for the two that already live there. A fixture is a
 * picture the goldens freeze; a molecule built beside its assertion is a
 * statement of what the assertion is about.
 */

import { describe, expect, it } from "vitest";

import {
  add,
  buildMolecule,
  DEG,
  flipAtoms,
  fromPolar,
  getAtom,
  implicitHydrogenCount,
  molecularFormula,
  neighborIds,
  ORIGIN,
  singleAtom,
  verticalMirror,
} from "@starter/chem-core";
import type { AtomId, Molecule, Vec2 } from "@starter/chem-core";

import { acetate, ethanol } from "../src/fixtures.js";
import { representation, STRUCTURAL_VIEW_KINDS } from "../src/representation.js";
import type { StructuralRepresentation } from "../src/representation.js";
import { modelToPx, PUBLICATION_STYLE, SCREEN_STYLE, withStyle } from "../src/style.js";
import type { RenderStyle } from "../src/style.js";
import type { ScenePoint } from "../src/scene/types.js";
import {
  composeAtomLabel,
  labelPlainText,
  labelRunId,
  labelSpans,
  radicalDotId,
  symbolSpanIndex,
} from "../src/label/compose.js";
import type { ComposedLabel } from "../src/label/compose.js";
import {
  atomLabelReason,
  atomLabelVisible,
  atomShowsHydrogens,
  drawsHydrogenVertices,
  labelOverride,
  radicalDotCount,
  revealsStereoHydrogen,
} from "../src/label/visibility.js";
import {
  chooseHydrogenSide,
  freeDirection,
  HYDROGEN_FIRST_ELEMENTS,
  LABEL_PLACEMENT,
  labelRadiusPx,
  meanBondDirection,
  placeAtomLabel,
  trimDistance,
} from "../src/label/placement.js";
import type { AtomLabelPlacement } from "../src/label/placement.js";

// Skeletal now DEFAULTS to the aromatic circle — the forced consequence of
// decision 11, which stripped Kekulé's carbon labels and left the circle as
// the only thing telling the two views apart. This file's baseline is the
// plain structural drawing with its Kekulé alternation intact, so it asks for
// the circle to be off rather than relying on a default that has moved.
const SKELETAL = representation("skeletal", { aromaticCircles: false });
const KEKULE = representation("kekule");
// Kekulé means alternating bonds and BARE carbons (decision 11), so it no
// longer spells a plain methyl out at all. Where these tests need a carbon
// label carrying its hydrogens ON THE LABEL — the "H3C" case — they ask for
// it explicitly: carbon labels on, hydrogen VERTICES off. That is "Kekulé but
// spelled out", and it is exactly the per-flag override the representation
// factory exists to allow.
const SPELLED_OUT = representation("kekule", { showCarbonLabels: true });

/**
 * The publication bond at a round 10 px font, for the two placements below
 * whose expected coordinates were worked out BY HAND from the vendored
 * advances. They test placement arithmetic, not the preset's proportions, so
 * they pin their own font rather than follow the preset when it is retuned
 * (decision 26 moved it to 50/3 px).
 */
const HAND_WORKED_STYLE = withStyle(PUBLICATION_STYLE, { fontSizePx: 10 });

/** One unit-length step from `from`, at `degrees` counter-clockwise from +x. */
function step(from: Vec2, degrees: number): Vec2 {
  return add(from, fromPolar(degrees * DEG, 1));
}

/**
 * Exactly what `scene/build.ts` will do: convert the atom and its neighbours
 * through `modelToPx` — the one function allowed to scale and flip — and hand
 * the placement pass scene px.
 *
 * Going through `modelToPx` here rather than writing scene points by hand is
 * the point. A test that invented its own scene coordinates would agree with a
 * placement pass that had its own idea of which way is up.
 */
function place(
  mol: Molecule,
  atomId: AtomId,
  view: StructuralRepresentation = SKELETAL,
  style: RenderStyle = PUBLICATION_STYLE,
): AtomLabelPlacement {
  const label = composeAtomLabel(mol, atomId, view);
  if (label === undefined) throw new Error(`${atomId} has no label to place`);
  const atom = getAtom(mol, atomId)!;
  return placeAtomLabel({
    atomId,
    centre: modelToPx(style, atom.pos),
    neighbourCentres: neighborIds(mol, atomId).map((id) =>
      modelToPx(style, getAtom(mol, id)!.pos),
    ),
    label,
    style,
  });
}

function plainText(mol: Molecule, atomId: AtomId, view = SKELETAL): string {
  const placement = place(mol, atomId, view);
  const label = composeAtomLabel(mol, atomId, view)!;
  return labelPlainText(label, placement.hydrogenSide ?? "east");
}

function unit(from: ScenePoint, to: ScenePoint): ScenePoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  return { x: dx / length, y: dy / length };
}

/* ------------------------------------------------------------------ *
 * Molecules built for one assertion each.
 * ------------------------------------------------------------------ */

/** CH3CH2OH mirrored left-to-right. Achiral and unwedged, so the mirror makes
 *  no stereochemical claim — it is purely a question about which way the label
 *  reads. */
function ethanolMirrored(): Molecule {
  const mol = ethanol();
  return flipAtoms(mol, mol.atomIds, verticalMirror(ORIGIN));
}

/** Methyl radical, •CH3: one carbon, one unpaired electron. */
function methylRadical(): Molecule {
  return buildMolecule((b) => {
    b.atom("C", ORIGIN, { radicalElectrons: 1 });
  });
}

/** Methylene, :CH2. The model carries one integer, so it cannot distinguish
 *  the singlet from the triplet; two dots is what two electrons draw as. */
function methyleneCarbene(): Molecule {
  return buildMolecule((b) => {
    b.atom("C", ORIGIN, { radicalElectrons: 2 });
  });
}

/** (CH3)3C+, the three methyls 120 degrees apart around the cation. */
function tertButylCation(): Molecule {
  return buildMolecule((b) => {
    const cation = b.atom("C", ORIGIN, { charge: 1 });
    for (const degrees of [90, 210, 330]) {
      b.bond(cation, b.atom("C", step(ORIGIN, degrees)), 1);
    }
  });
}

/** CH3X with the halogen one unit out at 30 degrees. The two differ in nothing
 *  but the halogen, so any difference downstream is the label's width. */
function halomethane(halogen: string): Molecule {
  return buildMolecule((b) => {
    const carbon = b.atom("C", ORIGIN);
    b.bond(carbon, b.atom(halogen, step(ORIGIN, 30)), 1);
  });
}

/** Ph–CH2–OH drawn with the ring abbreviated to a single labelled atom.
 *  `label` is display-only, so the MODEL is ethanol's formula, not benzyl
 *  alcohol's — which is exactly what the tests below assert. */
function abbreviatedBenzylAlcohol(): Molecule {
  return buildMolecule((b) => {
    const phenyl = b.atom("C", ORIGIN, { label: "Ph" });
    const methylenePos = step(ORIGIN, 30);
    const methylene = b.atom("C", methylenePos);
    const hydroxyl = b.atom("O", step(methylenePos, -30));
    b.bond(phenyl, methylene, 1);
    b.bond(methylene, hydroxyl, 1);
  });
}

/** 13C-methanol, drawn deliberately HORIZONTAL so exactly one side is blocked. */
function methanol13C(): Molecule {
  return buildMolecule((b) => {
    const carbon = b.atom("C", ORIGIN, { isotope: 13 });
    b.bond(carbon, b.atom("O", { x: 1, y: 0 }), 1);
  });
}

/**
 * Butan-2-ol with the C–O bond wedged, narrow end at C2.
 *
 * No CIP descriptor in the name on purpose: nothing in this repo assigns R/S,
 * and a fixture named for a configuration it does not actually depict is the
 * silently-wrong-and-renders-perfectly failure the transform module warns
 * about.
 */
function butan2olWedged(): Molecule {
  return buildMolecule((b) => {
    const c1 = b.atom("C", ORIGIN);
    const c2Pos = step(ORIGIN, 30);
    const c2 = b.atom("C", c2Pos);
    const c3Pos = step(c2Pos, -30);
    const c3 = b.atom("C", c3Pos);
    const c4 = b.atom("C", step(c3Pos, 30));
    const hydroxyl = b.atom("O", step(c2Pos, 90));
    b.bond(c1, c2, 1);
    b.bond(c2, c3, 1);
    b.bond(c3, c4, 1);
    b.bond(c2, hydroxyl, 1, "wedge");
  });
}

/** CH3–CH2• with the bond running straight up the page (model +y). */
function ethylRadicalPointing(modelY: number): Molecule {
  return buildMolecule((b) => {
    const radical = b.atom("C", ORIGIN, { radicalElectrons: 1 });
    b.bond(radical, b.atom("C", { x: 0, y: modelY }), 1);
  });
}

/* ------------------------------------------------------------------ *
 * visibility
 * ------------------------------------------------------------------ */

describe("atomLabelReason", () => {
  it("leaves ethanol's carbons bare and labels its oxygen in every structural view", () => {
    const mol = ethanol();
    expect(atomLabelReason(mol, "a1", SKELETAL)).toBeUndefined();
    expect(atomLabelReason(mol, "a2", SKELETAL)).toBeUndefined();
    // A heteroatom is a heteroatom whatever the view is set to; if this ever
    // becomes view-dependent the drawing has stopped being a structure.
    for (const kind of STRUCTURAL_VIEW_KINDS) {
      expect(atomLabelReason(mol, "a3", representation(kind))).toBe("non-carbon");
    }
  });

  it("labels a charged carbon and leaves its methyls bare", () => {
    const mol = tertButylCation();
    expect(atomLabelReason(mol, "a1", SKELETAL)).toBe("charge");
    for (const methyl of ["a2", "a3", "a4"]) {
      expect(atomLabelReason(mol, methyl, SKELETAL)).toBeUndefined();
    }
  });

  it("returns a charged carbon to a bare vertex when charges are switched off", () => {
    // A lone "C" with no sign beside it is strictly less informative than the
    // vertex it replaced, so hiding the charge must hide the label too.
    const noCharges = representation("skeletal", { showCharges: false });
    expect(atomLabelReason(tertButylCation(), "a1", noCharges)).toBeUndefined();
  });

  it("labels a radical carbon with no flag to ask for it", () => {
    // There is no showRadicals flag and there must not be one: radicals feed
    // the hydrogen count, so one that draws invisibly changes the formula the
    // reader sees without changing the picture.
    expect(atomLabelReason(ethylRadicalPointing(1), "a1", SKELETAL)).toBe("radical");
    // A LONE radical reports "isolated" instead, and that is the ordering
    // working as intended: the more specific rule wins, and both draw.
    expect(atomLabelReason(methylRadical(), "a1", SKELETAL)).toBe("isolated");
  });

  it("treats a whitespace-only override as no override at all", () => {
    const mol = buildMolecule((b) => {
      const c = b.atom("C", ORIGIN, { label: "  " });
      b.bond(c, b.atom("C", step(ORIGIN, 30)), 1);
    });
    expect(labelOverride(getAtom(mol, "a1")!)).toBeUndefined();
    expect(atomLabelReason(mol, "a1", SKELETAL)).toBeUndefined();
  });

  it("leaves the hydrogen implicit on a centre with three drawn bonds (decision 219)", () => {
    // Butan-2-ol's C2: the wedge and three drawn bonds already fix where the
    // hydrogen is, so it stays a bare vertex, as IUPAC ST-1.1 and ACS draw it.
    const mol = butan2olWedged();
    expect(implicitHydrogenCount(mol, "a2")).toBe(1);
    expect(revealsStereoHydrogen(mol, "a2")).toBe(false);
    expect(atomLabelReason(mol, "a2", SKELETAL)).toBeUndefined();
  });

  it("draws the hydrogen of a wedged carbon with two drawn bonds, but not at the wide end", () => {
    // Two drawn bonds leave the other two positions open, so the H has to
    // show for the wedge to say anything.
    const mol = buildMolecule((b) => {
      const c1 = b.atom("C", ORIGIN);
      const c2Pos = step(ORIGIN, 30);
      const c2 = b.atom("C", c2Pos);
      const o = b.atom("O", step(c2Pos, 90));
      b.bond(c1, c2, 1);
      b.bond(c2, o, 1, "wedge");
    });
    expect(atomLabelReason(mol, "a2", SKELETAL)).toBe("stereocentre");
    expect(atomLabelReason(mol, "a3", SKELETAL)).toBe("non-carbon");
    expect(atomLabelReason(mol, "a1", SKELETAL)).toBeUndefined();
  });

  it("declines a wavy bond, which states the configuration is unspecified", () => {
    const mol = buildMolecule((b) => {
      const c1 = b.atom("C", ORIGIN);
      const c2Pos = step(ORIGIN, 30);
      const c2 = b.atom("C", c2Pos);
      const c3 = b.atom("C", step(c2Pos, -30));
      const o = b.atom("O", step(c2Pos, 90));
      b.bond(c1, c2, 1);
      b.bond(c2, c3, 1);
      b.bond(c2, o, 1, "wavy");
    });
    expect(atomLabelReason(mol, "a2", SKELETAL)).toBeUndefined();
  });

  it("declines a wedge from a carbon with no hydrogen to reveal", () => {
    // Quaternary: four heavy substituents, so the wedge is not disambiguated
    // by a hydrogen and there is nothing for a label to add.
    const mol = buildMolecule((b) => {
      const centre = b.atom("C", ORIGIN);
      for (const degrees of [0, 90, 180, 270]) {
        b.bond(centre, b.atom("C", step(ORIGIN, degrees)), 1, "wedge");
      }
    });
    expect(implicitHydrogenCount(mol, "a1")).toBe(0);
    expect(revealsStereoHydrogen(mol, "a1")).toBe(false);
    expect(atomLabelReason(mol, "a1", SKELETAL)).toBeUndefined();
  });

  it("falls back to the carbon-labels flag when wedges are switched off", () => {
    // Lewis turns showStereoBonds off and showCarbonLabels on, so C2 is still
    // labelled — for a different, weaker reason.
    expect(atomLabelReason(butan2olWedged(), "a2", representation("lewis"))).toBe(
      "carbon-labels-flag",
    );
  });

  it("does not clamp the radical count, because the formula does not either", () => {
    const many = buildMolecule((b) => {
      b.atom("C", ORIGIN, { radicalElectrons: 4 });
    });
    expect(radicalDotCount(getAtom(many, "a1")!)).toBe(4);
    expect(implicitHydrogenCount(many, "a1")).toBe(0);
    const nonsense = buildMolecule((b) => {
      b.atom("C", ORIGIN, { radicalElectrons: Number.NaN });
    });
    expect(radicalDotCount(getAtom(nonsense, "a1")!)).toBe(0);
  });
});

describe("atomShowsHydrogens", () => {
  it("is true for a labelled heteroatom and false for an abbreviation on the same molecule", () => {
    const mol = abbreviatedBenzylAlcohol();
    // The seam this whole task turns on: "Ph" is visible AND carries no
    // hydrogens, while the hydroxyl beside it is visible and carries one.
    expect(atomLabelVisible(mol, "a1", SKELETAL)).toBe(true);
    expect(atomShowsHydrogens(mol, "a1", SKELETAL)).toBe(false);
    expect(atomLabelVisible(mol, "a3", SKELETAL)).toBe(true);
    expect(atomShowsHydrogens(mol, "a3", SKELETAL)).toBe(true);
  });

  it("reads showImplicitHydrogens as vertices, and therefore inverts on it", () => {
    const mol = ethanol();
    // The flag means "promote the hydrogens to their own DRAWN VERTICES", not
    // "draw H on labels". Kekulé has it OFF while spelling its heteroatoms
    // out, and their hydrogens ride along on the labels; reading it the other
    // way would leave every hydroxyl in the package set as a bare "O", and no
    // other test in the repo would notice.
    expect(KEKULE.flags.showImplicitHydrogens).toBe(false);
    expect(atomShowsHydrogens(mol, "a3", KEKULE)).toBe(true);
    expect(atomShowsHydrogens(mol, "a1", SPELLED_OUT)).toBe(true);

    // With it ON the vertex pass has them, so the label must go quiet or the
    // hydrogens are drawn twice — "OH" with an H hanging off it as well.
    const explicitH = representation("explicitH");
    expect(explicitH.flags.showImplicitHydrogens).toBe(true);
    expect(atomShowsHydrogens(mol, "a3", explicitH)).toBe(false);
    expect(drawsHydrogenVertices(mol, "a3", explicitH)).toBe(true);
    // An abbreviation sprouts none either way: a phenyl's hydrogens are
    // inside the abbreviation, and fanning five off it would draw the group
    // as a hypervalent atom.
    expect(
      drawsHydrogenVertices(abbreviatedBenzylAlcohol(), "a1", explicitH),
    ).toBe(false);
  });

  it("is false for an atom with no label", () => {
    expect(atomShowsHydrogens(ethanol(), "a1", SKELETAL)).toBe(false);
  });

  it("is false for hydrogen itself", () => {
    // Otherwise an explicitly drawn H2 sets each of its atoms as "HH".
    const dihydrogen = buildMolecule((b) => {
      const a = b.atom("H", ORIGIN);
      b.bond(a, b.atom("H", { x: 1, y: 0 }), 1);
    });
    expect(atomShowsHydrogens(dihydrogen, "a1", SKELETAL)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * compose
 * ------------------------------------------------------------------ */

describe("composeAtomLabel", () => {
  it("returns undefined for a bare vertex rather than an empty label", () => {
    expect(composeAtomLabel(ethanol(), "a1", SKELETAL)).toBeUndefined();
    expect(composeAtomLabel(ethanol(), "missing", SKELETAL)).toBeUndefined();
  });

  it("reorders blocks, never a block's own spans", () => {
    // One composed label, two orientations: proof that flipping is a
    // reordering and not a recomposition, and that the subscript stays to the
    // right of its H in both. "3HC" would be the reversed-at-glyph-level bug.
    const label = composeAtomLabel(ethanol(), "a3", SKELETAL)!;
    expect(labelPlainText(label, "east")).toBe("OH");
    expect(labelPlainText(label, "west")).toBe("HO");

    const methyl = composeAtomLabel(ethanol(), "a1", SPELLED_OUT)!;
    expect(labelPlainText(methyl, "east")).toBe("CH3");
    expect(labelPlainText(methyl, "west")).toBe("H3C");
    expect(labelSpans(methyl, "west")).toEqual([
      { text: "H" },
      { text: "3", script: "sub" },
      { text: "C" },
    ]);
  });

  it("points symbolSpanIndex at the symbol in both orientations", () => {
    const label = composeAtomLabel(methanol13C(), "a1", KEKULE)!;
    for (const side of ["east", "west"] as const) {
      const spans = labelSpans(label, side);
      expect(spans[symbolSpanIndex(label, side)]).toEqual({ text: "C" });
    }
  });

  it("sets a charge as one superscript span, with U+2212 for the sign", () => {
    const cation = composeAtomLabel(tertButylCation(), "a1", SKELETAL)!;
    expect(cation.symbol).toEqual([{ text: "C" }]);
    expect(cation.charge).toEqual([{ text: "+", script: "super" }]);
    expect(cation.hydrogenCount).toBe(0);

    const anion = composeAtomLabel(acetate(), "a4", SKELETAL)!;
    expect(anion.charge).toHaveLength(1);
    const sign = anion.charge[0]!.text;
    // U+2212 MINUS SIGN, not U+002D HYPHEN-MINUS: a hyphen is short and low,
    // and beside a superscript it reads as a bond.
    expect(sign).toBe("−");
    expect(sign).not.toBe("-");
    expect(sign.codePointAt(0)).toBe(0x2212);
  });

  it("writes a multiple charge as magnitude then sign, in one span", () => {
    const mol = buildMolecule((b) => {
      b.atom("Mg", ORIGIN, { charge: 2 });
    });
    expect(composeAtomLabel(mol, "a1", SKELETAL)!.charge).toEqual([
      { text: "2+", script: "super" },
    ]);
  });

  it("suppresses hydrogens and the isotope under a display override, but not the charge or the dots", () => {
    const mol = abbreviatedBenzylAlcohol();
    const plain = composeAtomLabel(mol, "a1", SKELETAL)!;
    expect(labelSpans(plain, "east")).toEqual([{ text: "Ph" }]);
    expect(plain.hydrogenCount).toBe(0);
    // The model still says there are three: the label is display-only, and
    // this package never edits the chemistry to match the picture.
    expect(implicitHydrogenCount(mol, "a1")).toBe(3);

    const decorated = buildMolecule((b) => {
      const phenyl = b.atom("C", ORIGIN, {
        label: "Ph",
        charge: -1,
        radicalElectrons: 1,
        isotope: 13,
      });
      b.bond(phenyl, b.atom("C", step(ORIGIN, 30)), 1);
    });
    const label = composeAtomLabel(decorated, "a1", SKELETAL)!;
    // Element-derived decorations go with the element symbol; independently
    // modelled ones stay, because they are statements about this atom rather
    // than about the group the abbreviation stands for.
    expect(labelSpans(label, "east")).toEqual([
      { text: "Ph" },
      { text: "−", script: "super" },
    ]);
    expect(label.isotope).toEqual([]);
    expect(label.radicalDotCount).toBe(1);
  });

  it("writes one hydrogen bare and several with a subscript, and none at all for none", () => {
    expect(composeAtomLabel(ethanol(), "a3", SKELETAL)!.hydrogens).toEqual([
      { text: "H" },
    ]);
    expect(composeAtomLabel(methylRadical(), "a1", SKELETAL)!.hydrogens).toEqual([
      { text: "H" },
      { text: "3", script: "sub" },
    ]);
    // Acetate's carbonyl oxygen: a double bond fills it, so no "H0".
    expect(composeAtomLabel(acetate(), "a3", SKELETAL)!.hydrogens).toEqual([]);
  });

  it("distinguishes a methyl radical from methane in the text as well as the dots", () => {
    // Two independent differences, and the formula is asserted before the
    // picture so a chemistry regression cannot hide behind a rendering one.
    expect(molecularFormula(singleAtom("C"))).toBe("CH4");
    expect(molecularFormula(methylRadical())).toBe("CH3");

    const methane = composeAtomLabel(singleAtom("C"), "a1", SKELETAL)!;
    expect(labelSpans(methane, "east")).toEqual([
      { text: "C" },
      { text: "H" },
      { text: "4", script: "sub" },
    ]);
    expect(methane.radicalDotCount).toBe(0);

    const radical = composeAtomLabel(methylRadical(), "a1", SKELETAL)!;
    expect(labelSpans(radical, "east")).toEqual([
      { text: "C" },
      { text: "H" },
      { text: "3", script: "sub" },
    ]);
    expect(radical.radicalDotCount).toBe(1);
    // The dot is a circle primitive, never a glyph — no bullet and no period
    // sneaking into the run.
    const text = labelPlainText(radical, "east");
    expect(text).not.toContain("•");
    expect(text).not.toContain(".");
  });

  it("glues the isotope to the symbol's left in both orientations", () => {
    const label = composeAtomLabel(methanol13C(), "a1", KEKULE)!;
    expect(labelPlainText(label, "east")).toBe("13CH3");
    expect(labelPlainText(label, "west")).toBe("H313C");
    expect(label.isotope).toEqual([{ text: "13", script: "super" }]);
  });

  it("derives ids from the source id, never from an iteration counter", () => {
    expect(labelRunId("a1")).toBe("atom:a1:label");
    expect(radicalDotId("a1", 0)).toBe("atom:a1:radical:0");
    expect(radicalDotId("a17", 2)).toBe("atom:a17:radical:2");
  });

  it("composes deterministically, with exactly one symbol span every time", () => {
    const molecules: readonly Molecule[] = [
      ethanol(),
      ethanolMirrored(),
      acetate(),
      tertButylCation(),
      methyleneCarbene(),
      abbreviatedBenzylAlcohol(),
      methanol13C(),
      butan2olWedged(),
    ];
    for (const mol of molecules) {
      for (const kind of STRUCTURAL_VIEW_KINDS) {
        const view = representation(kind);
        for (const atomId of mol.atomIds) {
          const first = composeAtomLabel(mol, atomId, view);
          const second = composeAtomLabel(mol, atomId, view);
          expect(second).toEqual(first);
          if (first !== undefined) expect(first.symbol).toHaveLength(1);
        }
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * placement — direction
 * ------------------------------------------------------------------ */

describe("freeDirection", () => {
  it("points north for an atom with no bonds", () => {
    // Visually up, and with no horizontal bias — which is what hands the
    // east/west question cleanly to the hydrogen-first element rule.
    expect(freeDirection({ x: 0, y: 0 }, [])).toEqual({ x: 0, y: -1 });
  });

  it("points away from the single bond of a terminal atom", () => {
    const free = freeDirection({ x: 0, y: 0 }, [{ x: 10, y: 0 }]);
    expect(free.x).toBeCloseTo(-1, 12);
    expect(free.y).toBeCloseTo(0, 12);
  });

  it("gives a linear atom a perpendicular rather than a normalised zero", () => {
    // The mean of two opposed bonds is the zero vector; normalising it is NaN,
    // which survives every later step and first surfaces in the serialiser.
    const centre = { x: 0, y: 0 };
    const neighbours = [
      { x: -24, y: 0 },
      { x: 24, y: 0 },
    ];
    expect(meanBondDirection(centre, neighbours)).toBeUndefined();
    const free = freeDirection(centre, neighbours);
    expect(Number.isFinite(free.x) && Number.isFinite(free.y)).toBe(true);
    expect(Math.abs(free.y)).toBeCloseTo(1, 12);
    expect(free.x).toBeCloseTo(0, 12);
    // North, by the tie-break, not south: both gaps are exactly half a turn.
    expect(free.y).toBeLessThan(0);
  });

  it("skips a neighbour sitting on top of the atom instead of dividing by zero", () => {
    const centre = { x: 5, y: 5 };
    const free = freeDirection(centre, [{ x: 5, y: 5 }, { x: 5, y: -19 }]);
    expect(Number.isNaN(free.x) || Number.isNaN(free.y)).toBe(false);
    // Only the real neighbour counts, so this behaves as a terminal atom.
    expect(free.x).toBeCloseTo(0, 12);
    expect(free.y).toBeCloseTo(1, 12);
  });

  it("treats an atom whose only neighbour is coincident as unbonded", () => {
    expect(freeDirection({ x: 3, y: 4 }, [{ x: 3, y: 4 }])).toEqual({ x: 0, y: -1 });
    expect(meanBondDirection({ x: 3, y: 4 }, [{ x: 3, y: 4 }])).toBeUndefined();
  });

  it("does not depend on the order the neighbours arrive in", () => {
    // Bond insertion order changes when an atom is deleted and redrawn, when a
    // fragment is pasted, and across a molfile round-trip, none of which move
    // an atom. A label that followed it would put spurious diffs in exports.
    const centre = { x: 0, y: 0 };
    const neighbours = [
      { x: 24, y: 0 },
      { x: -12, y: -20.784609690826528 },
      { x: -12, y: 20.784609690826528 },
    ];
    const forward = freeDirection(centre, neighbours);
    const reversed = freeDirection(centre, [...neighbours].reverse());
    expect(reversed).toEqual(forward);
  });
});

describe("chooseHydrogenSide", () => {
  it("uses the hydride convention only for an atom with no bonds", () => {
    expect(HYDROGEN_FIRST_ELEMENTS.has("O")).toBe(true);
    expect(HYDROGEN_FIRST_ELEMENTS.has("C")).toBe(false);
    expect(chooseHydrogenSide([], { x: 0, y: -1 }, "O")).toBe("west");
    expect(chooseHydrogenSide([], { x: 0, y: -1 }, "C")).toBe("east");
  });

  it("follows the free direction when neither side is blocked", () => {
    expect(chooseHydrogenSide([{ x: -0.866, y: -0.5 }], { x: 0.866, y: 0.5 }, "O")).toBe(
      "east",
    );
    expect(chooseHydrogenSide([{ x: 0.866, y: -0.5 }], { x: -0.866, y: 0.5 }, "O")).toBe(
      "west",
    );
  });

  it("falls to east when the free direction is purely vertical", () => {
    // A symmetric zig-zag apex. Nothing forces the issue, and a chemist writes
    // left to right.
    expect(chooseHydrogenSide(
      [
        { x: -0.866, y: -0.5 },
        { x: 0.866, y: -0.5 },
      ],
      { x: 0, y: 1 },
      "C",
    )).toBe("east");
  });

  it("takes the other side when a bond leaves along one of them", () => {
    expect(chooseHydrogenSide([{ x: 1, y: 0 }], { x: -1, y: 0 }, "O")).toBe("west");
    expect(chooseHydrogenSide([{ x: -1, y: 0 }], { x: 1, y: 0 }, "O")).toBe("east");
  });

  it("takes the roomier side when both are blocked", () => {
    // A straight horizontal chain vertex. Stacking the hydrogens above the
    // symbol is the proper answer and belongs with the bond-geometry pass;
    // until then the roomier horizontal is at least legible and never NaN.
    const nearlyWest = { x: -0.999, y: 0.0447 };
    const flatEast = { x: 1, y: 0 };
    expect(chooseHydrogenSide([nearlyWest, flatEast], { x: 0, y: -1 }, "C")).toBe("west");
  });

  it("pins the blocking half-angle to the cosine that is actually compared", () => {
    expect(LABEL_PLACEMENT.horizontalBlockCos).toBeCloseTo(
      Math.cos(LABEL_PLACEMENT.horizontalBlockHalfAngleDeg * (Math.PI / 180)),
      12,
    );
  });
});

/* ------------------------------------------------------------------ *
 * placement — geometry
 * ------------------------------------------------------------------ */

describe("placeAtomLabel", () => {
  it("puts ethanol's hydroxyl hydrogen on the free side, and its mirror image on the other", () => {
    const upright = place(ethanol(), "a3");
    expect(upright.hydrogenSide).toBe("east");
    expect(upright.run.spans).toEqual([{ text: "O" }, { text: "H" }]);
    expect(plainText(ethanol(), "a3")).toBe("OH");

    const mirrored = place(ethanolMirrored(), "a3");
    expect(mirrored.hydrogenSide).toBe("west");
    expect(mirrored.run.spans).toEqual([{ text: "H" }, { text: "O" }]);
    expect(plainText(ethanolMirrored(), "a3")).toBe("HO");
  });

  it("sets a spelled-out ethanol's methyl as H3C and its methylene as CH2", () => {
    // The two cases the contact sheet is reviewed for: the terminal methyl
    // reads into the chain, and the 30-degree zig-zag apex does not stack.
    expect(plainText(ethanol(), "a1", SPELLED_OUT)).toBe("H3C");
    expect(plainText(ethanol(), "a2", SPELLED_OUT)).toBe("CH2");
    expect(place(ethanol(), "a2", SPELLED_OUT).hydrogenSide).toBe("east");
  });

  it("orders a lone atom's hydrogens by the hydride convention", () => {
    expect(plainText(singleAtom("O"), "a1")).toBe("H2O");
    expect(plainText(singleAtom("C"), "a1")).toBe("CH4");
  });

  it("takes the unblocked side when a bond runs flat along the other", () => {
    // 13C-methanol is drawn horizontal on purpose: the carbon's only bond
    // leaves due east, so the hydrogens have to go west.
    const mol = methanol13C();
    expect(place(mol, "a1").hydrogenSide).toBe("west");
    expect(plainText(mol, "a1")).toBe("H313C");
    expect(plainText(mol, "a2")).toBe("OH");
  });

  it("centres the SYMBOL block on the atom, not the run", () => {
    // The detail that separates a correct label from an approximate one. Fix
    // the run's midpoint instead and every bond meets the gap between two
    // letters — invisible until bonds are trimmed, and then debugged in the
    // wrong file.
    const cases: readonly AtomLabelPlacement[] = [
      place(acetate(), "a3"),
      place(ethanol(), "a3"),
      place(ethanolMirrored(), "a3"),
      place(singleAtom("O"), "a1"),
      place(tertButylCation(), "a1"),
      place(methanol13C(), "a1"),
      place(abbreviatedBenzylAlcohol(), "a1"),
    ];
    for (const placement of cases) {
      const { symbolBox, centre } = placement;
      expect((symbolBox.minX + symbolBox.maxX) / 2).toBeCloseTo(centre.x, 9);
      expect((symbolBox.minY + symbolBox.maxY) / 2).toBeCloseTo(centre.y, 9);
    }
  });

  it("lets an isotope prefix move the run's origin without moving the symbol", () => {
    const plain = place(
      buildMolecule((b) => {
        b.bond(b.atom("C", ORIGIN), b.atom("O", { x: 1, y: 0 }), 1);
      }),
      "a1",
      SPELLED_OUT,
    );
    const labelled = place(methanol13C(), "a1", SPELLED_OUT);
    // The prefix is a satellite glued to the symbol's left, so the run starts
    // further left while the C stays exactly on the bond.
    expect(labelled.run.origin.x).toBeLessThan(plain.run.origin.x);
    expect((labelled.symbolBox.minX + labelled.symbolBox.maxX) / 2).toBeCloseTo(
      (plain.symbolBox.minX + plain.symbolBox.maxX) / 2,
      9,
    );
  });

  it("places ethanol's hydroxyl at the coordinates the design worked out by hand", () => {
    // Recomputed by hand from the vendored advances: O = 1593/2048 em and
    // H = 1479/2048 em, so "OH" is exactly 15.0 px at a 10 px font, and the
    // cap band is 1409/2048 * 10 = 6.8798828125 px.
    const placement = place(ethanol(), "a3", SKELETAL, HAND_WORKED_STYLE);
    const oxygenAdvance = (1593 / 2048) * 10;
    const capHeight = (1409 / 2048) * 10;
    expect(placement.centre.x).toBeCloseTo(41.56921938165306, 9);
    expect(placement.run.origin.x).toBeCloseTo(
      placement.centre.x - oxygenAdvance / 2,
      9,
    );
    expect(placement.run.origin.y).toBeCloseTo(placement.centre.y + capHeight / 2, 9);
    expect(placement.run.anchor).toBe("start");
    // Padding enters exactly once, here. A trimmer that pads again would make
    // every bond in the figure visibly short.
    expect(placement.symbolBox.maxX - placement.symbolBox.minX).toBeCloseTo(
      oxygenAdvance + 2 * PUBLICATION_STYLE.labelPaddingPx,
      9,
    );
    expect(placement.symbolBox.maxY - placement.symbolBox.minY).toBeCloseTo(
      capHeight + 2 * PUBLICATION_STYLE.labelPaddingPx,
      9,
    );
  });

  it("gives bromine and iodine visibly different extents", () => {
    // 2048 units against 569: the halogen is the only difference between the
    // two molecules, so the whole difference belongs to the label.
    const bromo = place(halomethane("Br"), "a2");
    const iodo = place(halomethane("I"), "a2");
    const width = (box: AtomLabelPlacement) => box.clearBox.maxX - box.clearBox.minX;
    expect(width(bromo) - width(iodo)).toBeCloseTo(
      ((2048 - 569) / 2048) * PUBLICATION_STYLE.fontSizePx,
      9,
    );
    expect(labelRadiusPx(bromo)).toBeGreaterThan(labelRadiusPx(iodo));
  });

  it("keeps every ray out at least as far as the padded symbol box", () => {
    // The padded symbol rect always contains the atom centre, which is the
    // guarantee that lets the trimmer fire a ray from any neighbour and get a
    // sensible distance back rather than zero.
    const placement = place(acetate(), "a4");
    const half = Math.min(
      placement.centre.x - placement.symbolBox.minX,
      placement.symbolBox.maxX - placement.centre.x,
      placement.centre.y - placement.symbolBox.minY,
      placement.symbolBox.maxY - placement.centre.y,
    );
    expect(half).toBeGreaterThan(0);
    for (let degrees = 0; degrees < 360; degrees += 15) {
      const radians = degrees * (Math.PI / 180);
      const direction = { x: Math.cos(radians), y: Math.sin(radians) };
      expect(trimDistance(placement, direction)).toBeGreaterThanOrEqual(half);
    }
  });

  it("trims a bond to the label's near edge, not to its bounding box", () => {
    const mol = ethanol();
    const placement = place(mol, "a3", SKELETAL, HAND_WORKED_STYLE);
    const towardsNeighbour = unit(
      placement.centre,
      modelToPx(HAND_WORKED_STYLE, getAtom(mol, "a2")!.pos),
    );
    // The O sits at the run's west end, so a bond arriving from the west stops
    // at the O's own padded rect and never sees the H beyond it.
    expect(trimDistance(placement, towardsNeighbour)).toBeCloseTo(6.338336187671812, 9);
    expect(trimDistance(placement, towardsNeighbour)).toBeLessThan(
      labelRadiusPx(placement),
    );
  });

  it("throws rather than draw an atom whose symbol went missing", () => {
    const label = composeAtomLabel(ethanol(), "a3", SKELETAL)!;
    const broken: ComposedLabel = { ...label, symbol: [] };
    expect(() =>
      placeAtomLabel({
        atomId: "a3",
        centre: { x: 0, y: 0 },
        neighbourCentres: [],
        label: broken,
        style: PUBLICATION_STYLE,
      }),
    ).toThrow(/empty label symbol/);
  });

  it("places the same input to the same numbers, whatever order the neighbours arrive in", () => {
    const mol = butan2olWedged();
    const label = composeAtomLabel(mol, "a5", SKELETAL)!;
    const centre = modelToPx(PUBLICATION_STYLE, getAtom(mol, "a5")!.pos);
    const neighbours = neighborIds(mol, "a5").map((id) =>
      modelToPx(PUBLICATION_STYLE, getAtom(mol, id)!.pos),
    );
    const base = placeAtomLabel({
      atomId: "a5",
      centre,
      neighbourCentres: neighbours,
      label,
      style: PUBLICATION_STYLE,
    });
    const again = placeAtomLabel({
      atomId: "a5",
      centre,
      neighbourCentres: neighbours,
      label,
      style: PUBLICATION_STYLE,
    });
    const permuted = placeAtomLabel({
      atomId: "a5",
      centre,
      neighbourCentres: [...neighbours].reverse(),
      label,
      style: PUBLICATION_STYLE,
    });
    expect(again).toEqual(base);
    expect(permuted).toEqual(base);
  });
});

/* ------------------------------------------------------------------ *
 * placement — the mirror invariants, which are what catch a second y-flip
 * ------------------------------------------------------------------ */

describe("placement under reflection", () => {
  it("mirrors left-to-right exactly, swapping the hydrogen side", () => {
    const upright = place(ethanol(), "a3");
    const mirrored = place(ethanolMirrored(), "a3");
    expect(mirrored.centre.x).toBeCloseTo(-upright.centre.x, 9);
    expect(mirrored.hydrogenSide).toBe("west");
    expect(upright.hydrogenSide).toBe("east");
    // Every x reflects about the origin the molecule was mirrored in; every y
    // is untouched.
    expect(mirrored.symbolBox.minX).toBeCloseTo(-upright.symbolBox.maxX, 9);
    expect(mirrored.symbolBox.maxX).toBeCloseTo(-upright.symbolBox.minX, 9);
    expect(mirrored.symbolBox.minY).toBeCloseTo(upright.symbolBox.minY, 9);
    expect(mirrored.symbolBox.maxY).toBeCloseTo(upright.symbolBox.maxY, 9);
    expect(mirrored.clearBox.minX).toBeCloseTo(-upright.clearBox.maxX, 9);
    expect(mirrored.freeDirection.x).toBeCloseTo(-upright.freeDirection.x, 9);
    expect(mirrored.freeDirection.y).toBeCloseTo(upright.freeDirection.y, 9);
  });

  it("puts a radical dot on the opposite side of the page from the bond", () => {
    // THE test for a stray second y-negation. Take the bond directions from
    // the model (y-up) instead of from the already-flipped scene and the dot
    // lands on top of the bond, while every horizontal fixture in the package
    // still looks perfect and every other test stays green.
    const bondUpThePage = place(ethylRadicalPointing(1), "a1");
    expect(bondUpThePage.freeDirection.x).toBeCloseTo(0, 12);
    expect(bondUpThePage.freeDirection.y).toBeCloseTo(1, 12);
    expect(bondUpThePage.dots).toHaveLength(1);
    expect(bondUpThePage.dots[0]!.centre.y).toBeGreaterThan(bondUpThePage.centre.y);
    expect(bondUpThePage.dots[0]!.centre.x).toBeCloseTo(bondUpThePage.centre.x, 9);

    const bondDownThePage = place(ethylRadicalPointing(-1), "a1");
    expect(bondDownThePage.freeDirection.x).toBeCloseTo(0, 12);
    expect(bondDownThePage.freeDirection.y).toBeCloseTo(-1, 12);
    expect(bondDownThePage.dots[0]!.centre.y).toBeLessThan(bondDownThePage.centre.y);
    // The two are exact reflections of each other in y.
    expect(bondDownThePage.dots[0]!.centre.y).toBeCloseTo(
      -bondUpThePage.dots[0]!.centre.y,
      9,
    );
    // …and identical in x, and on the same side of the symbol.
    expect(bondDownThePage.hydrogenSide).toBe(bondUpThePage.hydrogenSide);
    expect(bondDownThePage.symbolBox.minX).toBeCloseTo(bondUpThePage.symbolBox.minX, 9);
  });
});

/* ------------------------------------------------------------------ *
 * placement — radical dots
 * ------------------------------------------------------------------ */

describe("radical dots", () => {
  it("gives a methyl radical one dot to the north, clear of its own label", () => {
    const placement = place(methylRadical(), "a1");
    expect(placement.dots).toHaveLength(1);
    const dot = placement.dots[0]!;
    // North: where a chemist draws an unpaired electron, and where it is least
    // likely to meet a 30-degree bond.
    expect(dot.centre.x).toBeCloseTo(placement.centre.x, 9);
    expect(dot.centre.y).toBeLessThan(placement.centre.y);
    // Exactly where a bond arriving from the same direction would be trimmed
    // to, plus the dot's own radius — one clearance rule, not two.
    const north = { x: 0, y: -1 };
    const spanOnly: AtomLabelPlacement = {
      ...placement,
      obstacles: placement.obstacles.filter((o) => o.kind === "rect"),
    };
    expect(-dot.centre.y + placement.centre.y).toBeCloseTo(
      trimDistance(spanOnly, north) + dot.radius,
      9,
    );
  });

  it("scales the dot with the font but never finer than the figure's hairline", () => {
    const publication = place(methylRadical(), "a1", SKELETAL, PUBLICATION_STYLE);
    const screen = place(methylRadical(), "a1", SKELETAL, SCREEN_STYLE);
    // max(0.10 * 50/3, 0.5 * 1) = 5/3 and max(0.10 * 16, 0.5 * 2) = 1.6.
    expect(publication.dots[0]!.radius).toBeCloseTo(5 / 3, 9);
    expect(screen.dots[0]!.radius).toBeCloseTo(1.6, 9);
  });

  it("lays a pair perpendicular to its direction, far enough apart to read as two", () => {
    const placement = place(methyleneCarbene(), "a1");
    expect(placement.dots).toHaveLength(2);
    const [first, second] = placement.dots as [
      (typeof placement.dots)[number],
      (typeof placement.dots)[number],
    ];
    // The cluster runs north, so the pair is spread in x.
    expect(first.centre.y).toBeCloseTo(second.centre.y, 9);
    const spacing = Math.abs(second.centre.x - first.centre.x);
    expect(spacing).toBeCloseTo(
      LABEL_PLACEMENT.radicalDotSpacingFactor * first.radius,
      9,
    );
    // Centred on the cluster, not hanging off one end of it.
    expect((first.centre.x + second.centre.x) / 2).toBeCloseTo(placement.centre.x, 9);
  });

  it("draws every dot the model claims, without clamping the cluster", () => {
    const many = buildMolecule((b) => {
      b.atom("N", ORIGIN, { radicalElectrons: 4 });
    });
    // Four electrons have already removed four hydrogens from the formula;
    // drawing three dots would make the picture disagree with it.
    expect(place(many, "a1").dots).toHaveLength(4);
  });

  it("contributes its dots to the obstacle union and to the clear box", () => {
    const placement = place(methylRadical(), "a1");
    expect(placement.obstacles.filter((o) => o.kind === "disc")).toHaveLength(1);
    const topOfLabel = Math.min(
      ...placement.obstacles.flatMap((o) => (o.kind === "rect" ? [o.box.minY] : [])),
    );
    // The dot reaches above the glyphs, so the clear box has to grow for it.
    expect(placement.clearBox.minY).toBeLessThan(topOfLabel);
  });

  it("keeps a dot off the cardinal the hydrogens took", () => {
    // An aminyl radical, R2N-H with the R to the WEST. West is blocked by the
    // bond so the hydrogen goes east; east is then the emptiest compass point
    // by a clear margin, and the dot still must not take it — a dot beyond the
    // H reads as belonging to the hydrogen rather than to the nitrogen.
    const mol = buildMolecule((b) => {
      const nitrogen = b.atom("N", ORIGIN, { radicalElectrons: 1 });
      b.bond(nitrogen, b.atom("C", { x: -1, y: 0 }), 1);
    });
    const placement = place(mol, "a1");
    expect(placement.hydrogenSide).toBe("east");
    expect(placement.dots).toHaveLength(1);
    const direction = unit(placement.centre, placement.dots[0]!.centre);
    // North-east: the next-emptiest point in the preference order.
    expect(direction.x).toBeCloseTo(Math.SQRT1_2, 9);
    expect(direction.y).toBeCloseTo(-Math.SQRT1_2, 9);
  });
});

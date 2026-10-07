/**
 * Dative bonds, bold bonds and hydrogen bonds as drawn (decision 226).
 *
 * The three answers the ruling gave, each checked where it shows: a dative
 * bond is an ARROW from donor to acceptor; a bold bond is the same bond with a
 * wide main line; a hydrogen bond is a DOTTED annotation that chem-core never
 * sees, so the acetic acid dimer stays two molecules of C2H4O2.
 */

import { describe, expect, it } from "vitest";

import {
  buildMolecule,
  flipBond,
  molecularFormula,
  setBondBold,
  setBondDative,
  species,
  vec,
} from "@starter/chem-core";
import type { AtomId, BondId, Molecule } from "@starter/chem-core";

import { DATIVE_ARROWHEAD } from "../src/annotation/arrowhead.js";
import { SCHEME_LAYOUT } from "../src/annotation/scheme-mark.js";
import { representation } from "../src/representation.js";
import { assembleSchemeAnnotation, schemeAnnotationId } from "../src/scheme/annotation.js";
import type { SchemeAnnotation } from "../src/scheme/annotation.js";
import { buildAnnotatedScene, buildScene } from "../src/scene/build.js";
import type { LinePrimitive, PolygonPrimitive, ScenePoint, ScenePrimitive } from "../src/scene/types.js";
import { serializeScene } from "../src/svg/serialize.js";
import { pxPerModelUnit, PUBLICATION_STYLE, SCREEN_STYLE } from "../src/style.js";

const SKELETAL = representation("skeletal");

function byId<T extends ScenePrimitive>(scene: { primitives: readonly ScenePrimitive[] }, id: string): T {
  const found = scene.primitives.find((p) => p.id === id);
  if (found === undefined) throw new Error(`no primitive ${id}`);
  return found as T;
}

function distance(a: ScenePoint, b: ScenePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** cis-[PtCl2(NH3)2] with both ammines dative, N->Pt. */
function cisplatin(): { molecule: Molecule; dative: BondId } {
  let pt = "";
  let ammine = "";
  let dative = "";
  const plain = buildMolecule((m) => {
    pt = m.atom("Pt", vec(0, 0));
    m.bond(m.atom("Cl", vec(-1, 0)), pt);
    m.bond(m.atom("Cl", vec(0, -1)), pt);
    ammine = m.atom("N", vec(1, 0));
    dative = m.bond(ammine, pt);
    m.bond(m.atom("N", vec(0, 1)), pt);
  });
  return { molecule: setBondDative(plain, dative, true), dative };
}

describe("a dative bond is drawn as an arrow toward the acceptor", () => {
  for (const style of [PUBLICATION_STYLE, SCREEN_STYLE]) {
    it(`puts the head at platinum, not at the ammine (${style === PUBLICATION_STYLE ? "publication" : "screen"})`, () => {
      const { molecule, dative } = cisplatin();
      const scene = buildScene(molecule, style, SKELETAL);
      const head = byId<PolygonPrimitive>(scene, `bond:${dative}:dative-head`);
      const shaft = byId<LinePrimitive>(scene, `bond:${dative}:line`);
      // The tip is the head's first point and the shaft ends inside the head.
      const tip = head.points[0]!;
      expect(distance(shaft.b, tip)).toBeCloseTo(DATIVE_ARROWHEAD.notch * style.bondLineWidthPx, 6);
      // The tip is nearer platinum's end of the shaft than the ammine's.
      expect(distance(tip, shaft.b)).toBeLessThan(distance(tip, shaft.a));
      expect(head.fill?.color).toBe(style.colors.bond);
    });
  }

  it("turns round when the bond is flipped", () => {
    const { molecule, dative } = cisplatin();
    const before = byId<PolygonPrimitive>(buildScene(molecule, PUBLICATION_STYLE, SKELETAL), `bond:${dative}:dative-head`);
    const after = byId<PolygonPrimitive>(buildScene(flipBond(molecule, dative), PUBLICATION_STYLE, SKELETAL), `bond:${dative}:dative-head`);
    const plain = byId<LinePrimitive>(buildScene(setBondDative(molecule, dative, false), PUBLICATION_STYLE, SKELETAL), `bond:${dative}:line`);
    // Plain, the line runs ammine -> Pt; the head sits at its `b` end before
    // the flip and at its `a` end after.
    expect(distance(before.points[0]!, plain.b)).toBeLessThan(distance(before.points[0]!, plain.a));
    expect(distance(after.points[0]!, plain.a)).toBeLessThan(distance(after.points[0]!, plain.b));
  });

  it("reaches the SVG as a filled head", () => {
    const { molecule, dative } = cisplatin();
    const svg = serializeScene(buildScene(molecule, PUBLICATION_STYLE, SKELETAL));
    expect(svg).toContain(`bond:${dative}:dative-head`);
  });
});

describe("a bold bond is drawn wide, and is otherwise the same bond", () => {
  function ethanol(): { molecule: Molecule; cc: BondId; co: BondId } {
    let cc = "";
    let co = "";
    const molecule = buildMolecule((m) => {
      const c1 = m.atom("C", vec(0, 0));
      const c2 = m.atom("C", vec(0.866, 0.5));
      cc = m.bond(c1, c2);
      co = m.bond(c2, m.atom("O", vec(1.732, 0)));
    });
    return { molecule, cc, co };
  }

  it("is as wide as a wedge's broad end, round-capped, and nothing else changes", () => {
    const { molecule, cc, co } = ethanol();
    const plain = buildScene(molecule, PUBLICATION_STYLE, SKELETAL);
    const bold = buildScene(setBondBold(molecule, cc, true), PUBLICATION_STYLE, SKELETAL);
    const line = byId<LinePrimitive>(bold, `bond:${cc}:line`);
    expect(line.stroke.width).toBe(PUBLICATION_STYLE.stereoWedgeWidthPx);
    expect(line.stroke.cap).toBe("round");
    const before = byId<LinePrimitive>(plain, `bond:${cc}:line`);
    expect([line.a, line.b]).toEqual([before.a, before.b]);
    expect(byId<LinePrimitive>(bold, `bond:${co}:line`)).toEqual(byId<LinePrimitive>(plain, `bond:${co}:line`));
  });

  it("makes only the main line of a double bond bold", () => {
    let co = "";
    const acetone = buildMolecule((m) => {
      const c = m.atom("C", vec(0, 0));
      m.bond(c, m.atom("C", vec(-0.866, -0.5)));
      m.bond(c, m.atom("C", vec(0.866, -0.5)));
      co = m.bond(c, m.atom("O", vec(0, 1)), 2);
    });
    const scene = buildScene(setBondBold(acetone, co, true), PUBLICATION_STYLE, SKELETAL);
    const bondLines = scene.primitives.filter(
      (p): p is LinePrimitive => p.type === "line" && p.id.startsWith(`bond:${co}:`),
    );
    expect(bondLines.map((l) => l.stroke.width).sort()).toEqual(
      [PUBLICATION_STYLE.bondLineWidthPx, PUBLICATION_STYLE.stereoWedgeWidthPx].sort(),
    );
  });
});

describe("a hydrogen bond is a dotted annotation, never a bond", () => {
  /**
   * The acetic acid dimer: two molecules facing each other, each O-H donating
   * to the other's C=O. The hydroxyl oxygens carry their hydrogen implicitly.
   */
  function aceticAcidDimer(): { molecule: Molecule; hBonds: SchemeAnnotation[] } {
    const hydroxyl: AtomId[] = [];
    const carbonyl: AtomId[] = [];
    const molecule = buildMolecule((m) => {
      for (const side of [-1, 1]) {
        const c = m.atom("C", vec(side * 1.2, 0));
        m.bond(c, m.atom("C", vec(side * 2.2, 0)));
        const oh = m.atom("O", vec(side * 0.7, side * 0.866));
        const o = m.atom("O", vec(side * 0.7, -side * 0.866));
        m.bond(c, oh);
        m.bond(c, o, 2);
        hydroxyl.push(oh);
        carbonyl.push(o);
      }
    });
    const hBonds = [
      assembleSchemeAnnotation({ id: schemeAnnotationId(1), kind: "hydrogenBond", atoms: [hydroxyl[0]!, carbonyl[1]!] }),
      assembleSchemeAnnotation({ id: schemeAnnotationId(2), kind: "hydrogenBond", atoms: [hydroxyl[1]!, carbonyl[0]!] }),
    ];
    return { molecule, hBonds };
  }

  it("leaves the formula and the species alone: two molecules of acetic acid", () => {
    const { molecule } = aceticAcidDimer();
    expect(species(molecule)).toHaveLength(2);
    expect(molecularFormula(molecule)).toBe("C4H8O4");
  });

  it("draws each one dotted between its atoms, trimmed at their labels", () => {
    const { molecule, hBonds } = aceticAcidDimer();
    const scene = buildAnnotatedScene(molecule, PUBLICATION_STYLE, SKELETAL, { schemeAnnotations: hBonds });
    expect(scene.schemeAnnotations.hydrogenBonds.map((h) => h.findings)).toEqual([[], []]);
    const bond = pxPerModelUnit(PUBLICATION_STYLE);
    for (const annotation of hBonds) {
      const line = byId<LinePrimitive>(scene.scene, `annotation:${annotation.id}:hydrogen-bond`);
      const width = PUBLICATION_STYLE.bondLineWidthPx;
      expect(line.stroke.dash?.[0]).toBe(width);
      expect((line.stroke.dash?.[0] ?? 0) + (line.stroke.dash?.[1] ?? 0)).toBeCloseTo(
        Math.max(SCHEME_LAYOUT.hydrogenBondDotPitchBonds * bond, 2 * width),
        6,
      );
      // Dots, not a partial bond's dashes.
      expect(line.stroke.dash).not.toEqual(SCHEME_LAYOUT.partialBondDashBonds.map((f) => f * bond));
      expect(distance(line.a, line.b)).toBeGreaterThan(0);
    }
  });

  it("is reported when drawn over a bond the molecule already has", () => {
    const { molecule } = aceticAcidDimer();
    // The first acid's carboxyl carbon and its hydroxyl oxygen.
    const [c, oh] = [molecule.atomIds[0]!, molecule.atomIds[2]!];
    const over = assembleSchemeAnnotation({ id: schemeAnnotationId(3), kind: "hydrogenBond", atoms: [c, oh] });
    const scene = buildAnnotatedScene(molecule, PUBLICATION_STYLE, SKELETAL, { schemeAnnotations: [over] });
    expect(scene.schemeAnnotations.hydrogenBonds[0]!.findings).toEqual([{ kind: "on-drawn-bond" }]);
  });
});

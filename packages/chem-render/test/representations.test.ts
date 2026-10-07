/**
 * The three views this pass added: fully explicit, Lewis, and condensed — plus
 * the availability function that says when one of them cannot be produced.
 *
 * The geometry assertions here are all RELATIVE — a hydrogen is on the far
 * side of its host from the ring, a lone pair is away from the bonds — rather
 * than pinned coordinates. The pinned coordinates are the goldens' job, and
 * the contact sheet is what a human reads them against; a second copy of the
 * numbers here would fail twice for one change and say nothing extra.
 */

import { describe, expect, it } from "vitest";

import {
  benzene,
  bondsAt,
  buildMolecule,
  hydrogenFan,
  implicitHydrogenCount,
  molecularFormula,
  normalizeAnglePositive,
  ORIGIN,
  rotateAtoms,
  singleAtom,
  vec,
  setBondQuery,
} from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";

import { representationAvailability, availabilityByKind } from "../src/availability.js";
import {
  acetate,
  chrysene,
  dimethylSulfone,
  ethanol,
  FIXTURES,
  naphthalene,
  perhydrophenanthrene,
  steroidSkeleton,
} from "../src/fixtures.js";
import { derivedHydrogenDirections } from "../src/modes/explicitH.js";
import { representation } from "../src/representation.js";
import { atomLabelPlacements, buildScene, derivedHydrogens } from "../src/scene/build.js";
import { PRINTED_BOND_LENGTH_CM } from "../src/figure/physical.js";
import { detectCollisions } from "../src/scene/collide.js";
import { serializeScene } from "../src/svg/serialize.js";
import type { CirclePrimitive, RenderScene, ScenePoint } from "../src/scene/types.js";
import {
  modelToPx,
  PUBLICATION_STYLE,
  pxPerModelUnit,
  RENDER_STYLES,
  SCREEN_STYLE,
} from "../src/style.js";
import type { RenderStyle } from "../src/style.js";
import type { StructuralRepresentation } from "../src/representation.js";

const EXPLICIT_H = representation("explicitH");
const LEWIS = representation("lewis");
const PRESETS = [PUBLICATION_STYLE, SCREEN_STYLE] as const;

function hydrogenPrimitives(scene: RenderScene, type: "line" | "textRun") {
  return scene.primitives.filter(
    (p) => p.type === type && p.source.kind === "hydrogen",
  );
}

/**
 * What the crowding sweep draws: every fixture, and the two sp3 fused-ring
 * systems.
 *
 * `unmergedDropOverlap` is excluded: it deliberately holds two fragments
 * dropped on top of each other, so its heavy atoms already collide and its
 * hydrogens have to.
 *
 * THE FUSED sp3 RINGS ARE WHY THIS IS NOT JUST `FIXTURES`. Nothing in that
 * set puts a hydrogen-bearing carbon between two others in a ring: a chain
 * vertex has 240 degrees of page to fan into, and the aromatic fixtures'
 * junctions carry no hydrogens. Perhydrophenanthrene is that case on its own;
 * the steroid adds the two angular methyls, the most crowded vertices in the
 * corpus.
 */
const CROWDING_SUBJECTS: readonly { readonly name: string; readonly molecule: Molecule }[] = [
  ...FIXTURES.filter((fixture) => fixture.name !== "unmergedDropOverlap"),
  { name: "perhydrophenanthrene", molecule: perhydrophenanthrene() },
  { name: "steroidSkeleton", molecule: steroidSkeleton() },
];

/** Every crowding subject at the sweep's nine rotations, 40 degrees apart. */
function* rotations(): Generator<{ readonly name: string; readonly molecule: Molecule }> {
  for (const subject of CROWDING_SUBJECTS) {
    for (let step = 0; step < 9; step++) {
      const molecule = rotateAtoms(
        subject.molecule,
        subject.molecule.atomIds,
        ORIGIN,
        (step * 40 * Math.PI) / 180,
      );
      const probe = molecule.atomIds[0];
      if (probe !== undefined) {
        // A rotation that produced NaN is the bug this sweep once had.
        expect(Number.isFinite(molecule.atoms[probe]!.pos.x), subject.name).toBe(true);
      }
      yield { name: subject.name, molecule };
    }
  }
}

/**
 * `hydrogen-over-atom` findings per "subject view", summed over the nine
 * rotations, in both views that draw hydrogens. Every key is present, zero
 * included, so a caller asserting a count cannot miss a subject.
 */
function crowdingReport(style: RenderStyle): Map<string, number> {
  const out = new Map<string, number>();
  for (const view of [EXPLICIT_H, LEWIS]) {
    for (const subject of CROWDING_SUBJECTS) out.set(`${subject.name} ${view.kind}`, 0);
    for (const { name, molecule } of rotations()) {
      const key = `${name} ${view.kind}`;
      const found = detectCollisions(buildScene(molecule, style, view), molecule, {
        maxFindings: 10_000,
      }).collisions.filter((c) => c.kind === "hydrogen-over-atom");
      out.set(key, out.get(key)! + found.length);
    }
  }
  return out;
}

/** Proper crossing of two open segments. */
function crosses(p1: ScenePoint, p2: ScenePoint, q1: ScenePoint, q2: ScenePoint): boolean {
  const rx = p2.x - p1.x;
  const ry = p2.y - p1.y;
  const sx = q2.x - q1.x;
  const sy = q2.y - q1.y;
  const d = rx * sy - ry * sx;
  if (d === 0) return false;
  const t = ((q1.x - p1.x) * sy - (q1.y - p1.y) * sx) / d;
  const u = ((q1.x - p1.x) * ry - (q1.y - p1.y) * rx) / d;
  return t > 0 && t < 1 && u > 0 && u < 1;
}

/** The derived hydrogens, placed against the same label map `buildScene` uses
 *  — which is the only way to get the positions the scene actually drew. */
function hydrogensOf(
  mol: Molecule,
  style: RenderStyle,
  view: StructuralRepresentation,
) {
  return derivedHydrogens(mol, style, view, atomLabelPlacements(mol, style, view));
}

function dotsOf(scene: RenderScene, atomId: string): CirclePrimitive[] {
  return scene.primitives.filter(
    (p): p is CirclePrimitive =>
      p.type === "circle" && p.id.startsWith(`atom:${atomId}:lonepair:`),
  );
}

function unit(from: ScenePoint, to: ScenePoint): ScenePoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  return { x: dx / length, y: dy / length };
}

describe("the fully-explicit view", () => {
  it("draws benzene's six hydrogens, one per vertex, pointing out of the ring", () => {
    const mol = benzene();
    const scene = buildScene(mol, PUBLICATION_STYLE, EXPLICIT_H);
    expect(hydrogenPrimitives(scene, "textRun")).toHaveLength(6);
    expect(hydrogenPrimitives(scene, "line")).toHaveLength(6);

    // Benzene is centred on the origin, so "out of the ring" is a sign check:
    // each hydrogen must be further from the centre than its host is. A fan
    // that put one INSIDE would be the failure the whole gap search exists to
    // avoid, and it is invisible in a primitive count.
    for (const hydrogen of hydrogensOf(mol, PUBLICATION_STYLE, EXPLICIT_H)) {
      const host = modelToPx(
        PUBLICATION_STYLE,
        mol.atoms[hydrogen.hostAtomId]!.pos,
      );
      const hostRadius = Math.sqrt(host.x * host.x + host.y * host.y);
      const hydrogenRadius = Math.sqrt(
        hydrogen.centre.x * hydrogen.centre.x +
          hydrogen.centre.y * hydrogen.centre.y,
      );
      expect(hydrogenRadius).toBeGreaterThan(hostRadius);
    }
  });

  it("gives methane four hydrogens no two of which are on top of each other", () => {
    const mol = singleAtom("C");
    const hydrogens = hydrogensOf(mol, PUBLICATION_STYLE, EXPLICIT_H);
    expect(hydrogens).toHaveLength(4);
    for (let i = 0; i < hydrogens.length; i++) {
      for (let j = i + 1; j < hydrogens.length; j++) {
        const a = hydrogens[i]!.centre;
        const b = hydrogens[j]!.centre;
        const gap = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
        expect(gap).toBeGreaterThan(PUBLICATION_STYLE.fontSizePx);
      }
    }
  });

  it("stops printing hydrogens on the labels it has promoted to vertices", () => {
    // Otherwise a fully explicit methane reads "CH4" with four hydrogens
    // hanging off it as well — the same hydrogens, drawn twice.
    const scene = buildScene(ethanol(), PUBLICATION_STYLE, EXPLICIT_H);
    const labels = scene.primitives.filter(
      (p) => p.type === "textRun" && p.source.kind === "atom",
    );
    for (const label of labels) {
      if (label.type !== "textRun") throw new Error("expected a text run");
      expect(label.spans.map((s) => s.text).join("")).not.toMatch(/^[CO]H/);
    }
  });

  it("pins the hydrogen crowding Screen reports: the steroid's methyls only", () => {
    // THE CROWDING ACCEPTANCE, run over every fixture and the two fused sp3
    // ring systems at nine rotations and both views that draw hydrogens.
    // Rotations matter because the fan is computed from angular gaps, and a
    // structure sitting square with the page is the one arrangement most
    // likely to work by accident.
    //
    // THE PIVOT IS PASSED. This sweep used to call `rotateAtoms(mol, ids,
    // angle)`, which reads the angle as the pivot and leaves the angle
    // undefined: every coordinate came out NaN, no collision could fire, and
    // the sweep passed from the day it was written. `rotations` above asserts
    // every rotated position is finite, so it cannot go vacuous that way
    // again.
    //
    // Screen's 44 px bond has room for every fixture and for
    // perhydrophenanthrene. What is left is the steroid's C19 methyl, which
    // stands one bond from C1, C9 and C11 at once. Before decision 134 let the
    // renderer spread a fan and keep a hydrogen on its own side of every
    // bond, the steroid reported 46 and 47 here and perhydrophenanthrene 4
    // and 4.
    const pinned: Record<string, number> = {
      "steroidSkeleton explicitH": 7,
      "steroidSkeleton lewis": 7,
    };
    for (const [key, count] of crowdingReport(SCREEN_STYLE)) {
      expect(count, key).toBe(pinned[key] ?? 0);
    }
  });

  it("pins the hydrogen crowding Publication reports", () => {
    // At the ACS 1996 setting (decision 26) the "H" glyphs are 10 pt on a
    // 14.4 pt bond, and a hydrogen on one carbon and a hydrogen on the next
    // are fanned into the same pocket. It is PINNED: a change that makes any
    // subject more crowded fails here, and one that makes it less crowded has
    // to come and lower the number.
    //
    // THIS COUNTS CLEAR SPACE, NOT INK. `detectCollisions` compares the
    // PADDED boxes, so two glyphs with a hairline of white between them are a
    // finding here; `hydrogen-separation.test.ts` is where ink is asserted.
    //
    // EVERY FIXTURE IS AT ZERO. Summed over the nine rotations, the fixtures
    // reported 72 when this sweep first ran, 78 with the minimum visible stem
    // (`explicitHydrogenMinStemRatio`), and 58 once the separation pass kept
    // glyphs off each other's ink. They reach zero because the separation
    // search now scores a place by what this pass reports — padded boxes,
    // bond lines — and not by ink alone, keeps every hydrogen on its own side
    // of every bond, and places the still-crowded ones again against the
    // whole page (decision 134).
    //
    // WHAT REMAINS IS THE STEROID'S TWO ANGULAR METHYLS. C19 stands one bond
    // from C1, C9 and C11 at once, and C18 one bond from C12 and 1.2 from
    // C17, so a methyl and its neighbours share a pocket narrower than their
    // 10 pt glyphs.
    // Before decision 134 the steroid reported 126 and 136 here and
    // perhydrophenanthrene 51 and 51. Perhydrophenanthrene's last finding is
    // one CH2 at one rotation (280 degrees), squeezed from both sides until
    // its own two hydrogens' clear spaces meet.
    const pinned: Record<string, number> = {
      "perhydrophenanthrene explicitH": 1,
      "perhydrophenanthrene lewis": 1,
      "steroidSkeleton explicitH": 53,
      "steroidSkeleton lewis": 58,
    };
    for (const [key, count] of crowdingReport(PUBLICATION_STYLE)) {
      expect(count, key).toBe(pinned[key] ?? 0);
    }
  });

  it("never puts a derived hydrogen on the far side of a bond from its host", () => {
    // Decision 134 lets the renderer turn a hydrogen, never carry it past a
    // bond. A hydrogen across a bond reads as attached to whatever is on the
    // other side — a methyl's hydrogen inside the ring beside it, which is
    // what the steroid's C19 drew before this was a rule. Centre to centre,
    // host to hydrogen against atom to atom, so a stem that slips through the
    // white between a label and its trimmed bond still counts.
    expect(molecularFormula(perhydrophenanthrene())).toBe("C14H24");
    for (const style of PRESETS) {
      for (const view of [EXPLICIT_H, LEWIS]) {
        for (const { name, molecule } of rotations()) {
          for (const hydrogen of hydrogensOf(molecule, style, view)) {
            const host = modelToPx(style, molecule.atoms[hydrogen.hostAtomId]!.pos);
            for (const bondId of molecule.bondIds) {
              const bond = molecule.bonds[bondId]!;
              if (bond.from === hydrogen.hostAtomId || bond.to === hydrogen.hostAtomId) continue;
              const a = modelToPx(style, molecule.atoms[bond.from]!.pos);
              const b = modelToPx(style, molecule.atoms[bond.to]!.pos);
              expect(
                crosses(host, hydrogen.centre, a, b),
                `${name} ${view.kind} ${style.name} ${hydrogen.hostAtomId}:${hydrogen.index} x ${bondId}`,
              ).toBe(false);
            }
          }
        }
      }
    }
  });

  it("keeps a hydrogen beside a stereo bond inside the gap it was fanned into", () => {
    // At a centre with a wedge or a hash the cyclic order of the substituents
    // IS the configuration a reader reads, so a derived hydrogen there may
    // turn only within its own gap — never past one of the host's bonds, and
    // never into another gap. butan-2-ol, the non-stereocentre with a wedge
    // and the steroid's four wedged centres are the cases.
    let seen = 0;
    for (const style of PRESETS) {
      for (const view of [EXPLICIT_H, LEWIS]) {
        for (const { name, molecule } of rotations()) {
          for (const hydrogen of hydrogensOf(molecule, style, view)) {
            const hostId = hydrogen.hostAtomId;
            if (bondsAt(molecule, hostId).every((bond) => bond.stereo === "none")) continue;
            seen++;
            const sector = hydrogenFan(molecule, hostId, implicitHydrogenCount(molecule, hostId))[
              hydrogen.index
            ]!;
            // Back to model space, y-up, to compare with chem-core's angles.
            const host = modelToPx(style, molecule.atoms[hostId]!.pos);
            const angle = Math.atan2(-(hydrogen.centre.y - host.y), hydrogen.centre.x - host.x);
            const offset = normalizeAnglePositive(angle - sector.start);
            expect(offset, `${name} ${view.kind} ${style.name} ${hostId}`).toBeGreaterThan(0);
            expect(offset, `${name} ${view.kind} ${style.name} ${hostId}`).toBeLessThan(sector.width);
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("draws the same crowded figure twice, byte for byte", () => {
    // The repair passes are order-dependent by design; what they may not be
    // is run-dependent. Exported figures are committed and diffed.
    for (const view of [EXPLICIT_H, LEWIS]) {
      const mol = steroidSkeleton();
      expect(serializeScene(buildScene(mol, PUBLICATION_STYLE, view))).toBe(
        serializeScene(buildScene(steroidSkeleton(), PUBLICATION_STYLE, view)),
      );
    }
  });

  it("gives every derived hydrogen at least the style's minimum visible stem", () => {
    // Before the floor, every Publication hydrogen drew a 2 px stub — 0.42 mm
    // at the printed bond — because the two label trims came to more than
    // the 0.66 stand-off. The floor is a fraction of a bond, so this checks
    // it in those units at both presets.
    for (const view of [EXPLICIT_H, LEWIS]) {
      for (const fixture of FIXTURES) {
        for (const style of PRESETS) {
          const floor =
            style.explicitHydrogenMinStemRatio * pxPerModelUnit(style);
          const scene = buildScene(fixture.molecule, style, view);
          for (const stem of hydrogenPrimitives(scene, "line")) {
            if (stem.type !== "line") throw new Error("expected a line");
            const length = Math.sqrt(
              (stem.b.x - stem.a.x) ** 2 + (stem.b.y - stem.a.y) ** 2,
            );
            expect(
              length,
              `${fixture.name} ${view.kind} ${style.name} ${stem.id}`,
            ).toBeGreaterThanOrEqual(floor - 1e-9);
          }
        }
      }
    }
    // The case that motivated it, stated plainly: ethanol's O–H at the
    // printed bond is a millimetre, not a smudge.
    const scene = buildScene(ethanol(), PUBLICATION_STYLE, EXPLICIT_H);
    const oh = scene.primitives.find((p) => p.id === "atom:a3:h:0:line");
    if (oh?.type !== "line") throw new Error("expected ethanol's O–H stem");
    const printedMm =
      (Math.sqrt((oh.b.x - oh.a.x) ** 2 + (oh.b.y - oh.a.y) ** 2) *
        PRINTED_BOND_LENGTH_CM *
        10) /
      pxPerModelUnit(PUBLICATION_STYLE);
    expect(printedMm).toBeGreaterThan(1);
  });

  it("gives every derived hydrogen a stem, however wide its host's label", () => {
    // A hydrogen stands at a FIXED fraction of a bond length from its host,
    // and 0.66 of one is not always past the host's own glyphs: methanol-13C
    // sets its mass number as a superscript to the west, swallowed the whole
    // stem of the hydrogen fanned that way, and drew a floating "H" with no
    // bond to it. The stand-off now clears the host's obstacles, so a bondless
    // hydrogen is not a thing this view can produce.
    for (const view of [EXPLICIT_H, LEWIS]) {
      for (const fixture of FIXTURES) {
        for (const style of PRESETS) {
          const scene = buildScene(fixture.molecule, style, view);
          const stems = new Set(
            hydrogenPrimitives(scene, "line").map((p) => p.id),
          );
          for (const glyph of hydrogenPrimitives(scene, "textRun")) {
            expect(
              stems.has(glyph.id.replace(/:label$/, ":line")),
              `${fixture.name} ${view.kind} ${style.name} ${glyph.id}`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it("does not regress the trimming: no label lies across its own bond", () => {
    // The existing invariant, re-run for the two views that now draw more.
    // A phantom stem trimmed at only one end would show up here.
    for (const view of [EXPLICIT_H, LEWIS]) {
      for (const fixture of [naphthalene(), chrysene(), acetate()]) {
        for (const style of PRESETS) {
          const scene = buildScene(fixture, style, view);
          const own = detectCollisions(scene, fixture).collisions.filter(
            (c) => c.kind === "label-over-own-bond",
          );
          expect(own).toEqual([]);
        }
      }
    }
  });

  it("reports the crowding it finds rather than moving anything", () => {
    // The detector has to be able to FIRE, or the sweep above is green for
    // the wrong reason. `unmergedDropOverlap` is the fixture built for it:
    // two fragments dropped on one another and never merged, whose hydrogens
    // interleave with the other fragment's atoms.
    const collided: Molecule = FIXTURES.find(
      (f) => f.name === "unmergedDropOverlap",
    )!.molecule;
    const scene = buildScene(collided, PUBLICATION_STYLE, EXPLICIT_H);
    const report = detectCollisions(scene, collided);
    expect(
      report.collisions.some((c) => c.kind === "hydrogen-over-atom"),
    ).toBe(true);
    // REPORTED, NEVER REPAIRED: the same scene built twice is the same scene,
    // and the molecule is untouched.
    expect(buildScene(collided, PUBLICATION_STYLE, EXPLICIT_H)).toEqual(scene);
    const before = FIXTURES.find((f) => f.name === "unmergedDropOverlap")!.molecule;
    expect(collided).toEqual(before);
  });
});

describe("the Lewis view", () => {
  it("puts two pairs on a carbonyl oxygen and three on a carboxylate one", () => {
    const mol = acetate();
    const scene = buildScene(mol, PUBLICATION_STYLE, LEWIS);
    // Two dots per pair, so the primitive counts are doubled.
    expect(dotsOf(scene, "a3")).toHaveLength(4);
    expect(dotsOf(scene, "a4")).toHaveLength(6);
    // And none at all on the carbons, which have spent every outer electron.
    expect(dotsOf(scene, "a1")).toHaveLength(0);
    expect(dotsOf(scene, "a2")).toHaveLength(0);
  });

  it("keeps every pair clear of the bonds AND of its own hydrogens", () => {
    // The rule stated where it can fail: for each drawn pair, the direction
    // from the atom to the pair's midpoint must not point along any bond.
    // cos 45 degrees is the threshold — the eight slots are 45 apart, so a
    // pair aligned closer than that to a bond took a slot the bond was in.
    //
    // THE DERIVED HYDROGENS COUNT AS BONDS HERE, and they are the half of this
    // that was wrong: they are not in `mol.bondIds`, the earlier version of
    // this test iterated only that, and so it passed while a lone pair sat on
    // ethanol's O–H and trimmed the whole stem away. Every fixture, not three,
    // because the failure needed an atom that has both a pair and a hydrogen.
    for (const fixture of FIXTURES) {
      const mol = fixture.molecule;
      const scene = buildScene(mol, PUBLICATION_STYLE, LEWIS);
      for (const atomId of mol.atomIds) {
        const centre = modelToPx(PUBLICATION_STYLE, mol.atoms[atomId]!.pos);
        const bonds = [
          ...mol.bondIds
            .map((id) => mol.bonds[id]!)
            .filter((bond) => bond.from === atomId || bond.to === atomId)
            .map((bond) => {
              const otherId = bond.from === atomId ? bond.to : bond.from;
              return unit(centre, modelToPx(PUBLICATION_STYLE, mol.atoms[otherId]!.pos));
            }),
          ...derivedHydrogenDirections(mol, atomId, PUBLICATION_STYLE, LEWIS),
        ];
        const dots = dotsOf(scene, atomId);
        for (let i = 0; i < dots.length; i += 2) {
          const midpoint: ScenePoint = {
            x: (dots[i]!.centre.x + dots[i + 1]!.centre.x) / 2,
            y: (dots[i]!.centre.y + dots[i + 1]!.centre.y) / 2,
          };
          const direction = unit(centre, midpoint);
          for (const bond of bonds) {
            expect(
              direction.x * bond.x + direction.y * bond.y,
              `${fixture.name} ${atomId} pair ${i / 2}`,
            ).toBeLessThan(Math.SQRT1_2);
          }
        }
      }
    }
  });

  it("sets each pair's two dots perpendicular to the direction it took", () => {
    const mol = acetate();
    const scene = buildScene(mol, PUBLICATION_STYLE, LEWIS);
    const centre = modelToPx(PUBLICATION_STYLE, mol.atoms["a3"]!.pos);
    const dots = dotsOf(scene, "a3");
    for (let i = 0; i < dots.length; i += 2) {
      const midpoint: ScenePoint = {
        x: (dots[i]!.centre.x + dots[i + 1]!.centre.x) / 2,
        y: (dots[i]!.centre.y + dots[i + 1]!.centre.y) / 2,
      };
      const outward = unit(centre, midpoint);
      const across = unit(dots[i]!.centre, dots[i + 1]!.centre);
      // Perpendicular to within float noise. A pair strung out ALONG its own
      // direction reads as two separate marks at different distances.
      expect(Math.abs(outward.x * across.x + outward.y * across.y)).toBeLessThan(1e-9);
    }
  });

  it("moves the charge out of the glyph run and into a free direction", () => {
    const mol = acetate();
    const lewis = buildScene(mol, PUBLICATION_STYLE, LEWIS);
    const skeletal = buildScene(mol, PUBLICATION_STYLE, representation("skeletal"));

    // In every other view the charge terminates the label's own run.
    const skeletalLabel = skeletal.primitives.find((p) => p.id === "atom:a4:label");
    if (skeletalLabel?.type !== "textRun") throw new Error("expected a label run");
    expect(skeletalLabel.spans.at(-1)?.script).toBe("super");

    // In Lewis it is a primitive of its own, and the label run is just "O".
    const lewisLabel = lewis.primitives.find((p) => p.id === "atom:a4:label");
    if (lewisLabel?.type !== "textRun") throw new Error("expected a label run");
    expect(lewisLabel.spans.map((s) => s.text).join("")).toBe("O");

    const charge = lewis.primitives.find((p) => p.id === "atom:a4:charge");
    if (charge?.type !== "textRun") throw new Error("expected a detached charge");
    expect(charge.spans).toEqual([{ text: "−", script: "super" }]);

    // And it is clear of every lone pair: the charge picks its slot after the
    // electrons have taken theirs.
    const centre = modelToPx(PUBLICATION_STYLE, mol.atoms["a4"]!.pos);
    const chargeDirection = unit(centre, charge.origin);
    for (const pairDot of dotsOf(lewis, "a4")) {
      const dotDirection = unit(centre, pairDot.centre);
      expect(
        chargeDirection.x * dotDirection.x + chargeDirection.y * dotDirection.y,
      ).toBeLessThan(0.99);
    }
  });

  it("never gives an atom a lone pair and a radical dot on the same slot", () => {
    // A methyl radical bearing a charge is the crowded case: one unpaired
    // electron, no pairs, and a charge, all competing for the eight slots.
    const mol = buildMolecule((b) => {
      b.atom("N", vec(0, 0), { radicalElectrons: 1, charge: -1 });
    });
    const scene = buildScene(mol, PUBLICATION_STYLE, LEWIS);
    const ids = scene.primitives.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Nitrogen: 5 outer, +1 for the charge, one unpaired electron and two
    // implicit hydrogens leaves two pairs.
    expect(dotsOf(scene, "a1")).toHaveLength(4);
    expect(ids.filter((id) => id.includes(":radical:"))).toHaveLength(1);
  });
});

describe("representationAvailability", () => {
  it("refuses condensed for a ring and allows it for a chain", () => {
    const cyclic = representationAvailability(benzene(), "condensed");
    expect(cyclic.available).toBe(false);
    if (cyclic.available) throw new Error("unreachable");
    expect(cyclic.reason).toBe("cyclic");
    expect(cyclic.message).toMatch(/no condensed formula/);
    expect(representationAvailability(ethanol(), "condensed").available).toBe(true);
    // And the ring is no obstacle to any other view.
    expect(representationAvailability(benzene(), "skeletal").available).toBe(true);
    expect(representationAvailability(benzene(), "sumFormula").available).toBe(true);
  });

  it("refuses lewis for an element with no default valences", () => {
    const ferrocene = buildMolecule((b) => {
      b.bond(b.atom("Fe", vec(0, 0)), b.atom("C", vec(1, 0)));
    });
    const lewis = representationAvailability(ferrocene, "lewis");
    expect(lewis.available).toBe(false);
    if (lewis.available) throw new Error("unreachable");
    expect(lewis.reason).toBe("no-lone-pair-data");
    expect(lewis.message).toMatch(/^Fe has/);
    expect(lewis.atomIds).toEqual(["a1"]);
    // The skeletal drawing of an organometallic is perfectly fine; only the
    // electron bookkeeping is undefined.
    expect(representationAvailability(ferrocene, "skeletal").available).toBe(true);
  });

  it("says over-valent when the atom is over-valent, not that it has no valences", () => {
    // The two arms of chem-core's `LonePairReason` are different sentences and
    // only one of them is true of a carbon. Collapsing them printed "C has no
    // default valences" — a factual falsehood — into the cell of a figure.
    const hypervalentCarbon = buildMolecule((b) => {
      const carbon = b.atom("C", vec(0, 0));
      for (let i = 0; i < 5; i++) {
        b.bond(carbon, b.atom("F", vec(Math.cos(i), Math.sin(i))));
      }
    });
    const lewis = representationAvailability(hypervalentCarbon, "lewis");
    expect(lewis.available).toBe(false);
    if (lewis.available) throw new Error("unreachable");
    expect(lewis.reason).toBe("over-valent");
    expect(lewis.message).toMatch(/^C has more bonds than/);
    expect(lewis.message).not.toMatch(/no default valences/);
    expect(lewis.atomIds).toEqual(["a1"]);
  });

  it("refuses both text views for a structure drawn with an abbreviation", () => {
    // Benzyl alcohol drawn as Ph–CH2–OH. The graph under the "Ph" is a bare
    // carbon, so the condensed formula reads "CH3CH2OH" and the sum formula
    // "C2H6O" — both of them ethanol, confidently and wrongly. A cell that
    // states the wrong molecule is worse than the empty one this function
    // exists to prevent.
    const mol = FIXTURES.find((f) => f.name === "benzylAlcoholAbbreviated")!.molecule;
    for (const kind of ["condensed", "sumFormula"] as const) {
      const verdict = representationAvailability(mol, kind);
      expect(verdict.available, kind).toBe(false);
      if (verdict.available) throw new Error("unreachable");
      expect(verdict.reason).toBe("abbreviated-label");
      // The WHOLE sentence, because the half that was wrong was the tail: the
      // message is printed verbatim into the cell the view would have filled,
      // and one "Ph" takes "what it stands for". Matching only the prefix let
      // "Ph … what they stand for" through.
      expect(verdict.message).toBe(
        "Ph is drawn as an abbreviation, so a formula cannot state what it stands for.",
      );
      expect(verdict.atomIds).toEqual(["a1"]);
    }
    // The structural views draw the abbreviation, which is what the author
    // asked for, and are unaffected.
    for (const kind of ["skeletal", "kekule", "explicitH", "lewis"] as const) {
      expect(representationAvailability(mol, kind).available, kind).toBe(true);
    }

    // The plural branch of the same sentence. Two abbreviations take "they",
    // and the singular and plural forms are two different strings rather than
    // one string with an "(s)" in it.
    const twoLabels = buildMolecule((b) => {
      const left = b.atom("C", vec(0, 0), { label: "Ph" });
      b.bond(left, b.atom("N", vec(1, 0), { label: "Boc" }));
    });
    const verdict = representationAvailability(twoLabels, "sumFormula");
    expect(verdict.available).toBe(false);
    if (verdict.available) throw new Error("unreachable");
    expect(verdict.message).toBe(
      "Ph, Boc are drawn as abbreviations, so a formula cannot state what they stand for.",
    );
  });

  it("refuses every view for an element the table has never heard of", () => {
    // A live crash path, not a hypothetical: `atomSchema` deliberately does
    // NOT validate the symbol — a saved document has to survive a placeholder
    // like "R" — and `implicitHydrogenCount` throws out of `requireElement`
    // on one. This function is what a caller can ask FIRST, without throwing.
    const placeholder = buildMolecule((b) => {
      b.bond(b.atom("C", vec(0, 0)), b.atom("R", vec(1, 0)));
    });
    for (const [kind, verdict] of availabilityByKind(placeholder)) {
      expect(verdict.available, kind).toBe(false);
      if (verdict.available) throw new Error("unreachable");
      expect(verdict.reason).toBe("unknown-element");
      expect(verdict.atomIds).toEqual(["a2"]);
    }
    expect(() =>
      buildScene(placeholder, PUBLICATION_STYLE, representation("skeletal")),
    ).toThrow();
  });

  it("draws a Markush core in every structural view but Lewis, and in the sum formula (decision 238)", () => {
    const markush = buildMolecule((b) => {
      const c = b.atom("C", vec(0, 0));
      b.bond(c, b.atom("*", vec(1, 0), { query: { kind: "rgroup", index: 1 } }));
      // Far enough out that the bond clears the list's wide label.
      b.bond(c, b.atom("*", vec(-3, 0), { query: { kind: "list", elements: ["Cl", "Br"], negated: false } }));
    });
    const verdicts = new Map(availabilityByKind(markush));
    expect(verdicts.get("skeletal")?.available).toBe(true);
    expect(verdicts.get("sumFormula")?.available).toBe(true);
    const lewis = verdicts.get("lewis");
    expect(lewis?.available).toBe(false);
    if (lewis === undefined || lewis.available) throw new Error("unreachable");
    // Named by what the canvas draws, never by the placeholder element "*".
    expect(lewis.message).toMatch(/^R1, \[Cl,Br\] have no default valences/);
    expect(verdicts.get("condensed")?.available).toBe(false);

    const scene = buildScene(markush, PUBLICATION_STYLE, representation("skeletal"));
    const texts = scene.primitives.flatMap((p) =>
      p.type === "group"
        ? p.children.flatMap((c) => (c.type === "textRun" ? c.spans.map((s) => s.text) : []))
        : p.type === "textRun"
          ? p.spans.map((s) => s.text)
          : [],
    );
    expect(texts).toEqual(expect.arrayContaining(["R1", "[Cl,Br]"]));

    // Query bonds: "any" dashed, the two-way queries labelled at the midpoint.
    const queried = setBondQuery(setBondQuery(markush, "b3", "any"), "b5", "single-or-double");
    const bondScene = buildScene(queried, PUBLICATION_STYLE, representation("skeletal"));
    const flat = bondScene.primitives.flatMap((p) => (p.type === "group" ? [p, ...p.children] : [p]));
    const any = flat.find((p) => p.id === "bond:b3:line");
    expect(any?.type === "line" ? any.stroke.dash?.length : 0).toBe(2);
    const label = flat.find((p) => p.id === "bond:b5:query");
    expect(label?.type === "textRun" ? label.spans[0]?.text : undefined).toBe("S/D");
  });

  it("refuses every view for an empty molecule, with the general reason", () => {
    const empty = buildMolecule(() => {});
    for (const [kind, verdict] of availabilityByKind(empty)) {
      expect(verdict.available, kind).toBe(false);
      if (verdict.available) throw new Error("unreachable");
      expect(verdict.reason).toBe("empty-molecule");
    }
  });

  it("allows every view for every fixture but the rings and the abbreviation", () => {
    for (const fixture of FIXTURES) {
      for (const [kind, verdict] of availabilityByKind(fixture.molecule)) {
        if (kind === "condensed" && !verdict.available) {
          expect(["cyclic", "abbreviated-label"], fixture.name).toContain(
            verdict.reason,
          );
          continue;
        }
        if (kind === "sumFormula" && !verdict.available) {
          expect(verdict.reason, fixture.name).toBe("abbreviated-label");
          continue;
        }
        expect(verdict.available, `${fixture.name} ${kind}`).toBe(true);
      }
    }
  });

  it("is total across both presets, so a panel can ask before it draws", () => {
    // Nothing here reads the style, and it must stay that way: availability is
    // a chemistry question, and a view that were available at one bond length
    // and not another would make a figure's contents depend on its size.
    for (const style of Object.values(RENDER_STYLES)) {
      expect(style.explicitHydrogenLengthRatio).toBeGreaterThan(0);
      expect(style.explicitHydrogenLengthRatio).toBeLessThan(1);
    }
  });
});

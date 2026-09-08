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
  buildMolecule,
  rotateAtoms,
  singleAtom,
  vec,
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
} from "../src/fixtures.js";
import { phantomHydrogens } from "../src/modes/explicitH.js";
import { representation } from "../src/representation.js";
import { buildScene } from "../src/scene/build.js";
import { detectCollisions } from "../src/scene/collide.js";
import type { CirclePrimitive, RenderScene, ScenePoint } from "../src/scene/types.js";
import { modelToPx, PUBLICATION_STYLE, RENDER_STYLES, SCREEN_STYLE } from "../src/style.js";

const EXPLICIT_H = representation("explicitH");
const LEWIS = representation("lewis");
const PRESETS = [PUBLICATION_STYLE, SCREEN_STYLE] as const;

function hydrogenPrimitives(scene: RenderScene, type: "line" | "textRun") {
  return scene.primitives.filter(
    (p) => p.type === type && p.source.kind === "hydrogen",
  );
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
    for (const hydrogen of phantomHydrogens(mol, PUBLICATION_STYLE, EXPLICIT_H)) {
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
    const hydrogens = phantomHydrogens(mol, PUBLICATION_STYLE, EXPLICIT_H);
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

  it("never stacks a hydrogen on an atom, a bond or another hydrogen", () => {
    // THE CROWDING ACCEPTANCE, run over the whole fixture set — naphthalene
    // and chrysene included, which are the fused systems whose inner vertices
    // have the least room — at nine rotations, both presets and both views
    // that draw hydrogens, at nine rotations each. Rotations matter because
    // the fan is computed from angular gaps, and a structure sitting square
    // with the page is the one arrangement most likely to work by accident.
    //
    // `unmergedDropOverlap` is excluded and asserted separately below: it is
    // the fixture that deliberately holds two fragments dropped on top of
    // each other, so its heavy atoms already collide and its hydrogens have
    // to.
    for (const view of [EXPLICIT_H, LEWIS]) {
      for (const fixture of FIXTURES) {
        if (fixture.name === "unmergedDropOverlap") continue;
        for (const style of PRESETS) {
          for (let step = 0; step < 9; step++) {
            const mol = rotateAtoms(
              fixture.molecule,
              fixture.molecule.atomIds,
              (step * 40 * Math.PI) / 180,
            );
            const scene = buildScene(mol, style, view);
            const found = detectCollisions(scene, mol).collisions.filter(
              (c) => c.kind === "hydrogen-over-atom",
            );
            expect(
              found,
              `${fixture.name} ${view.kind} ${style.name} rotated ${step * 40}deg`,
            ).toEqual([]);
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

  it("keeps every pair clear of the directions the bonds occupy", () => {
    // The rule stated where it can fail: for each drawn pair, the direction
    // from the atom to the pair's midpoint must not point along any bond.
    // cos 45 degrees is the threshold — the eight slots are 45 apart, so a
    // pair aligned closer than that to a bond took a slot the bond was in.
    for (const mol of [acetate(), dimethylSulfone(), ethanol()]) {
      const scene = buildScene(mol, PUBLICATION_STYLE, LEWIS);
      for (const atomId of mol.atomIds) {
        const centre = modelToPx(PUBLICATION_STYLE, mol.atoms[atomId]!.pos);
        const bonds = mol.bondIds
          .map((id) => mol.bonds[id]!)
          .filter((bond) => bond.from === atomId || bond.to === atomId)
          .map((bond) => {
            const otherId = bond.from === atomId ? bond.to : bond.from;
            return unit(centre, modelToPx(PUBLICATION_STYLE, mol.atoms[otherId]!.pos));
          });
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
              `${atomId} pair ${i / 2}`,
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

  it("refuses every view for an empty molecule, with the general reason", () => {
    const empty = buildMolecule(() => {});
    for (const [kind, verdict] of availabilityByKind(empty)) {
      expect(verdict.available, kind).toBe(false);
      if (verdict.available) throw new Error("unreachable");
      expect(verdict.reason).toBe("empty-molecule");
    }
  });

  it("allows every view for every fixture that is not a ring", () => {
    for (const fixture of FIXTURES) {
      for (const [kind, verdict] of availabilityByKind(fixture.molecule)) {
        if (kind === "condensed" && !verdict.available) {
          expect(verdict.reason, fixture.name).toBe("cyclic");
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

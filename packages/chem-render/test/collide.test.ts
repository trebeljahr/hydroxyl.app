/**
 * The collision pass. It REPORTS and it never repairs.
 *
 * The "mutates nothing" claim is the one that has to be PROVEN rather than
 * reviewed, so the fixture is deep-frozen and its coordinates are snapshotted
 * before the call and compared after. A comment saying "pure" is worth nothing
 * the day somebody adds a nudge.
 */

import {
  benzene,
  buildMolecule,
  DEG,
  fromPolar,
  getAtom,
  ORIGIN,
} from "@starter/chem-core";
import type { Molecule, Vec2 } from "@starter/chem-core";
import { describe, expect, it } from "vitest";

import { ethanol, FIXTURES, unmergedDropOverlap } from "../src/fixtures.js";
import { representation } from "../src/representation.js";
import { buildScene } from "../src/scene/build.js";
import { detectCollisions } from "../src/scene/collide.js";
import type { CollisionKind } from "../src/scene/collide.js";
import { PUBLICATION_STYLE } from "../src/style.js";

const SKELETAL = representation("skeletal");

function step(from: Vec2, degrees: number): Vec2 {
  const d = fromPolar(degrees * DEG, 1);
  return { x: from.x + d.x, y: from.y + d.y };
}

function kindsFor(mol: Molecule): CollisionKind[] {
  const scene = buildScene(mol, PUBLICATION_STYLE, SKELETAL);
  return detectCollisions(scene, mol).collisions.map((c) => c.kind);
}

describe("detectCollisions", () => {
  it("reports nothing on a well-drawn structure", () => {
    for (const mol of [benzene(), ethanol()]) {
      expect(kindsFor(mol)).toEqual([]);
    }
  });

  it("never reports a label lying on its OWN bond, on any fixture", () => {
    // The trimming regression guard, run across the whole fixture set rather
    // than one molecule: every label-bearing fixture in the sheet — a charged
    // carbon, a 13-C satellite, a "Ph", a hypervalent sulfur — is a direction
    // the ray-exit has to get right, and a single one going wrong here means
    // a line is being ruled through a glyph somewhere in the contact sheet.
    for (const fixture of FIXTURES) {
      // The deliberately broken one. A bond of the DROPPED fragment leaves
      // through a label belonging to the host, and the two are incident to
      // nothing in common — that is `label-over-bond`, reported below.
      if (fixture.name === "unmergedDropOverlap") continue;
      expect(kindsFor(fixture.molecule), fixture.name).toEqual([]);
    }
  });

  it("never reports a label lying on its OWN bond", () => {
    // The trimming regression signal. It is a DISTINCT finding rather than an
    // exemption precisely so it can be asserted absent: exempting incident
    // bonds would hide the only evidence that trimming stopped working.
    expect(kindsFor(ethanol())).not.toContain("label-over-own-bond");
  });

  it("reports the known-overlapping fixture", () => {
    const mol = unmergedDropOverlap();
    const kinds = kindsFor(mol);
    // Two atoms on the same spot, and the dropped fragment's bond leaving
    // straight through a label that belongs to neither of its ends.
    expect(kinds).toContain("coincident-atoms");
    expect(kinds).toContain("label-over-bond");
  });

  it("mutates no coordinate", () => {
    const mol = unmergedDropOverlap();
    const before = mol.atomIds.map((id) => ({ ...getAtom(mol, id)!.pos }));
    const scene = buildScene(mol, PUBLICATION_STYLE, SKELETAL);
    const primitivesBefore = JSON.stringify(scene.primitives);

    // Frozen for the duration, so a write is a TypeError in strict mode rather
    // than a silent success. (chem-core molecules are immutable by contract,
    // and the editor store deliberately runs with auto-freeze OFF, so this is
    // a test-only construction.)
    Object.freeze(mol);
    Object.freeze(mol.atoms);
    Object.freeze(mol.bonds);
    for (const id of mol.atomIds) Object.freeze(getAtom(mol, id)!.pos);
    Object.freeze(scene);
    Object.freeze(scene.primitives);

    const report = detectCollisions(scene, mol);
    expect(report.collisions.length).toBeGreaterThan(0);

    expect(mol.atomIds.map((id) => ({ ...getAtom(mol, id)!.pos }))).toEqual(before);
    expect(JSON.stringify(scene.primitives)).toBe(primitivesBefore);
  });

  it("reports the same molecule identically twice", () => {
    // The determinism criterion applies to the report as much as to the SVG.
    // Iteration is a walk of `mol.atomIds` and `mol.bondIds`, never a sort by
    // overlap depth, where float ties reorder between runs.
    const first = detectCollisions(
      buildScene(unmergedDropOverlap(), PUBLICATION_STYLE, SKELETAL),
      unmergedDropOverlap(),
    );
    const second = detectCollisions(
      buildScene(unmergedDropOverlap(), PUBLICATION_STYLE, SKELETAL),
      unmergedDropOverlap(),
    );
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("reports two unrelated bonds crossing", () => {
    // A fragment pasted on top of another. Adjacent bonds share a vertex and
    // meet there by construction, so only a genuine crossing is news.
    const mol = buildMolecule((b) => {
      const c1 = b.atom("C", { x: -1, y: 0 });
      const c2 = b.atom("C", { x: 1, y: 0 });
      b.bond(c1, c2, 1);
      const c3 = b.atom("C", { x: 0, y: -1 });
      const c4 = b.atom("C", { x: 0, y: 1 });
      b.bond(c3, c4, 1);
    });
    expect(kindsFor(mol)).toContain("bond-crosses-bond");
    // Benzene's six bonds are all adjacent in pairs and none of them cross.
    expect(kindsFor(benzene())).not.toContain("bond-crosses-bond");
  });

  it("reports two labels sitting on each other", () => {
    // Two hydroxyls a fifth of a bond apart: far enough not to count as
    // coincident, close enough that "OH" is drawn over "HO".
    const mol = buildMolecule((b) => {
      const c1 = b.atom("C", ORIGIN);
      b.bond(c1, b.atom("O", step(ORIGIN, 30)), 1);
      const c2 = b.atom("C", { x: 0.2, y: 0.2 });
      b.bond(c2, b.atom("O", step({ x: 0.2, y: 0.2 }, 30)), 1);
    });
    expect(kindsFor(mol)).toContain("label-over-label");
  });

  it("reports a bond the two labels swallowed", () => {
    const mol = buildMolecule((b) => {
      const o1 = b.atom("O", ORIGIN);
      b.bond(o1, b.atom("O", { x: 0.02, y: 0 }), 1);
    });
    expect(kindsFor(mol)).toContain("bond-swallowed-by-labels");
  });

  it("reports an aromatic ring too distorted to draw a circle in", () => {
    // Ring perception is topological and position-blind, so it will ask for a
    // circle in a ring that has no inside left. Silently drawing nothing is
    // what this finding exists to stop.
    const flat = buildMolecule((b) => {
      const ids = benzene().atomIds;
      void ids;
      const positions: Vec2[] = [];
      for (let i = 0; i < 6; i++) {
        const angle = (-90 + i * 60) * DEG;
        const p = fromPolar(angle, 1);
        positions.push({ x: p.x, y: p.y * 0.02 });
      }
      const atoms = positions.map((p) => b.atom("C", p));
      for (let i = 0; i < 6; i++) {
        b.bond(atoms[i]!, atoms[(i + 1) % 6]!, i % 2 === 1 ? 2 : 1);
      }
    });
    const circles = representation("skeletal", { aromaticCircles: true });
    const scene = buildScene(flat, PUBLICATION_STYLE, circles);
    const kinds = detectCollisions(scene, flat).collisions.map((c) => c.kind);
    expect(kinds).toContain("degenerate-aromatic-ring");

    // And not reported at all when circles were never asked for.
    const plain = buildScene(flat, PUBLICATION_STYLE, SKELETAL);
    expect(
      detectCollisions(plain, flat).collisions.map((c) => c.kind),
    ).not.toContain("degenerate-aromatic-ring");
  });

  it("truncates rather than returning a report nobody can read", () => {
    const mol = unmergedDropOverlap();
    const scene = buildScene(mol, PUBLICATION_STYLE, SKELETAL);
    const report = detectCollisions(scene, mol, { maxFindings: 1 });
    expect(report.collisions).toHaveLength(1);
    expect(report.truncated).toBe(true);
  });

  it("says nothing about a text view, which has no geometry to collide", () => {
    const mol = unmergedDropOverlap();
    const scene = buildScene(mol, PUBLICATION_STYLE, representation("sumFormula"));
    expect(detectCollisions(scene, mol).collisions).toEqual([]);
  });
});

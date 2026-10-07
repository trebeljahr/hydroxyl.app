/**
 * Contracted abbreviations draw as their label in every structural view
 * (decision 225), and their atoms draw nothing of their own.
 */

import { describe, expect, it } from "vitest";

import { attachGroupToAtom, benzene, collapseAbbreviation } from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";

import { representation } from "../src/representation.js";
import type { StructuralViewKind } from "../src/representation.js";
import { buildScene } from "../src/scene/build.js";
import type { ScenePrimitive } from "../src/scene/types.js";
import { PUBLICATION_STYLE } from "../src/style.js";

/** tert-Butyl phenylcarbamate with the Boc contracted. */
function contractedBoc(): { mol: Molecule; boc: readonly AtomId[] } {
  const ring = benzene();
  const amine = attachGroupToAtom(ring, ring.atomIds[0]!, "NH2");
  const boc = attachGroupToAtom(amine.molecule, amine.atomIds[0]!, "Boc");
  return { mol: collapseAbbreviation(boc.molecule, boc.atomIds, "Boc"), boc: boc.atomIds };
}

function texts(primitives: readonly ScenePrimitive[]): string[] {
  return primitives.flatMap((p) => (p.type === "textRun" ? [p.spans.map((s) => s.text).join("")] : []));
}

function touchedAtoms(primitives: readonly ScenePrimitive[]): Set<AtomId> {
  const out = new Set<AtomId>();
  for (const p of primitives) {
    if (p.source.kind === "atom") out.add(p.source.atomId);
    if (p.source.kind === "bond") {
      // Bond ids are opaque; the test below checks bonds by id instead.
    }
  }
  return out;
}

describe("a contracted Boc in each structural view", () => {
  const kinds: readonly StructuralViewKind[] = ["skeletal", "kekule", "explicitH", "lewis"];
  for (const kind of kinds) {
    it(`${kind}: one "Boc" label, nothing drawn for the hidden atoms`, () => {
      const { mol, boc } = contractedBoc();
      const scene = buildScene(mol, PUBLICATION_STYLE, representation(kind));
      expect(texts(scene.primitives).filter((t) => t === "Boc")).toHaveLength(1);
      const drawn = touchedAtoms(scene.primitives);
      for (const hidden of boc.slice(1)) expect(drawn.has(hidden)).toBe(false);
      const internalBonds = mol.bondIds.filter((id) => {
        const bond = mol.bonds[id]!;
        return boc.includes(bond.from) && boc.includes(bond.to);
      });
      const bondSources = new Set(
        scene.primitives.flatMap((p) => (p.source.kind === "bond" ? [p.source.bondId] : [])),
      );
      for (const id of internalBonds) expect(bondSources.has(id)).toBe(false);
      // The hydrogen views draw the ring's five and the carbamate N-H, and
      // nothing fanned off the label: the tert-butyl's nine are in "Boc".
      const fanned = kind === "explicitH" || kind === "lewis";
      expect(texts(scene.primitives).filter((t) => t === "H")).toHaveLength(fanned ? 6 : 0);
    });
  }

  it("the sum formula is the chemistry's and never reads the label", () => {
    const { mol } = contractedBoc();
    const scene = buildScene(mol, PUBLICATION_STYLE, representation("sumFormula"));
    expect(texts(scene.primitives).join("")).not.toContain("Boc");
  });
});

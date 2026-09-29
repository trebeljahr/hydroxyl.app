import {
  applyArrows,
  benzene,
  buildMolecule,
  insertFragment,
  mechanismIssues,
  removeAtoms,
  removeBonds,
  reverseArrows,
  species,
  type AtomId,
  type Molecule,
} from "@starter/chem-core";
import { describe, expect, it } from "vitest";

import { STRUCTURAL_VIEW_KINDS, TEXT_VIEW_KINDS, representation } from "../representation.js";
import { buildScene } from "../scene/build.js";
import { SCREEN_STYLE } from "../style.js";
import {
  SCHEME_ANNOTATION_KINDS,
  assembleSchemeAnnotation,
  pruneSchemeAnnotations,
  sceneAnchorPlacement,
  schemeAnnotationAnchors,
  schemeAnnotationId,
  schemeAnnotationResolves,
  type CurlyArrowAnnotation,
  type ReactionArrowAnnotation,
  type SchemeAnnotation,
} from "./annotation.js";

/** Ethanol oxidised to acetaldehyde, drawn side by side as two species. */
function ethanolToAcetaldehyde(): {
  mol: Molecule;
  ethanol: readonly AtomId[];
  aldehyde: readonly AtomId[];
} {
  const ethanol: AtomId[] = [];
  const aldehyde: AtomId[] = [];
  const mol = buildMolecule((b) => {
    const c1 = b.atom("C", { x: 0, y: 0 });
    const c2 = b.atom("C", { x: 0.87, y: 0.5 });
    const o = b.atom("O", { x: 1.73, y: 0 });
    b.bond(c1, c2);
    b.bond(c2, o);
    ethanol.push(c1, c2, o);
    const d1 = b.atom("C", { x: 5, y: 0 });
    const d2 = b.atom("C", { x: 5.87, y: 0.5 });
    const d3 = b.atom("O", { x: 6.73, y: 0 });
    b.bond(d1, d2);
    b.bond(d2, d3, 2);
    aldehyde.push(d1, d2, d3);
  });
  return { mol, ethanol, aldehyde };
}

function arrow(from: AtomId, to: AtomId, row?: number): ReactionArrowAnnotation {
  return assembleSchemeAnnotation({
    id: schemeAnnotationId(1),
    kind: "reactionArrow",
    from: [from],
    to: [to],
    row,
  }) as ReactionArrowAnnotation;
}

describe("scheme annotation records", () => {
  it("omits an absent row rather than storing undefined, and copies what it is given", () => {
    const { ethanol, aldehyde } = ethanolToAcetaldehyde();
    const plain = arrow(ethanol[2]!, aldehyde[1]!);
    expect(plain).not.toHaveProperty("row");
    expect(Object.keys(plain)).toEqual(["id", "kind", "from", "to"]);
    expect(arrow(ethanol[2]!, aldehyde[1]!, 1).row).toBe(1);

    const from = [ethanol[0]!];
    const built = assembleSchemeAnnotation({ id: "ann_2", kind: "bracket", species: from });
    from.push("a99");
    expect(built).toEqual({ id: "ann_2", kind: "bracket", species: [ethanol[0]] });
  });

  it("lists five kinds, and names ids from a counter", () => {
    expect(SCHEME_ANNOTATION_KINDS).toEqual(["curlyArrow", "reactionArrow", "plus", "bracket", "text"]);
    expect(schemeAnnotationId(7)).toBe("ann_7");
  });
});

describe("visibility falls out of anchoring", () => {
  const ring = benzene();
  const bondId = ring.bondIds[0]!;
  const bond = ring.bonds[bondId]!;
  // The pi bond's electrons pushed onto one of its own carbons: a legitimate
  // arrow, and its source is a BOND, which is the case the done-when names.
  const curly: CurlyArrowAnnotation = {
    id: "ann_1",
    kind: "curlyArrow",
    electrons: "pair",
    source: { kind: "bond", bondId },
    sink: { kind: "atom", atomId: bond.to },
    bulge: 0.3,
    skew: 0,
  };

  it("shows a curly arrow anchored to a bond in every structural panel that places the bond", () => {
    for (const kind of STRUCTURAL_VIEW_KINDS) {
      const scene = buildScene(ring, SCREEN_STYLE, representation(kind));
      const placement = sceneAnchorPlacement(scene, ring);
      expect(placement.hasBond(bondId), kind).toBe(true);
      // A skeletal carbon is a bare vertex with no primitive of its own; it is
      // still placed, as a bond end.
      expect(placement.hasAtom(bond.to), kind).toBe(true);
      expect(schemeAnnotationResolves(curly, placement), kind).toBe(true);
    }
  });

  it("keeps it, and a free label, off every text panel with no flag to say so", () => {
    const label: SchemeAnnotation = { id: "ann_2", kind: "text", text: "Scheme 1", at: { x: 0, y: -2 } };
    for (const kind of TEXT_VIEW_KINDS) {
      const scene = buildScene(ring, SCREEN_STYLE, representation(kind));
      const placement = sceneAnchorPlacement(scene, ring);
      expect(schemeAnnotationResolves(curly, placement), kind).toBe(false);
      expect(schemeAnnotationResolves(label, placement), kind).toBe(false);
    }
    const skeletal = buildScene(ring, SCREEN_STYLE, representation("skeletal"));
    expect(schemeAnnotationResolves(label, sceneAnchorPlacement(skeletal, ring))).toBe(true);
    // A re-projected panel does not draw the model frame, and says so.
    expect(
      schemeAnnotationResolves(
        label,
        sceneAnchorPlacement(skeletal, ring, { drawsModelFrame: false }),
      ),
    ).toBe(false);
  });

  it("anchors species annotations by atom, and text by the frame", () => {
    expect(schemeAnnotationAnchors(curly)).toEqual([
      { kind: "bond", bondId },
      { kind: "atom", atomId: bond.to },
    ]);
    expect(
      schemeAnnotationAnchors({ id: "ann_3", kind: "plus", between: ["a1", "a7"] }),
    ).toEqual([
      { kind: "atom", atomId: "a1" },
      { kind: "atom", atomId: "a7" },
    ]);
    expect(
      schemeAnnotationAnchors({ id: "ann_4", kind: "text", text: "rt", at: { x: 0, y: 0 } }),
    ).toEqual([{ kind: "frame" }]);
  });
});

describe("pruning with the molecule edit", () => {
  it("returns the same array when nothing it names was touched", () => {
    const { mol, ethanol, aldehyde } = ethanolToAcetaldehyde();
    const list = [arrow(ethanol[2]!, aldehyde[1]!)];
    expect(pruneSchemeAnnotations(list, mol, mol)).toBe(list);
    const cut = removeBonds(mol, [mol.bondIds[0]!]);
    // Cutting ethanol's C-C bond leaves its O where it was; nothing to prune.
    expect(pruneSchemeAnnotations(list, mol, cut)).toBe(list);
  });

  it("re-points a species reference to the lowest surviving atom of its species", () => {
    const { mol, ethanol, aldehyde } = ethanolToAcetaldehyde();
    const list = [arrow(ethanol[2]!, aldehyde[1]!, 0)];
    const withoutOxygen = removeAtoms(mol, [ethanol[2]!]);
    const pruned = pruneSchemeAnnotations(list, mol, withoutOxygen);
    expect(pruned).toEqual([
      { id: "ann_1", kind: "reactionArrow", from: [ethanol[0]], to: [aldehyde[1]], row: 0 },
    ]);
    expect(pruned[0]).not.toBe(list[0]);
  });

  it("drops an arrow whose whole species was deleted, and a curly arrow whose bond was", () => {
    const { mol, ethanol, aldehyde } = ethanolToAcetaldehyde();
    const curly: CurlyArrowAnnotation = {
      id: "ann_2",
      kind: "curlyArrow",
      electrons: "pair",
      source: { kind: "bond", bondId: mol.bondIds[3]! },
      sink: { kind: "lonePair", atomId: aldehyde[2]! },
      bulge: -0.25,
      skew: 0.1,
    };
    const label: SchemeAnnotation = { id: "ann_3", kind: "text", text: "PCC", at: { x: 3, y: 1 } };
    const list: SchemeAnnotation[] = [arrow(ethanol[2]!, aldehyde[1]!), curly, label];

    const withoutEthanol = removeAtoms(mol, ethanol);
    expect(pruneSchemeAnnotations(list, mol, withoutEthanol)).toEqual([curly, label]);

    const withoutCarbonyl = removeBonds(mol, [mol.bondIds[3]!]);
    expect(pruneSchemeAnnotations(list, mol, withoutCarbonyl)).toEqual([list[0], label]);
  });

  it("never resolves a reference up Object.prototype", () => {
    const { mol, ethanol } = ethanolToAcetaldehyde();
    const list = [arrow("constructor", ethanol[0]!), arrow(ethanol[0]!, "toString")];
    const edited = removeAtoms(mol, [ethanol[2]!]);
    expect(pruneSchemeAnnotations(list, mol, edited)).toEqual([]);
  });

  it("keeps a bracket over a resonance pair when an unrelated species is pasted in", () => {
    const { mol, ethanol, aldehyde } = ethanolToAcetaldehyde();
    const bracket: SchemeAnnotation = {
      id: "ann_4",
      kind: "bracket",
      species: [ethanol[0]!, aldehyde[0]!],
    };
    const pasted = insertFragment(mol, benzene(), { offset: { x: 10, y: 0 } }).molecule;
    expect(species(pasted)).toHaveLength(3);
    const list = [bracket];
    expect(pruneSchemeAnnotations(list, mol, pasted)).toBe(list);
  });
});

describe("a drawn curly arrow is chem-core's electron move (decision 149)", () => {
  it("passes a document's curly arrows straight into applyArrows and reverseArrows", () => {
    // Hydroxide and bromomethane, with the two arrows of an SN2 drawn on them.
    let c = "";
    let br = "";
    let cBr = "";
    let o = "";
    const mol = buildMolecule((b) => {
      c = b.atom("C", { x: 0, y: 0 });
      br = b.atom("Br", { x: 1, y: 0 });
      cBr = b.bond(c, br);
      o = b.atom("O", { x: -2, y: 0 }, { charge: -1 });
    });
    const annotations: readonly SchemeAnnotation[] = [
      assembleSchemeAnnotation({
        id: schemeAnnotationId(1),
        kind: "curlyArrow",
        electrons: "pair",
        source: { kind: "lonePair", atomId: o },
        sink: { kind: "atom", atomId: c },
        bulge: 0.3,
        skew: 0,
      }),
      assembleSchemeAnnotation({
        id: schemeAnnotationId(2),
        kind: "curlyArrow",
        electrons: "pair",
        source: { kind: "bond", bondId: cBr },
        sink: { kind: "atom", atomId: br },
        bulge: -0.2,
        skew: 0.1,
      }),
    ];
    const arrows = annotations.filter((a): a is CurlyArrowAnnotation => a.kind === "curlyArrow");

    // No adapter: the annotation records are the arrows.
    const product = applyArrows(mol, arrows);
    expect([product.atoms[br]!.charge, product.atoms[o]!.charge]).toEqual([-1, 0]);
    expect(mechanismIssues(mol, arrows)).toEqual([]);
    const back = applyArrows(product, reverseArrows(mol, arrows));
    expect(back.atoms).toEqual(mol.atoms);
  });
});

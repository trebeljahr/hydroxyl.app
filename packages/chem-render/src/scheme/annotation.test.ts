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
  CURLY_ARROW_SINK_KINDS,
  SCHEME_ANNOTATION_KINDS,
  assembleSchemeAnnotation,
  materialFlow,
  pruneSchemeAnnotations,
  schemeSpeciesRefs,
  sceneAnchorPlacement,
  schemeAnnotationAnchors,
  schemeAnnotationId,
  schemeAnnotationResolves,
  type CurlyArrowAnnotation,
  type ReactionArrowAnnotation,
  type SchemeAnnotation,
  type SchemeAnnotationKind,
} from "./annotation.js";

/** One record of every kind, for the tests that must hold over all of them. */
const SAMPLES: { readonly [K in SchemeAnnotationKind]: Extract<SchemeAnnotation, { kind: K }> } = {
  curlyArrow: {
    id: "ann_1",
    kind: "curlyArrow",
    electrons: "pair",
    source: { kind: "lonePair", atomId: "a1" },
    sink: { kind: "atom", atomId: "a2" },
    bulge: 0.3,
    skew: 0,
  },
  reactionArrow: { id: "ann_2", kind: "reactionArrow", from: ["a1"], to: ["a7"] },
  retrosynthesisArrow: { id: "ann_3", kind: "retrosynthesisArrow", target: ["a7"], precursors: ["a1"] },
  resonanceArrow: { id: "ann_4", kind: "resonanceArrow", between: ["a1", "a7"] },
  plus: { id: "ann_5", kind: "plus", between: ["a1", "a7"] },
  bracket: { id: "ann_6", kind: "bracket", species: ["a1"], charge: 1 },
  text: { id: "ann_7", kind: "text", text: "rt", at: { x: 0, y: 0 } },
  partialBond: { id: "ann_8", kind: "partialBond", atoms: ["a1", "a2"] },
  partialCharge: { id: "ann_9", kind: "partialCharge", atomId: "a1", sign: "+" },
  coefficient: { id: "ann_10", kind: "coefficient", species: "a1", value: 2 },
};

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

  it("lists ten kinds, the reaction-arrows task's five among them, and names ids from a counter", () => {
    expect(SCHEME_ANNOTATION_KINDS).toEqual([
      "curlyArrow",
      "reactionArrow",
      "retrosynthesisArrow",
      "resonanceArrow",
      "plus",
      "bracket",
      "text",
      "partialBond",
      "partialCharge",
      "coefficient",
    ]);
    expect(schemeAnnotationId(7)).toBe("ann_7");
  });

  it("stores an equilibrium, its bias and its conditions key by key, never an undefined", () => {
    const { ethanol, aldehyde } = ethanolToAcetaldehyde();
    const steps = [[{ kind: "reagent" as const, text: "PCC" }, { kind: "solvent" as const, text: "CH2Cl2" }]];
    const built = assembleSchemeAnnotation({
      id: "ann_5",
      kind: "reactionArrow",
      from: [ethanol[0]!],
      to: [aldehyde[0]!],
      row: undefined,
      equilibrium: { bias: undefined },
      conditions: { steps, numbered: false },
    });
    expect(Object.keys(built)).toEqual(["id", "kind", "from", "to", "equilibrium", "conditions"]);
    expect(built).toMatchObject({ equilibrium: {} });
    // Copied, so a caller's later edit cannot reach the record.
    steps[0]!.push({ kind: "reagent", text: "NaOAc" });
    expect(built).toMatchObject({ conditions: { steps: [[{ text: "PCC" }, { text: "CH2Cl2" }]] } });

    const bracket = assembleSchemeAnnotation({
      id: "ann_6",
      kind: "bracket",
      species: [ethanol[0]!],
      charge: undefined,
      transitionState: undefined,
    });
    expect(Object.keys(bracket)).toEqual(["id", "kind", "species"]);
  });

  it("lists four sink kinds, the new bond last (decision 166), and copies its atom pair", () => {
    expect(CURLY_ARROW_SINK_KINDS).toEqual(["atom", "bond", "lonePair", "newBond"]);
    const atomIds: [AtomId, AtomId] = ["a3", "a5"];
    const built = assembleSchemeAnnotation({
      id: "ann_1",
      kind: "curlyArrow",
      electrons: "pair",
      source: { kind: "bond", bondId: "b4" },
      sink: { kind: "newBond", atomIds },
      bulge: 0.25,
      skew: 0,
    }) as CurlyArrowAnnotation;
    atomIds[1] = "a99";
    expect(built.sink).toEqual({ kind: "newBond", atomIds: ["a3", "a5"] });
    expect(schemeAnnotationAnchors(built)).toEqual([
      { kind: "bond", bondId: "b4" },
      { kind: "atom", atomId: "a3" },
      { kind: "atom", atomId: "a5" },
    ]);
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

  it("anchors a transition state's partial bond and delta to their atoms, a coefficient to its species", () => {
    expect(schemeAnnotationAnchors({ id: "ann_5", kind: "partialBond", atoms: ["a1", "a4"] })).toEqual([
      { kind: "atom", atomId: "a1" },
      { kind: "atom", atomId: "a4" },
    ]);
    expect(schemeAnnotationAnchors({ id: "ann_6", kind: "partialCharge", atomId: "a4", sign: "-" })).toEqual([
      { kind: "atom", atomId: "a4" },
    ]);
    expect(schemeAnnotationAnchors({ id: "ann_7", kind: "coefficient", species: "a9", value: 2 })).toEqual([
      { kind: "atom", atomId: "a9" },
    ]);
    // Only the species kinds are re-pointed; the atom kinds go with their atom.
    expect(schemeSpeciesRefs({ id: "ann_5", kind: "partialBond", atoms: ["a1", "a4"] })).toEqual([]);
    expect(schemeSpeciesRefs({ id: "ann_7", kind: "coefficient", species: "a9", value: 2 })).toEqual(["a9"]);
  });
});

describe("what an arrow says about material (decision 201)", () => {
  const forward: SchemeAnnotation = { id: "ann_1", kind: "reactionArrow", from: ["a1"], to: ["a7"] };

  it("reads a forward arrow and an equilibrium from -> to, the equilibrium both ways", () => {
    expect(materialFlow(forward)).toEqual({ reactants: ["a1"], products: ["a7"], reversible: false });
    expect(materialFlow({ ...forward, equilibrium: { bias: "forward" } })).toEqual({
      reactants: ["a1"],
      products: ["a7"],
      reversible: true,
    });
  });

  it("turns a retrosynthetic arrow round: the precursors are what is consumed", () => {
    // Testosterone => cholesterol (Ruzicka, 1935): the arrow points from the
    // target back to what it is made from, AGAINST material flow.
    const retro: SchemeAnnotation = {
      id: "ann_2",
      kind: "retrosynthesisArrow",
      target: ["a1"],
      precursors: ["a40"],
    };
    expect(materialFlow(retro)).toEqual({ reactants: ["a40"], products: ["a1"], reversible: false });
  });

  it("gives a resonance arrow no reading at all: two drawings of one compound are not a reaction", () => {
    expect(materialFlow({ id: "ann_3", kind: "resonanceArrow", between: ["a1", "a7"] })).toBeUndefined();
    for (const kind of SCHEME_ANNOTATION_KINDS) {
      const reads = kind === "reactionArrow" || kind === "retrosynthesisArrow";
      const sample = SAMPLES[kind];
      expect(sample.kind).toBe(kind);
      expect(materialFlow(sample) !== undefined, kind).toBe(reads);
    }
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

  it("drops a new-bond arrow when EITHER of its two atoms is deleted, and keeps it otherwise", () => {
    // Propene's pi pair to the new C1-H bond with HBr beside it (decision 166).
    let c1 = "";
    let h = "";
    let br = "";
    let pi = "";
    const mol = buildMolecule((b) => {
      const c3 = b.atom("C", { x: 0, y: 0 });
      const c2 = b.atom("C", { x: 0.87, y: 0.5 });
      b.bond(c3, c2);
      c1 = b.atom("C", { x: 1.73, y: 0 });
      pi = b.bond(c2, c1, 2);
      h = b.atom("H", { x: 1.73, y: 1.5 });
      br = b.atom("Br", { x: 1.73, y: 2.5 });
      b.bond(h, br);
    });
    const curly: CurlyArrowAnnotation = {
      id: "ann_1",
      kind: "curlyArrow",
      electrons: "pair",
      source: { kind: "bond", bondId: pi },
      sink: { kind: "newBond", atomIds: [c1, h] },
      bulge: 0.25,
      skew: 0,
    };
    const list = [curly];
    expect(pruneSchemeAnnotations(list, mol, removeAtoms(mol, [br]))).toBe(list);
    expect(pruneSchemeAnnotations(list, mol, removeAtoms(mol, [h]))).toEqual([]);
    // Deleting C1 takes the pi bond too, so the source goes as well; the
    // sink alone is enough: a far atom the arrow does not start at.
    const farSink: CurlyArrowAnnotation = { ...curly, source: { kind: "bond", bondId: mol.bondIds[0]! } };
    expect(pruneSchemeAnnotations([farSink], mol, removeAtoms(mol, [c1]))).toEqual([]);
  });

  it("never resolves a reference up Object.prototype", () => {
    const { mol, ethanol } = ethanolToAcetaldehyde();
    const list = [arrow("constructor", ethanol[0]!), arrow(ethanol[0]!, "toString")];
    const edited = removeAtoms(mol, [ethanol[2]!]);
    expect(pruneSchemeAnnotations(list, mol, edited)).toEqual([]);
  });

  it("drops a partial bond or a delta with its atom, and re-points a coefficient within its species", () => {
    const { mol, ethanol, aldehyde } = ethanolToAcetaldehyde();
    const partial: SchemeAnnotation = { id: "ann_1", kind: "partialBond", atoms: [ethanol[2]!, aldehyde[1]!] };
    const delta: SchemeAnnotation = { id: "ann_2", kind: "partialCharge", atomId: ethanol[2]!, sign: "-" };
    const coefficient: SchemeAnnotation = { id: "ann_3", kind: "coefficient", species: ethanol[2]!, value: 2 };
    const resonance: SchemeAnnotation = { id: "ann_4", kind: "resonanceArrow", between: [ethanol[1]!, aldehyde[1]!] };
    const retro: SchemeAnnotation = {
      id: "ann_5",
      kind: "retrosynthesisArrow",
      target: [aldehyde[2]!],
      precursors: [ethanol[2]!],
    };
    const list = [partial, delta, coefficient, resonance, retro];
    const withoutOxygen = removeAtoms(mol, [ethanol[2]!]);
    expect(pruneSchemeAnnotations(list, mol, withoutOxygen)).toEqual([
      { ...coefficient, species: ethanol[0] },
      resonance,
      { ...retro, precursors: [ethanol[0]] },
    ]);
    // The whole aldehyde gone: every mark that names it goes with it.
    expect(pruneSchemeAnnotations(list, mol, removeAtoms(mol, aldehyde))).toEqual([delta, coefficient]);
  });

  it("keeps a bracket's charge and dagger when it re-points one of its species", () => {
    const { mol, ethanol, aldehyde } = ethanolToAcetaldehyde();
    const bracket: SchemeAnnotation = {
      id: "ann_4",
      kind: "bracket",
      species: [ethanol[2]!, aldehyde[0]!],
      charge: -1,
      transitionState: true,
    };
    const pruned = pruneSchemeAnnotations([bracket], mol, removeAtoms(mol, [ethanol[2]!]));
    expect(pruned).toEqual([{ ...bracket, species: [ethanol[0], aldehyde[0]] }]);
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

  it("passes a new-bond sink straight through too: HBr protonates propene at C1", () => {
    let c1 = "";
    let c2 = "";
    let h = "";
    let br = "";
    let pi = "";
    let hbr = "";
    const mol = buildMolecule((b) => {
      const c3 = b.atom("C", { x: 0, y: 0 });
      c2 = b.atom("C", { x: 0.87, y: 0.5 });
      b.bond(c3, c2);
      c1 = b.atom("C", { x: 1.73, y: 0 });
      pi = b.bond(c2, c1, 2);
      h = b.atom("H", { x: 1.73, y: 1.5 });
      br = b.atom("Br", { x: 1.73, y: 2.5 });
      hbr = b.bond(h, br);
    });
    const arrows = [
      assembleSchemeAnnotation({
        id: schemeAnnotationId(1),
        kind: "curlyArrow",
        electrons: "pair",
        source: { kind: "bond", bondId: pi },
        sink: { kind: "newBond", atomIds: [c1, h] },
        bulge: 0.25,
        skew: 0,
      }),
      assembleSchemeAnnotation({
        id: schemeAnnotationId(2),
        kind: "curlyArrow",
        electrons: "pair",
        source: { kind: "bond", bondId: hbr },
        sink: { kind: "atom", atomId: br },
        bulge: -0.7,
        skew: 0,
      }),
    ].filter((a): a is CurlyArrowAnnotation => a.kind === "curlyArrow");
    const product = applyArrows(mol, arrows);
    expect([product.atoms[c2]!.charge, product.atoms[br]!.charge]).toEqual([1, -1]);
    expect(mechanismIssues(mol, arrows)).toEqual([]);
    expect(applyArrows(product, reverseArrows(mol, arrows)).atoms).toEqual(mol.atoms);
  });
});

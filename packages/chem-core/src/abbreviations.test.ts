import { describe, expect, it } from "vitest";

import { abbreviationCandidateAt, suggestAbbreviationLabel } from "./abbreviation-labels.js";
import {
  AbbreviationError,
  abbreviationAt,
  abbreviationsOf,
  canCollapseAbbreviation,
  closeOverAbbreviations,
  collapseAbbreviation,
  contractedAbbreviations,
  contractedView,
  expandAbbreviation,
  withAbbreviations,
} from "./abbreviations.js";
import { benzene, linearChain } from "./builders.js";
import { canCondense, condensedFormula } from "./condensed.js";
import { duplicateFragment, extractFragment, insertFragment } from "./fragment.js";
import { exactMass, molecularFormula } from "./formula.js";
import { attachGroupToAtom } from "./groups.js";
import { chemistryIssues } from "./issues.js";
import { addBond, requireAtom } from "./molecule.js";
import { mergeAtoms, removeAtoms, removeBond } from "./ops.js";
import type { AtomId, Molecule } from "./types.js";

/** tert-Butyl phenylcarbamate, both groups stamped: aniline's N, then Boc. */
function bocAniline(): { mol: Molecule; nitrogen: AtomId; boc: readonly AtomId[] } {
  const ring = benzene();
  const amine = attachGroupToAtom(ring, ring.atomIds[0]!, "NH2");
  const nitrogen = amine.atomIds[0]!;
  const boc = attachGroupToAtom(amine.molecule, nitrogen, "Boc");
  return { mol: boc.molecule, nitrogen, boc: boc.atomIds };
}

/** tert-Butyldimethyl(phenoxy)silane: phenol's O, then TBS. */
function otbsBenzene(): { mol: Molecule; oxygen: AtomId; tbs: readonly AtomId[] } {
  const ring = benzene();
  const phenol = attachGroupToAtom(ring, ring.atomIds[0]!, "OH");
  const oxygen = phenol.atomIds[0]!;
  const tbs = attachGroupToAtom(phenol.molecule, oxygen, "TBS");
  return { mol: tbs.molecule, oxygen, tbs: tbs.atomIds };
}

describe("contracting changes no chemistry (decision 225)", () => {
  it("a contracted Boc keeps the carbamate's formula, mass and issues", () => {
    const { mol, boc } = bocAniline();
    const contracted = collapseAbbreviation(mol, boc, "Boc");
    expect(molecularFormula(contracted)).toBe("C11H15NO2");
    expect(exactMass(contracted)).toBe(exactMass(mol));
    expect(chemistryIssues(contracted)).toEqual(chemistryIssues(mol));
    expect(abbreviationsOf(contracted)).toEqual([{ label: "Boc", atomIds: [...boc] }]);
  });

  it("puts the label on the inside end of the one bond out", () => {
    const { mol, nitrogen, boc } = bocAniline();
    const [c] = contractedAbbreviations(collapseAbbreviation(mol, boc, "Boc"));
    expect(c?.hostAtomId).toBe(boc[0]);
    expect(c?.outsideAtomId).toBe(nitrogen);
  });
});

describe("which selections contract", () => {
  it("needs exactly one bond out", () => {
    const { mol, boc } = bocAniline();
    expect(canCollapseAbbreviation(mol, boc).ok).toBe(true);
    expect(canCollapseAbbreviation(mol, mol.atomIds).ok).toBe(false);
    // The carbonyl carbon alone is joined to N and both oxygens.
    expect(canCollapseAbbreviation(mol, [boc[0]!]).ok).toBe(false);
    expect(canCollapseAbbreviation(mol, []).ok).toBe(false);
  });

  it("refuses a selection that cuts through a contracted group, and absorbs one it contains", () => {
    const { mol, nitrogen, boc } = bocAniline();
    const inner = collapseAbbreviation(mol, boc, "Boc");
    const check = canCollapseAbbreviation(inner, boc.slice(2));
    expect(check.ok).toBe(false);
    const outer = collapseAbbreviation(inner, [nitrogen, ...boc], "NHBoc");
    expect(abbreviationsOf(outer)).toEqual([{ label: "NHBoc", atomIds: [nitrogen, ...boc] }]);
  });

  it("throws a named error rather than storing a bad group", () => {
    const { mol, boc } = bocAniline();
    expect(() => collapseAbbreviation(mol, mol.atomIds, "X")).toThrow(AbbreviationError);
    expect(() => collapseAbbreviation(mol, boc, "  ")).toThrow(AbbreviationError);
    expect(() => withAbbreviations(mol, [{ label: "Boc", atomIds: ["a999"] }])).toThrow(AbbreviationError);
    expect(() =>
      withAbbreviations(mol, [
        { label: "A", atomIds: [boc[0]!] },
        { label: "B", atomIds: [boc[0]!] },
      ]),
    ).toThrow(AbbreviationError);
  });

  it("collapsing the same group twice is no edit", () => {
    const { mol, boc } = bocAniline();
    const once = collapseAbbreviation(mol, boc, "Boc");
    expect(collapseAbbreviation(once, boc, "Boc")).toBe(once);
  });
});

describe("suggested labels", () => {
  it("recognises a stamped group from its atoms", () => {
    const { mol, boc } = bocAniline();
    expect(suggestAbbreviationLabel(mol, boc)).toBe("Boc");
  });

  it("spells a heteroatom carrying a group with its own hydrogens", () => {
    const { mol, nitrogen, boc } = bocAniline();
    expect(suggestAbbreviationLabel(mol, [nitrogen, ...boc])).toBe("NHBoc");
    const ether = otbsBenzene();
    expect(suggestAbbreviationLabel(ether.mol, [ether.oxygen, ...ether.tbs])).toBe("OTBS");
    expect(suggestAbbreviationLabel(ether.mol, ether.tbs)).toBe("TBS");
  });

  it("recognises a phenyl drawn as a ring", () => {
    const chain = linearChain(2);
    const ring = attachGroupToAtom(chain, chain.atomIds[1]!, "Ph");
    expect(suggestAbbreviationLabel(ring.molecule, ring.atomIds)).toBe("Ph");
  });

  it("offers the whole stamped group for a click on any of its atoms", () => {
    const { mol, boc } = bocAniline();
    for (const atom of boc) {
      const candidate = abbreviationCandidateAt(mol, atom);
      expect(candidate?.label).toBe("Boc");
      expect([...(candidate?.atomIds ?? [])].sort()).toEqual([...boc].sort());
    }
    expect(abbreviationCandidateAt(mol, mol.atomIds[2]!)?.label).toBe("Ph");
    const ether = otbsBenzene();
    expect(abbreviationCandidateAt(ether.mol, ether.oxygen)?.label).toBe("OTBS");
  });

  it("returns nothing for atoms the table does not know", () => {
    const chain = linearChain(5);
    expect(suggestAbbreviationLabel(chain, chain.atomIds.slice(1))).toBeUndefined();
  });
});

describe("expanding", () => {
  it("removes the grouping and keeps every atom", () => {
    const { mol, boc } = bocAniline();
    const contracted = collapseAbbreviation(mol, boc, "Boc");
    const expanded = expandAbbreviation(contracted, boc[3]!);
    expect(expanded).toEqual(mol);
    expect(expandAbbreviation(mol, boc[0]!)).toBe(mol);
  });
});

describe("the grouping across edits (decision 240)", () => {
  it("goes when any of its atoms is deleted, and with all of them", () => {
    const { mol, boc } = bocAniline();
    const contracted = collapseAbbreviation(mol, boc, "Boc");
    expect(abbreviationsOf(removeAtoms(contracted, [boc[4]!]))).toEqual([]);
    expect(abbreviationsOf(removeAtoms(contracted, boc))).toEqual([]);
  });

  it("stays when the atom it is attached to is deleted: a lone Boc still draws", () => {
    const { mol, nitrogen, boc } = bocAniline();
    const contracted = removeAtoms(collapseAbbreviation(mol, boc, "Boc"), [nitrogen]);
    expect(abbreviationsOf(contracted)).toHaveLength(1);
    expect(contractedAbbreviations(contracted)[0]?.bondId).toBeUndefined();
  });

  it("goes when one of its atoms is merged into another", () => {
    const { mol, nitrogen, boc } = bocAniline();
    const contracted = collapseAbbreviation(mol, boc, "Boc");
    const merged = mergeAtoms(contracted, boc[6]!, nitrogen);
    expect(abbreviationsOf(merged.molecule)).toEqual([]);
  });

  it("draws expanded while a second bond leaves it, and contracts again once it goes", () => {
    const { mol, boc } = bocAniline();
    const contracted = collapseAbbreviation(mol, boc, "Boc");
    const ring = mol.atomIds[1]!;
    const extra = addBond(contracted, { from: boc[4]!, to: ring });
    expect(abbreviationsOf(extra.molecule)).toHaveLength(1);
    expect(contractedAbbreviations(extra.molecule)).toEqual([]);
    expect(contractedAbbreviations(removeBond(extra.molecule, extra.id))).toHaveLength(1);
  });

  it("travels with a copy of all its atoms and not with part of them", () => {
    const { mol, nitrogen, boc } = bocAniline();
    const contracted = collapseAbbreviation(mol, boc, "Boc");
    const whole = extractFragment(contracted, [nitrogen, ...boc]);
    expect(abbreviationsOf(whole.molecule).map((a) => a.label)).toEqual(["Boc"]);
    expect(abbreviationsOf(whole.molecule)[0]?.atomIds).toEqual(boc.map((id) => whole.atomIdMap.get(id)));
    expect(abbreviationsOf(extractFragment(contracted, boc.slice(1)).molecule)).toEqual([]);

    const pasted = insertFragment(contracted, whole.molecule);
    expect(abbreviationsOf(pasted.molecule)).toHaveLength(2);
    const copied = duplicateFragment(contracted, contracted.atomIds);
    expect(abbreviationsOf(copied.molecule)).toHaveLength(2);
  });
});

describe("selection over a label", () => {
  it("closes over every atom of a contracted group it touches", () => {
    const { mol, boc } = bocAniline();
    const contracted = collapseAbbreviation(mol, boc, "Boc");
    expect([...closeOverAbbreviations(contracted, [boc[0]!])].sort()).toEqual([...boc].sort());
    const untouched = [mol.atomIds[1]!];
    expect(closeOverAbbreviations(contracted, untouched)).toBe(untouched);
  });
});

describe("contractedView", () => {
  it("draws the group as its host atom carrying the label, joined by the one bond", () => {
    const { mol, nitrogen, boc } = bocAniline();
    const contracted = collapseAbbreviation(mol, boc, "Boc");
    const view = contractedView(contracted);
    expect(view.molecule.atomIds).toHaveLength(mol.atomIds.length - boc.length + 1);
    expect(view.molecule.bondIds).toHaveLength(mol.bondIds.length - (boc.length - 1));
    expect(requireAtom(view.molecule, boc[0]!).label).toBe("Boc");
    expect(view.hidden.has(boc[1]!)).toBe(true);
    expect(view.hosts.get(boc[0]!)?.outsideAtomId).toBe(nitrogen);
    expect(contractedView(contracted)).toBe(view);
  });

  it("is the molecule itself when nothing is contracted", () => {
    const { mol } = bocAniline();
    expect(contractedView(mol).molecule).toBe(mol);
  });

  it("strips a charged host to its label: a contracted nitro is NO2, not NO2+", () => {
    const ring = benzene();
    const nitro = attachGroupToAtom(ring, ring.atomIds[0]!, "NO2");
    const contracted = collapseAbbreviation(nitro.molecule, nitro.atomIds, "NO₂");
    expect(requireAtom(contractedView(contracted).molecule, nitro.atomIds[0]!).charge).toBe(0);
  });
});

describe("the condensed view reads labels", () => {
  it("spells a contracted phenyl as Ph, so 2-phenylethanol condenses", () => {
    const chain = linearChain(2);
    const ph = attachGroupToAtom(chain, chain.atomIds[0]!, "Ph");
    const oh = attachGroupToAtom(ph.molecule, chain.atomIds[1]!, "OH").molecule;
    expect(canCondense(oh)).toBe(false);
    const contracted = collapseAbbreviation(oh, ph.atomIds, "Ph");
    expect(canCondense(contracted)).toBe(true);
    expect(condensedFormula(contracted)).toBe("PhCH2CH2OH");
  });

  it("keeps the label's own atoms out of the walk", () => {
    const { mol, boc } = bocAniline();
    expect(abbreviationAt(collapseAbbreviation(mol, boc, "Boc"), boc[2]!)?.label).toBe("Boc");
  });
});

/**
 * The composed issue list, its ids, and the one-click fixes.
 *
 * Real molecules drawn the way a chemist gets them wrong — a nitro group with
 * two N=O bonds, a quaternary ammonium without its plus sign, a wedge on
 * propan-2-ol — so a failure reads as a chemistry error, and every fix is
 * asserted by what the molecule says afterwards rather than by the fix object.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildMolecule } from "./builders.js";
import { elementCounts, netCharge } from "./formula.js";
import { applyIssueFix, chemistryIssues, issueFixes } from "./issues.js";
import { readMolblock } from "./molblock-read.js";
import { removeAtom } from "./ops.js";
import { cipDescriptor } from "./stereo.js";
import type { AtomId, Molecule } from "./types.js";
import { implicitHydrogenCount } from "./valence.js";
import { fromPolar, vec, type Vec2 } from "./vec.js";

/** One bond length from `from` at `degrees`. */
function step(from: Vec2, degrees: number): Vec2 {
  const d = fromPolar((degrees * Math.PI) / 180, 1);
  return vec(from.x + d.x, from.y + d.y);
}

/** Nitromethane drawn with a PENTAVALENT nitrogen, N(=O)=O. */
function pentavalentNitromethane(): Molecule {
  return buildMolecule((b) => {
    const c = b.atom("C", vec(0, 0));
    const n = b.atom("N", step(vec(0, 0), 0));
    b.bond(c, n, 1);
    b.bond(n, b.atom("O", step(step(vec(0, 0), 0), 60)), 2);
    b.bond(n, b.atom("O", step(step(vec(0, 0), 0), -60)), 2);
  });
}

/** Tetramethylammonium with the charge forgotten. */
function unchargedTetramethylammonium(): Molecule {
  return buildMolecule((b) => {
    const n = b.atom("N", vec(0, 0));
    for (const angle of [0, 90, 180, 270]) b.bond(n, b.atom("C", step(vec(0, 0), angle)), 1);
  });
}

/** Tetramethylborate with the charge forgotten. */
function unchargedTetramethylborate(): Molecule {
  return buildMolecule((b) => {
    const boron = b.atom("B", vec(0, 0));
    for (const angle of [0, 90, 180, 270]) b.bond(boron, b.atom("C", step(vec(0, 0), angle)), 1);
  });
}

/** Isobutene with a methyl too many on C2: C2 carries a double bond and three
 *  singles, and the double bond is the only one that can give. */
function overloadedIsobutene(): Molecule {
  return buildMolecule((b) => {
    const c2 = b.atom("C", vec(0, 0));
    b.bond(c2, b.atom("C", step(vec(0, 0), 90)), 2);
    for (const angle of [210, 330, 270]) b.bond(c2, b.atom("C", step(vec(0, 0), angle)), 1);
  });
}

/** Neopentane's centre with a fifth methyl: no multiple bond, no charge fits. */
function pentamethylCarbon(): Molecule {
  return buildMolecule((b) => {
    const c = b.atom("C", vec(0, 0));
    for (const angle of [0, 72, 144, 216, 288]) b.bond(c, b.atom("C", step(vec(0, 0), angle)), 1);
  });
}

/** CH3-NH3 with three hydrogens pinned on an uncharged nitrogen. */
function unchargedMethylammonium(): Molecule {
  return buildMolecule((b) => {
    const c = b.atom("C", vec(0, 0));
    b.bond(c, b.atom("N", vec(1, 0), { explicitHydrogenCount: 3 }), 1);
  });
}

/** Propan-2-ol with a wedge to the oxygen: C2 carries two methyls, so it is
 *  not a stereocentre however it is drawn. */
function propan2olWedged(): Molecule {
  return buildMolecule((b) => {
    const c2 = b.atom("C", vec(0, 0));
    b.bond(c2, b.atom("C", step(vec(0, 0), 210)), 1);
    b.bond(c2, b.atom("C", step(vec(0, 0), 330)), 1);
    b.bond(c2, b.atom("O", step(vec(0, 0), 90)), 1, "wedge");
  });
}

/** Butan-2-ol with the wedge drawn BACKWARDS: narrow end on the oxygen. */
function butan2olBackwards(): Molecule {
  return buildMolecule((b) => {
    const c1 = b.atom("C", vec(0, 0));
    const c2Pos = step(vec(0, 0), 30);
    const c2 = b.atom("C", c2Pos);
    const c3Pos = step(c2Pos, -30);
    const c3 = b.atom("C", c3Pos);
    const c4 = b.atom("C", step(c3Pos, 30));
    const oxygen = b.atom("O", step(c2Pos, 90));
    b.bond(c1, c2, 1);
    b.bond(oxygen, c2, 1, "wedge");
    b.bond(c2, c3, 1);
    b.bond(c3, c4, 1);
  });
}

const CASES = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "cip", "cases.json"),
    "utf8",
  ),
) as { cases: Record<string, { molblock: string }> };

function pentaDiene(): Molecule {
  return readMolblock(CASES.cases["penta-2-3-diene"]!.molblock).molecule;
}

function onlyIssue(mol: Molecule) {
  const issues = chemistryIssues(mol);
  expect(issues).toHaveLength(1);
  return issues[0]!;
}

function atomOf(mol: Molecule, element: string): AtomId {
  const id = mol.atomIds.find((candidate) => mol.atoms[candidate]!.element === element);
  if (id === undefined) throw new Error(`no ${element}`);
  return id;
}

describe("chemistryIssues", () => {
  it("is empty for sound structures, charge-separated nitro included", () => {
    const nitro = pentavalentNitromethane();
    const fixed = applyIssueFix(nitro, issueFixes(nitro, onlyIssue(nitro))[0]!);
    expect(chemistryIssues(fixed)).toEqual([]);
  });

  it("anchors an over-valent atom and names every bond it carries", () => {
    const mol = pentamethylCarbon();
    const issue = onlyIssue(mol);
    expect(issue.kind).toBe("over-valent");
    expect(issue.severity).toBe("error");
    expect(issue.atomId).toBe(mol.atomIds[0]);
    expect(issue.atomIds).toEqual([mol.atomIds[0]]);
    expect([...issue.bondIds].sort()).toEqual([...mol.bondIds].sort());
    expect(issue.label).toBe("C has 5 bonds; max 4");
  });

  it("names both ends of a misplaced wedge, anchored where the claim lands", () => {
    const mol = propan2olWedged();
    const issue = onlyIssue(mol);
    expect(issue.kind).toBe("wedge-on-non-stereocenter");
    const wedge = mol.bondIds.find((id) => mol.bonds[id]!.stereo === "wedge")!;
    expect(issue.bondIds).toEqual([wedge]);
    expect(issue.atomIds).toEqual([mol.bonds[wedge]!.from, mol.bonds[wedge]!.to]);
    expect(issue.label).toBe("wedge at a non-stereocentre");
  });

  it("anchors a backwards wedge on the stereocentre, the wide end", () => {
    const mol = butan2olBackwards();
    const issue = onlyIssue(mol);
    expect(issue.kind).toBe("wedge-drawn-backwards");
    const wedge = mol.bondIds.find((id) => mol.bonds[id]!.stereo === "wedge")!;
    expect(issue.atomId).toBe(mol.bonds[wedge]!.to);
    expect(mol.atoms[issue.atomId]!.element).toBe("C");
    expect(issue.atomIds).toContain(mol.bonds[wedge]!.from);
    expect(issue.label).toBe("wedge points the wrong way");
  });

  it("names the whole axis of an allene, not only its anchor", () => {
    const mol = pentaDiene();
    const issue = onlyIssue(mol);
    expect(issue.kind).toBe("unrepresentable-stereo");
    expect(issue.severity).toBe("warning");
    expect(issue.atomIds[0]).toBe(issue.atomId);
    expect(issue.atomIds.length).toBeGreaterThan(1);
    expect(issue.bondIds.length).toBeGreaterThanOrEqual(2);
    for (const id of issue.bondIds) expect(mol.bonds[id]).toBeDefined();
    expect(issue.label).toBe("allene axis not expressible");
  });
});

describe("issueFixes", () => {
  it("charge-separates a pentavalent nitro group and keeps it neutral", () => {
    const mol = pentavalentNitromethane();
    const fixes = issueFixes(mol, onlyIssue(mol));
    expect(fixes[0]!.kind).toBe("charge-separate");
    expect(fixes[0]!.title).toBe("Draw it as N⁺–O⁻");

    const fixed = applyIssueFix(mol, fixes[0]!);
    expect(chemistryIssues(fixed)).toEqual([]);
    expect(netCharge(fixed)).toBe(0);
    expect(elementCounts(fixed)).toEqual(elementCounts(mol));
    const charges = fixed.atomIds.map((id) => fixed.atoms[id]!.charge).sort();
    expect(charges).toEqual([-1, 0, 0, 1]);
    // Neither end gained a hydrogen: an O⁻ that did would be a hydroxide.
    for (const id of fixed.atomIds) {
      if (fixed.atoms[id]!.element !== "C") expect(implicitHydrogenCount(fixed, id)).toBe(0);
    }
  });

  it("charge-separates an azide drawn N=N≡N onto its terminal nitrogen", () => {
    const mol = buildMolecule((b) => {
      const c = b.atom("C", vec(0, 0));
      const n1 = b.atom("N", step(vec(0, 0), 30));
      const n2 = b.atom("N", step(step(vec(0, 0), 30), -30));
      const n3 = b.atom("N", step(step(step(vec(0, 0), 30), -30), -30));
      b.bond(c, n1, 1);
      b.bond(n1, n2, 2);
      b.bond(n2, n3, 3);
    });
    const fixes = issueFixes(mol, onlyIssue(mol));
    expect(fixes[0]!.title).toBe("Draw it as N⁺=N⁻");
    const azide = applyIssueFix(mol, fixes[0]!);
    expect(chemistryIssues(azide)).toEqual([]);
    expect(netCharge(azide)).toBe(0);
    expect(elementCounts(azide)).toEqual({ C: 1, H: 3, N: 3 });
  });

  it("offers N⁺ for a quaternary ammonium, and nothing that adds a hydrogen", () => {
    const mol = unchargedTetramethylammonium();
    const fixes = issueFixes(mol, onlyIssue(mol));
    expect(fixes.map((fix) => fix.title)).toEqual(["Make it N⁺"]);
    const fixed = applyIssueFix(mol, fixes[0]!);
    expect(chemistryIssues(fixed)).toEqual([]);
    expect(netCharge(fixed)).toBe(1);
    expect(implicitHydrogenCount(fixed, atomOf(fixed, "N"))).toBe(0);
  });

  it("offers B⁻ for a tetra-coordinate boron", () => {
    const mol = unchargedTetramethylborate();
    const fixes = issueFixes(mol, onlyIssue(mol));
    expect(fixes.map((fix) => fix.title)).toEqual(["Make it B⁻"]);
    expect(chemistryIssues(applyIssueFix(mol, fixes[0]!))).toEqual([]);
  });

  it("offers both readings of a pinned NH3, the charge first", () => {
    const mol = unchargedMethylammonium();
    const fixes = issueFixes(mol, onlyIssue(mol));
    expect(fixes.map((fix) => fix.kind)).toEqual(["set-charge", "derive-hydrogens"]);

    const ammonium = applyIssueFix(mol, fixes[0]!);
    expect(chemistryIssues(ammonium)).toEqual([]);
    expect(elementCounts(ammonium)).toEqual({ C: 1, H: 6, N: 1 });
    expect(netCharge(ammonium)).toBe(1);

    const amine = applyIssueFix(mol, fixes[1]!);
    expect(chemistryIssues(amine)).toEqual([]);
    expect(elementCounts(amine)).toEqual({ C: 1, H: 5, N: 1 });
  });

  it("lowers the one double bond that can give, and gains its hydrogens", () => {
    const mol = overloadedIsobutene();
    const fixes = issueFixes(mol, onlyIssue(mol));
    expect(fixes.map((fix) => fix.title)).toEqual(["Make the C=C bond single"]);
    const neopentane = applyIssueFix(mol, fixes[0]!);
    expect(chemistryIssues(neopentane)).toEqual([]);
    expect(elementCounts(neopentane)).toEqual({ C: 5, H: 12 });
  });

  it("offers nothing when the choice is the author's", () => {
    // Five single bonds on carbon: which one is surplus, nothing can say.
    const five = pentamethylCarbon();
    expect(issueFixes(five, onlyIssue(five))).toEqual([]);

    // Two double bonds that could each give: guessing would move one the
    // author drew on purpose.
    const two = buildMolecule((b) => {
      const c = b.atom("C", vec(0, 0));
      b.bond(c, b.atom("O", step(vec(0, 0), 90)), 2);
      b.bond(c, b.atom("C", step(vec(0, 0), 210)), 2);
      b.bond(c, b.atom("C", step(vec(0, 0), 330)), 1);
    });
    expect(issueFixes(two, onlyIssue(two))).toEqual([]);
  });

  it("removes the radical that tipped a carbon over", () => {
    const mol = buildMolecule((b) => {
      const c = b.atom("C", vec(0, 0), { radicalElectrons: 1 });
      for (const angle of [0, 90, 180, 270]) b.bond(c, b.atom("C", step(vec(0, 0), angle)), 1);
    });
    const fixes = issueFixes(mol, onlyIssue(mol));
    expect(fixes.map((fix) => fix.title)).toEqual(["Remove the unpaired electrons"]);
    expect(chemistryIssues(applyIssueFix(mol, fixes[0]!))).toEqual([]);
  });

  it("removes a wedge that makes no claim", () => {
    const mol = propan2olWedged();
    const fixes = issueFixes(mol, onlyIssue(mol));
    expect(fixes.map((fix) => fix.title)).toEqual(["Remove the wedge"]);
    const fixed = applyIssueFix(mol, fixes[0]!);
    expect(chemistryIssues(fixed)).toEqual([]);
    expect(fixed.bondIds.every((id) => fixed.bonds[id]!.stereo === "none")).toBe(true);
  });

  it("points a backwards wedge at the stereocentre, which then has a letter", () => {
    const mol = butan2olBackwards();
    const issue = onlyIssue(mol);
    const fixes = issueFixes(mol, issue);
    expect(fixes.map((fix) => fix.kind)).toEqual(["reverse-wedge", "remove-wedge"]);
    const fixed = applyIssueFix(mol, fixes[0]!);
    expect(chemistryIssues(fixed)).toEqual([]);
    expect(["R", "S"]).toContain(cipDescriptor(fixed, issue.atomId)?.kind);
  });

  it("unpins a negative hydrogen count", () => {
    const mol = buildMolecule((b) => b.atom("O", vec(0, 0), { explicitHydrogenCount: -1 }));
    const fixes = issueFixes(mol, onlyIssue(mol));
    expect(fixes.map((fix) => fix.kind)).toEqual(["derive-hydrogens"]);
    const water = applyIssueFix(mol, fixes[0]!);
    expect(chemistryIssues(water)).toEqual([]);
    expect(elementCounts(water)).toEqual({ H: 2, O: 1 });
  });

  it("has nothing to fix on a correctly drawn allene", () => {
    const mol = pentaDiene();
    expect(issueFixes(mol, onlyIssue(mol))).toEqual([]);
  });

  it("returns nothing for an issue whose atom is gone", () => {
    const mol = unchargedTetramethylammonium();
    const issue = onlyIssue(mol);
    expect(issueFixes(removeAtom(mol, issue.atomId), issue)).toEqual([]);
  });
});

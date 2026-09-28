import { describe, expect, it } from "vitest";

import { benzene, buildMolecule, singleAtom } from "./builders.js";
import {
  atomsWithUncountableLonePairs,
  drawnLonePairs,
  lonePairCount,
} from "./lewis.js";
import { setLonePairs } from "./ops.js";
import type { Molecule } from "./types.js";
import { outerElectronCount } from "./valence.js";
import { vec } from "./vec.js";

/** Water: a bare oxygen, both hydrogens implicit. */
function water(): Molecule {
  return singleAtom("O");
}

/** Ammonia: a bare nitrogen. */
function ammonia(): Molecule {
  return singleAtom("N");
}

/** Formaldehyde, H2C=O — the carbonyl oxygen is the atom under test. */
function formaldehyde(): { molecule: Molecule; carbon: string; oxygen: string } {
  let carbon = "";
  let oxygen = "";
  const molecule = buildMolecule((b) => {
    carbon = b.atom("C", vec(0, 0));
    oxygen = b.atom("O", vec(1, 0));
    b.bond(carbon, oxygen, 2);
  });
  return { molecule, carbon, oxygen };
}

/**
 * Nitromethane's nitro group, in the charge-separated form that is how the
 * model stores it: N⁺ with one N=O, one N–O⁻ and the methyl.
 */
function nitroGroup(): { molecule: Molecule; nitrogen: string } {
  let nitrogen = "";
  const molecule = buildMolecule((b) => {
    const c = b.atom("C", vec(-1, 0));
    nitrogen = b.atom("N", vec(0, 0), { charge: 1 });
    const o1 = b.atom("O", vec(1, 0.6));
    const o2 = b.atom("O", vec(1, -0.6), { charge: -1 });
    b.bond(c, nitrogen);
    b.bond(nitrogen, o1, 2);
    b.bond(nitrogen, o2);
  });
  return { molecule, nitrogen };
}

/** Dimethyl sulfone, the expanded-octet drawing: two S=O and two S–C. */
function sulfone(): { molecule: Molecule; sulfur: string } {
  let sulfur = "";
  const molecule = buildMolecule((b) => {
    sulfur = b.atom("S", vec(0, 0));
    const o1 = b.atom("O", vec(0, 1));
    const o2 = b.atom("O", vec(0, -1));
    const c1 = b.atom("C", vec(-1, 0));
    const c2 = b.atom("C", vec(1, 0));
    b.bond(sulfur, o1, 2);
    b.bond(sulfur, o2, 2);
    b.bond(sulfur, c1);
    b.bond(sulfur, c2);
  });
  return { molecule, sulfur };
}

describe("outerElectronCount", () => {
  it("reads the group for the first two columns and group - 10 after them", () => {
    expect(outerElectronCount("H")).toBe(1);
    expect(outerElectronCount("C")).toBe(4);
    expect(outerElectronCount("N")).toBe(5);
    expect(outerElectronCount("O")).toBe(6);
    expect(outerElectronCount("S")).toBe(6);
    expect(outerElectronCount("Cl")).toBe(7);
    expect(outerElectronCount("B")).toBe(3);
  });

  it("refuses the elements the arithmetic is nonsense for", () => {
    // Group 3 would read -7 and the f-block, recorded as group 0, would read
    // -10. The guard is the valence list, which every one of them lacks.
    expect(outerElectronCount("Fe")).toBeUndefined();
    expect(outerElectronCount("Pt")).toBeUndefined();
    expect(outerElectronCount("U")).toBeUndefined();
  });

  it("counts the noble gases, helium on its own closed shell", () => {
    // They carry RDKit's `[0]` now, so they reach the arithmetic. Group 18
    // reads 8 for every one of them except helium, whose only shell closes
    // at two.
    expect(outerElectronCount("Ne")).toBe(8);
    expect(outerElectronCount("Xe")).toBe(8);
    expect(outerElectronCount("He")).toBe(2);
  });
});

describe("lonePairCount on the noble gases", () => {
  it("gives a lone helium one pair and a lone neon four", () => {
    const he = singleAtom("He");
    expect(lonePairCount(he, he.atomIds[0]!)).toEqual({ kind: "counted", pairs: 1, unpaired: 0 });
    const ne = singleAtom("Ne");
    expect(lonePairCount(ne, ne.atomIds[0]!)).toEqual({ kind: "counted", pairs: 4, unpaired: 0 });
  });

  it("leaves xenon difluoride's xenon three pairs", () => {
    // XeF2 is linear because of those three equatorial pairs, which is the
    // textbook reason to draw them at all.
    let xenon = "";
    const xef2 = buildMolecule((b) => {
      xenon = b.atom("Xe", vec(0, 0));
      b.bond(xenon, b.atom("F", vec(-1, 0)));
      b.bond(xenon, b.atom("F", vec(1, 0)));
    });
    expect(lonePairCount(xef2, xenon)).toEqual({ kind: "counted", pairs: 3, unpaired: 0 });
  });
});

describe("lonePairCount", () => {
  it("gives water two pairs and ammonia one", () => {
    const w = water();
    expect(lonePairCount(w, w.atomIds[0]!)).toEqual({
      kind: "counted",
      pairs: 2,
      unpaired: 0,
    });
    const a = ammonia();
    expect(lonePairCount(a, a.atomIds[0]!)).toEqual({
      kind: "counted",
      pairs: 1,
      unpaired: 0,
    });
  });

  it("gives a carbonyl oxygen two pairs and its carbon none", () => {
    const { molecule, carbon, oxygen } = formaldehyde();
    // 6 outer − 0 charge − 2 bonding = 4 spare electrons.
    expect(drawnLonePairs(molecule, oxygen)).toBe(2);
    // Carbon spends all four: two on the double bond, two on hydrogens.
    expect(drawnLonePairs(molecule, carbon)).toBe(0);
  });

  it("gives a nitro nitrogen none, because the cation has spent them all", () => {
    // 5 outer − 1 charge − 4 bonds = 0. The pair that would have been there is
    // exactly what the positive formal charge records the loss of.
    const { molecule, nitrogen } = nitroGroup();
    expect(drawnLonePairs(molecule, nitrogen)).toBe(0);
  });

  it("gives a sulfone sulfur none under the expanded-octet reading", () => {
    // 6 outer − 0 charge − 6 bonding = 0. That is the drawing the model holds:
    // sulfur's valence list is [2, 4, 6] and a sulfone is two S=O plus two
    // S–C. The charge-separated reading is a DIFFERENT drawing, and a chemist
    // who wants it pins it — see the override test below.
    const { molecule, sulfur } = sulfone();
    expect(drawnLonePairs(molecule, sulfur)).toBe(0);
  });

  it("gives ammonium none, a carbanion one and a sulfoxide sulfur one", () => {
    // The three cases stereo-config's phantom lone-pair ligand turns on. A
    // quaternary N+ has spent its pair on the fourth bond, so it is an
    // ordinary four-ligand centre, never a lone-pair one.
    const ammonium = buildMolecule((b) => {
      b.atom("N", vec(0, 0), { charge: 1 });
    });
    // 5 − 1 − 4 implicit H = 0.
    expect(lonePairCount(ammonium, ammonium.atomIds[0]!)).toEqual({
      kind: "counted",
      pairs: 0,
      unpaired: 0,
    });

    const methanide = buildMolecule((b) => {
      b.atom("C", vec(0, 0), { charge: -1 });
    });
    // 4 − (−1) − 3 implicit H = 2 → 1 pair.
    expect(lonePairCount(methanide, methanide.atomIds[0]!)).toEqual({
      kind: "counted",
      pairs: 1,
      unpaired: 0,
    });

    // Dimethyl sulfoxide: one S=O and two S–C, 6 − 0 − 4 = 2 → 1 pair.
    let sulfur = "";
    const dmso = buildMolecule((b) => {
      sulfur = b.atom("S", vec(0, 0));
      b.bond(sulfur, b.atom("O", vec(0, 1)), 2);
      b.bond(sulfur, b.atom("C", vec(-1, 0)));
      b.bond(sulfur, b.atom("C", vec(1, 0)));
    });
    expect(lonePairCount(dmso, sulfur)).toEqual({ kind: "counted", pairs: 1, unpaired: 0 });
  });

  it("counts an anion's extra pair and a cation's missing one", () => {
    const hydroxide = buildMolecule((b) => {
      b.atom("O", vec(0, 0), { charge: -1 });
    });
    // 6 − (−1) − 1 implicit H = 6 → 3 pairs.
    expect(drawnLonePairs(hydroxide, hydroxide.atomIds[0]!)).toBe(3);

    // THE BACKLOG'S OWN ACCEPTANCE LINE SAID HYDRONIUM HAS ZERO, and it is
    // wrong: 6 outer − 1 charge − 3 bonds leaves two electrons, which is one
    // pair. That is why the pair count is a chem-core test and not a
    // rendering one.
    const hydronium = buildMolecule((b) => {
      b.atom("O", vec(0, 0), { charge: 1 });
    });
    expect(drawnLonePairs(hydronium, hydronium.atomIds[0]!)).toBe(1);
  });

  it("reports a radical's unpaired electron beside its pairs", () => {
    // A methyl radical: three implicit hydrogens and one unpaired electron,
    // which together spend all four of carbon's outer electrons.
    const methyl = buildMolecule((b) => {
      b.atom("C", vec(0, 0), { radicalElectrons: 1 });
    });
    expect(lonePairCount(methyl, methyl.atomIds[0]!)).toEqual({
      kind: "counted",
      pairs: 0,
      unpaired: 1,
    });
  });

  it("says why rather than answering zero", () => {
    const iron = singleAtom("Fe");
    expect(lonePairCount(iron, iron.atomIds[0]!)).toEqual({
      kind: "unknown",
      reason: "no-valence-data",
    });
    expect(atomsWithUncountableLonePairs(iron)).toEqual([iron.atomIds[0]]);

    // Five bonds on a carbon: more electrons committed than the atom has.
    // `valenceIssues` already reports the over-valence; a quiet 0 here would
    // draw an ordinary Lewis structure over a structure that cannot exist.
    // (Five bonds on a NITROGEN lands on exactly 0, which is a real answer —
    // over-subscribed means the arithmetic went negative, not that the atom
    // is over-valent.)
    const overValent = buildMolecule((b) => {
      const c = b.atom("C", vec(0, 0));
      for (let i = 0; i < 5; i++) b.bond(c, b.atom("Cl", vec(i + 1, 0)));
    });
    expect(lonePairCount(overValent, overValent.atomIds[0]!)).toEqual({
      kind: "unknown",
      reason: "over-subscribed",
    });
  });

  it("honours the per-atom override, which is what decision 4 added it for", () => {
    // The charge-separated sulfone: the same connectivity, read as S²⁺ with
    // two lone pairs. No valence rule can choose between the two readings, so
    // the pin carries it.
    const { molecule, sulfur } = sulfone();
    const pinned = setLonePairs(molecule, sulfur, 2);
    expect(lonePairCount(pinned, sulfur)).toEqual({ kind: "pinned", pairs: 2 });
    // And nothing else moved: the pin is display bookkeeping, not chemistry.
    expect(pinned.atoms[sulfur]!.charge).toBe(0);

    // `undefined` hands it back to the derivation.
    expect(lonePairCount(setLonePairs(pinned, sulfur, undefined), sulfur)).toEqual({
      kind: "counted",
      pairs: 0,
      unpaired: 0,
    });
  });

  it("gives every benzene carbon none, so an arene draws no dots", () => {
    const mol = benzene();
    for (const atomId of mol.atomIds) {
      expect(drawnLonePairs(mol, atomId)).toBe(0);
    }
    expect(atomsWithUncountableLonePairs(mol)).toEqual([]);
  });
});

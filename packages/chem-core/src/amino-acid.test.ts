/**
 * Alpha-amino acids: numbering and D/L, on the twenty proteinogenic amino
 * acids of the structure dictionary (each row checked against RDKit by the
 * build script) and the projection fixtures.
 *
 * D/L is a separate entry point from the sugars' (decision 132): read at the
 * alpha carbon, never at the highest-numbered centre, and never from R/S.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { alphaAminoAcids, aminoAcidSeries, type AlphaAminoAcid } from "./amino-acid.js";
import { buildMolecule } from "./builders.js";
import { chainCarbonVisitCount } from "./carbon-chain.js";
import { dictionaryEntryById } from "./dictionary.js";
import { fischerSide } from "./fischer-side.js";
import { addAtom, addBond, bondsAt, otherEnd } from "./molecule.js";
import { readMolblock } from "./molblock-read.js";
import { atomNumbering } from "./numbering.js";
import { invertStereocentre } from "./ops.js";
import { cipDescriptor } from "./stereo.js";
import { rotateAtoms } from "./transform.js";
import type { AtomId, Molecule } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function dictionary(id: string): Molecule {
  const entry = dictionaryEntryById(id);
  if (entry === undefined) throw new Error(`no dictionary entry ${id}`);
  return readMolblock(entry.molblock).molecule;
}

function only(mol: Molecule): AlphaAminoAcid {
  const units = alphaAminoAcids(mol);
  expect(units).toHaveLength(1);
  return units[0]!;
}

function elementNeighbours(mol: Molecule, atomId: AtomId): string[] {
  return bondsAt(mol, atomId)
    .map((bond) => mol.atoms[otherEnd(bond, atomId)]!.element)
    .sort();
}

const PROTEINOGENIC = [
  "l-alanine",
  "l-arginine",
  "l-asparagine",
  "l-aspartic-acid",
  "l-cysteine",
  "l-glutamic-acid",
  "l-glutamine",
  "l-histidine",
  "l-isoleucine",
  "l-leucine",
  "l-lysine",
  "l-methionine",
  "l-phenylalanine",
  "l-proline",
  "l-serine",
  "l-threonine",
  "l-tryptophan",
  "l-tyrosine",
  "l-valine",
] as const;

describe("amino-acid D/L", () => {
  for (const id of PROTEINOGENIC) {
    it(`reads ${id} as L, and its enantiomer as D`, () => {
      const mol = dictionary(id);
      const unit = only(mol);
      // The alpha carbon resolves first, so an L here is not "undetermined
      // read as something".
      expect(["R", "S"]).toContain(cipDescriptor(mol, unit.alphaCarbon)?.kind);
      expect(aminoAcidSeries(mol, unit)).toEqual({ kind: "L", atomId: unit.alphaCarbon });
      const mirror = invertStereocentre(mol, unit.alphaCarbon);
      expect(aminoAcidSeries(mirror, only(mirror))).toEqual({ kind: "D", atomId: unit.alphaCarbon });
    });
  }

  it("refuses glycine as achiral rather than calling it D or L", () => {
    const mol = dictionary("glycine");
    const unit = only(mol);
    expect(cipDescriptor(mol, unit.alphaCarbon)).toBeUndefined();
    expect(aminoAcidSeries(mol, unit)).toEqual({ kind: "notApplicable", reason: "achiral-alpha-carbon" });
  });

  it("gives L-cysteine L although it is (R), and L-alanine L as (S)", () => {
    // "S means L" passes nineteen amino acids and fails this one: sulfur
    // outranks the carboxyl carbon, so the same spatial arrangement is R.
    const cysteine = dictionary("l-cysteine");
    const cys = only(cysteine);
    expect(cipDescriptor(cysteine, cys.alphaCarbon)).toEqual({ kind: "R" });
    expect(aminoAcidSeries(cysteine, cys).kind).toBe("L");
    const alanine = dictionary("l-alanine");
    const ala = only(alanine);
    expect(cipDescriptor(alanine, ala.alphaCarbon)).toEqual({ kind: "S" });
    expect(aminoAcidSeries(alanine, ala).kind).toBe("L");
  });

  it("reads threonine and isoleucine at the alpha carbon, not at their second centre", () => {
    for (const id of ["l-threonine", "l-isoleucine"]) {
      const mol = dictionary(id);
      const unit = only(mol);
      const [, c2, c3, c4] = unit.backbone;
      expect(c2).toBe(unit.alphaCarbon);
      expect(["R", "S"]).toContain(cipDescriptor(mol, c3!)?.kind);
      expect(aminoAcidSeries(mol, unit)).toEqual({ kind: "L", atomId: c2 });
      if (id === "l-threonine") {
        // Read the sugar way, at the highest-numbered centre with its
        // hydroxyl on the side arm, L-threonine would be called D: the C3
        // hydroxyl sits on the right. That is the trap a shared code path
        // with the sugars would fall into.
        const o3 = bondsAt(mol, c3!).map((b) => otherEnd(b, c3!)).find((o) => mol.atoms[o]!.element === "O")!;
        expect(fischerSide(mol, c3!, { up: c2!, down: c4!, side: o3 }).kind).toBe("right");
      }
    }
  });

  it("does not depend on how the drawing is turned on the page", () => {
    const mol = dictionary("l-cysteine");
    for (const degrees of [90, 180, 45]) {
      const turned = rotateAtoms(mol, mol.atomIds, { x: 0, y: 0 }, (degrees * Math.PI) / 180);
      expect(aminoAcidSeries(turned, only(turned)).kind, `${degrees}°`).toBe("L");
    }
  });

  it("never consults R/S", () => {
    // Structural, not behavioural: the module cannot reach the descriptor code.
    for (const file of ["amino-acid.ts", "fischer-side.ts", "sugar.ts"]) {
      const source = readFileSync(join(HERE, file), "utf8");
      expect(source, file).not.toMatch(/from "\.\/stereo\.js"/);
      const imports = source.match(/^import[^;]*;/gm) ?? [];
      expect(imports.join("\n"), file).not.toMatch(/cipDescriptor|descriptorFromConfig|rankStereoCentre/);
    }
  });
});

describe("amino-acid numbering", () => {
  it("numbers the carboxyl carbon C1 and the alpha carbon C2", () => {
    for (const id of [...PROTEINOGENIC, "glycine"]) {
      const mol = dictionary(id);
      const unit = only(mol);
      expect(unit.backbone[0], id).toBe(unit.carboxylCarbon);
      expect(unit.backbone[1], id).toBe(unit.alphaCarbon);
      expect(elementNeighbours(mol, unit.carboxylCarbon), id).toEqual(["C", "O", "O"]);
      expect(elementNeighbours(mol, unit.nitrogen).includes("C"), id).toBe(true);
    }
  });

  it("takes isoleucine's parent chain through the ethyl branch, leaving the methyl unnumbered", () => {
    const mol = dictionary("l-isoleucine");
    const unit = only(mol);
    expect(unit.backbone).toHaveLength(5);
    const [, , c3, c4, c5] = unit.backbone;
    // C4 is the ethyl's CH2 and C5 its CH3; C3's methyl is a substituent.
    expect(elementNeighbours(mol, c4!)).toEqual(["C", "C"]);
    expect(elementNeighbours(mol, c5!)).toEqual(["C"]);
    const methyl = bondsAt(mol, c3!)
      .map((b) => otherEnd(b, c3!))
      .find((id) => !unit.backbone.includes(id))!;
    expect(elementNeighbours(mol, methyl)).toEqual(["C"]);
    expect(unit.tiedAt).toBeUndefined();
  });

  it("runs threonine C1 to C4 through its methyl, not its oxygen", () => {
    const mol = dictionary("l-threonine");
    const unit = only(mol);
    expect(unit.backbone.map((id) => mol.atoms[id]!.element)).toEqual(["C", "C", "C", "C"]);
    expect(elementNeighbours(mol, unit.backbone[2]!)).toEqual(["C", "C", "O"]);
    expect(elementNeighbours(mol, unit.backbone[3]!)).toEqual(["C"]);
  });

  it("stops before two branches that tie, rather than choosing a methyl by id", () => {
    const valine = only(dictionary("l-valine"));
    expect(valine.backbone).toHaveLength(3);
    expect(valine.tiedAt).toBe(valine.backbone[2]);
    const leucine = only(dictionary("l-leucine"));
    expect(leucine.backbone).toHaveLength(4);
    expect(leucine.tiedAt).toBe(leucine.backbone[3]);
  });

  it("ends the chain at a ring", () => {
    expect(only(dictionary("l-phenylalanine")).backbone).toHaveLength(3);
    const proline = dictionary("l-proline");
    expect(only(proline).backbone).toHaveLength(2);
    // The chain ends, the side chain does not: proline's D/L still reads.
    expect(aminoAcidSeries(proline, only(proline)).kind).toBe("L");
  });

  it("numbers nothing where two alpha carbons share a skeleton, and still reads their D/L", () => {
    // 2,6-Diaminopimelic acid, drawn from L-lysine by putting a carboxyl on
    // its epsilon carbon: two alpha carbons, two carboxyls, one chain. Either
    // carboxyl could be C1 (decision 156), so neither numbering is drawn, but
    // lysine's own alpha carbon is still L.
    const lysine = dictionary("l-lysine");
    const unit = only(lysine);
    const c6 = unit.backbone[5]!;
    const at = lysine.atoms[c6]!.pos;
    const carboxyl = addAtom(lysine, { element: "C", pos: { x: at.x + 1, y: at.y } });
    let dap = addBond(carboxyl.molecule, { from: c6, to: carboxyl.id }).molecule;
    const oxo = addAtom(dap, { element: "O", pos: { x: at.x + 1.5, y: at.y + 0.87 } });
    dap = addBond(oxo.molecule, { from: carboxyl.id, to: oxo.id, order: 2 }).molecule;
    const hydroxy = addAtom(dap, { element: "O", pos: { x: at.x + 1.5, y: at.y - 0.87 } });
    dap = addBond(hydroxy.molecule, { from: carboxyl.id, to: hydroxy.id }).molecule;

    const units = alphaAminoAcids(dap);
    expect(new Set(units.map((u) => u.alphaCarbon))).toEqual(new Set([unit.alphaCarbon, c6]));
    expect(units.map((u) => u.backbone)).toEqual([[], []]);
    expect(Object.values(atomNumbering(dap).sources)).not.toContain("aminoAcid");
    const lysineAlpha = units.find((u) => u.alphaCarbon === unit.alphaCarbon)!;
    expect(["R", "S"]).toContain(cipDescriptor(dap, unit.alphaCarbon)?.kind);
    expect(aminoAcidSeries(dap, lysineAlpha)).toEqual({ kind: "L", atomId: unit.alphaCarbon });
  });

  it("walks a long backbone of alpha carbons once, not once per alpha carbon", () => {
    // -CH2-CH(NH2)(COOH)- repeated 1500 times on one carbon chain.
    const n = 3000;
    const polymer = buildMolecule((b) => {
      let previous: string | undefined;
      for (let i = 0; i < n; i++) {
        const c = b.atom("C", { x: i, y: 0 });
        if (previous !== undefined) b.bond(previous, c);
        if (i % 2 === 1) {
          b.bond(c, b.atom("N", { x: i, y: 1 }));
          const acid = b.atom("C", { x: i, y: -1 });
          b.bond(c, acid);
          b.bond(acid, b.atom("O", { x: i + 0.5, y: -2 }), 2);
          b.bond(acid, b.atom("O", { x: i - 0.5, y: -2 }));
        }
        previous = c;
      }
    });
    const visits = chainCarbonVisitCount();
    const units = alphaAminoAcids(polymer);
    expect(units).toHaveLength(n / 2);
    expect(units.every((u) => u.backbone.length === 0)).toBe(true);
    // Every chain carbon (the backbone and its carboxyls) at most twice.
    expect(chainCarbonVisitCount() - visits).toBeLessThanOrEqual(2 * (n + n / 2));
  });

  it("finds the fixtures' amino acids too", () => {
    const fixtures = join(HERE, "..", "test", "fixtures", "projection");
    for (const [file, letter] of [
      ["l-alanine.mol", "S"],
      ["l-cysteine.mol", "R"],
      ["l-isoleucine.mol", "S"],
    ] as const) {
      const mol = readMolblock(readFileSync(join(fixtures, file), "utf8")).molecule;
      const unit = only(mol);
      expect(cipDescriptor(mol, unit.alphaCarbon), file).toEqual({ kind: letter });
      expect(aminoAcidSeries(mol, unit).kind, file).toBe("L");
    }
  });
});

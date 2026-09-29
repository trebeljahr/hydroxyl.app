/**
 * The molecule-level locant map: explicit first, then the chain and ring
 * rules, and only numbers every allowed numbering agrees on (decision 142).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { assembleMolecule } from "./builders.js";
import { dictionaryEntryById } from "./dictionary.js";
import { insertFragment } from "./fragment.js";
import { makeAtom } from "./molecule.js";
import { readMolblock } from "./molblock-read.js";
import { atomNumbering, locantOf } from "./numbering.js";
import { removeAtoms } from "./ops.js";
import { carbohydrates } from "./sugar.js";
import type { Molecule } from "./types.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures");

function fixture(dir: string, file: string): Molecule {
  return readMolblock(readFileSync(join(FIXTURES, dir, file), "utf8")).molecule;
}

function dictionary(id: string): Molecule {
  return readMolblock(dictionaryEntryById(id)!.molblock).molecule;
}

describe("atomNumbering", () => {
  it("numbers a sugar's carbons and nothing else", () => {
    const mol = fixture("projection", "beta-d-glucopyranose.mol");
    const { locants, sources } = atomNumbering(mol);
    const numbered = Object.keys(locants);
    expect(numbered).toHaveLength(6);
    expect(numbered.every((id) => mol.atoms[id]!.element === "C")).toBe(true);
    expect(Object.values(locants).sort()).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(new Set(Object.values(sources))).toEqual(new Set(["carbohydrate"]));
  });

  it("numbers a sugar and an amino acid in one drawing, each its own way", () => {
    const glucose = fixture("projection", "d-glucose-open.mol");
    const both = insertFragment(glucose, dictionary("l-cysteine"), { offset: { x: 10, y: 0 } });
    const { locants, sources } = atomNumbering(both.molecule);
    const cysteine = both.atomIds.filter((id) => Object.hasOwn(locants, id));
    expect(cysteine.map((id) => locants[id]).sort()).toEqual(["1", "2", "3"]);
    expect(cysteine.every((id) => sources[id] === "aminoAcid")).toBe(true);
    expect(Object.keys(locants).filter((id) => sources[id] === "carbohydrate")).toHaveLength(6);
  });

  it("lets an explicit locant win, and an explicit empty string hide a derived one", () => {
    const mol = fixture("projection", "d-glucose-open.mol");
    const [unit] = carbohydrates(mol);
    const [c1, c2, c3] = unit!.backbone;
    const numbering = atomNumbering(mol, { [c1!]: "1a", [c2!]: "" });
    expect(locantOf(numbering, c1!)).toBe("1a");
    expect(numbering.sources[c1!]).toBe("explicit");
    expect(locantOf(numbering, c2!)).toBeUndefined();
    expect(locantOf(numbering, c3!)).toBe("3");
    // An explicit locant can name an atom no rule numbers.
    const oxygen = mol.atomIds.find((id) => mol.atoms[id]!.element === "O")!;
    expect(locantOf(atomNumbering(mol, { [oxygen]: "O-1" }), oxygen)).toBe("O-1");
  });

  it("ignores explicit locants for atoms the molecule does not have", () => {
    const mol = fixture("projection", "d-glucose-open.mol");
    const numbering = atomNumbering(mol, { a999: "9" });
    expect(locantOf(numbering, "a999")).toBeUndefined();
  });

  it("never resolves an atom id up the prototype chain", () => {
    // An atom whose id is "constructor", which no rule numbers, and a lookup
    // of "toString", which is no atom at all.
    const mol = assembleMolecule({
      atoms: {
        constructor: makeAtom("constructor", { element: "C" }),
        a2: makeAtom("a2", { element: "O" }),
      },
      bonds: {},
      atomIds: ["constructor", "a2"],
      bondIds: [],
      nextId: 3,
      stereoGroups: undefined,
      speciesJoins: undefined,
    });
    const numbering = atomNumbering(mol);
    expect(locantOf(numbering, "constructor")).toBeUndefined();
    expect(locantOf(numbering, "toString")).toBeUndefined();
    expect(numbering.locants["constructor"]).toBeUndefined();
    const explicit = JSON.parse('{"constructor":"7","__proto__":"8"}') as Record<string, string>;
    expect(locantOf(atomNumbering(mol, explicit), "constructor")).toBe("7");
    expect(locantOf(atomNumbering(mol, {}), "constructor")).toBeUndefined();
  });

  it("forgets a deleted atom's locant and renumbers nothing else", () => {
    const mol = fixture("projection", "beta-d-glucopyranose.mol");
    const before = atomNumbering(mol);
    const [unit] = carbohydrates(mol);
    // Delete C6's oxygen: C6 is still a carbon of the chain.
    const c6 = unit!.backbone[5]!;
    const o6 = mol.atomIds.find(
      (id) => mol.atoms[id]!.element === "O" && Object.values(mol.bonds).some((b) => (b.from === id && b.to === c6) || (b.to === id && b.from === c6)),
    )!;
    const after = atomNumbering(removeAtoms(mol, [o6]));
    for (const id of Object.keys(before.locants)) expect(locantOf(after, id), id).toBe(locantOf(before, id));
  });
});

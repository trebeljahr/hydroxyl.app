/**
 * The steroid skeleton (decisions 163, 165, 181, 182), on real steroids.
 *
 * THE FIXTURES in test/fixtures/steroid are PubChem SMILES drawn by RDKit;
 * every letter below equals RDKit's `get_stereo_tags` for that SMILES and the
 * PubChem IUPAC name (manifest.json), and is asserted BEFORE any face is read,
 * so a face that silently went undetermined cannot pass.
 *
 * THE LOCANT MAPS were read off each SMILES by hand once, atom by atom, and
 * are pinned as literals: a1 is the SMILES's first atom. They are what keeps
 * the embedding honest, since a steroid numbered by a perimeter walk looks
 * plausible and is wrong.
 *
 * THE FACES are the textbook ones: 5α-H or 5β-H, 8β-H, 9α-H, 14α-H, the two
 * angular methyls β, 3β-OH, 17β-OH, cortisol's 11β-OH and 17α-OH.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { bondBetween } from "../molecule.js";
import { readMolblock } from "../molblock-read.js";
import { setAtomPosition } from "../ops.js";
import { carbohydrates, anomericConfiguration } from "../sugar.js";
import { descriptorFromConfig, stereoConfig, type StereoConfig } from "../stereo-config.js";
import { flipAtoms, rotateAtoms, verticalMirror } from "../transform.js";
import type { AtomId, Molecule } from "../types.js";
import { STEROID_SKELETON, steroidFaces, steroidNumbering, suggestSteroidSkeleton } from "./steroid.js";
import {
  acceptedSkeletonMisfit,
  SKELETON_SEARCH_BUDGET,
  SkeletonSearchLimit,
  skeletonEmbeddings,
  standardOrientation,
  type LigandFace,
} from "./table.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures", "steroid");

function load(file: string): Molecule {
  return readMolblock(readFileSync(join(FIXTURES, file), "utf8")).molecule;
}

function letters(mol: Molecule, config: StereoConfig): Record<AtomId, string> {
  const out: Record<AtomId, string> = {};
  for (const centre of config.centres) {
    const d = descriptorFromConfig(mol, centre, config);
    out[centre.atomId] = d === undefined ? "none" : d.kind === "undetermined" ? `undetermined:${d.reason}` : d.kind;
  }
  return out;
}

/** RDKit's letters for each fixture's SMILES, atom a<i+1> for RDKit atom i. */
const LETTERS: Readonly<Record<string, Readonly<Record<AtomId, string>>>> = {
  "cholesterol.mol": { a2: "R", a9: "R", a12: "S", a13: "R", a16: "S", a17: "S", a21: "R", a24: "S" },
  "testosterone.mol": { a2: "S", a5: "S", a6: "R", a7: "S", a10: "S", a20: "R" },
  "estradiol.mol": { a2: "S", a5: "S", a6: "R", a7: "S", a10: "S" },
  "5alpha-cholestane.mol": { a2: "R", a9: "R", a12: "S", a13: "R", a16: "S", a17: "R", a20: "R", a21: "S" },
  "5beta-cholestane.mol": { a2: "R", a9: "R", a12: "S", a13: "R", a16: "S", a17: "R", a20: "S", a21: "S" },
  "ent-kaurene.mol": { a2: "R", a7: "R", a10: "S", a11: "R", a14: "R" },
  "cholesteryl-alpha-d-glucopyranoside.mol": {
    a2: "R", a9: "R", a12: "S", a13: "R", a16: "S", a17: "S", a21: "R", a24: "S",
    a27: "S", a28: "R", a29: "S", a30: "S", a31: "R",
  },
  "cholecalciferol.mol": { a2: "R", a9: "R", a12: "S", a13: "R", a22: "S" },
  "abiraterone.mol": { a2: "R", a5: "S", a10: "R", a11: "S", a14: "S", a15: "S" },
  "methyltestosterone.mol": { a2: "R", a11: "R", a12: "S", a15: "S", a16: "S", a19: "S" },
  "cortisol.mol": { a2: "R", a11: "S", a12: "S", a13: "S", a15: "S", a16: "S", a19: "R" },
};

/** Locants 1-17 as SMILES atom numbers, read off each SMILES by hand. */
const CORES: Readonly<Record<string, readonly number[]>> = {
  "cholesterol.mol": [22, 23, 24, 25, 20, 19, 18, 17, 16, 21, 15, 14, 13, 12, 11, 10, 9],
  "5alpha-cholestane.mol": [22, 23, 24, 25, 20, 19, 18, 17, 16, 21, 15, 14, 13, 12, 11, 10, 9],
  "5beta-cholestane.mol": [22, 23, 24, 25, 20, 19, 18, 17, 16, 21, 15, 14, 13, 12, 11, 10, 9],
  "cholesteryl-alpha-d-glucopyranoside.mol": [22, 23, 24, 25, 20, 19, 18, 17, 16, 21, 15, 14, 13, 12, 11, 10, 9],
  "testosterone.mol": [19, 18, 16, 15, 14, 13, 12, 6, 5, 20, 4, 3, 2, 7, 8, 9, 10],
  "estradiol.mol": [16, 17, 18, 19, 14, 13, 12, 6, 5, 15, 4, 3, 2, 7, 8, 9, 10],
  "methyltestosterone.mol": [3, 4, 5, 7, 8, 9, 10, 11, 12, 2, 13, 14, 15, 16, 17, 18, 19],
  "abiraterone.mol": [3, 4, 5, 6, 7, 8, 9, 10, 11, 2, 12, 13, 14, 15, 16, 17, 18],
  "cortisol.mol": [3, 4, 5, 7, 8, 9, 10, 11, 12, 2, 13, 14, 15, 16, 17, 18, 19],
};

const ids = (numbers: readonly number[]): AtomId[] => numbers.map((n) => `a${n}`);

function coreOf(mol: Molecule): readonly AtomId[] {
  const suggestion = suggestSteroidSkeleton(mol);
  if (suggestion.kind !== "match") throw new Error(`no match: ${JSON.stringify(suggestion)}`);
  return suggestion.skeleton.core;
}

/** "3β-OH"-style keys, for readable pins: locant, face, and the ligand's atom or H. */
function faceTable(mol: Molecule, faces: readonly LigandFace[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of faces) {
    const ligand = f.ligand.kind === "implicitHydrogen" ? "H" : `${mol.atoms[f.ligand.atomId]!.element}:${f.ligand.atomId}`;
    out[`${f.locant}/${ligand}`] = f.face;
  }
  return out;
}

describe("the steroid fixtures, before anything is recognised", () => {
  it("has eleven molecules and every stereocentre reads RDKit's letter", () => {
    const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".mol")).sort();
    expect(files).toEqual(Object.keys(LETTERS).sort());
    for (const file of files) {
      const mol = load(file);
      expect(letters(mol, stereoConfig(mol)), file).toEqual(LETTERS[file]);
    }
  });
});

describe("the standard orientation", () => {
  it("builds rings A to D left to right, C ring above B, ring A's C1 on top", () => {
    const p = standardOrientation(STEROID_SKELETON);
    const centroid = (locants: readonly number[]) => ({
      x: locants.reduce((s, l) => s + p[l - 1]!.x, 0) / locants.length,
      y: locants.reduce((s, l) => s + p[l - 1]!.y, 0) / locants.length,
    });
    const a = centroid([1, 2, 3, 4, 5, 10]);
    const b = centroid([5, 6, 7, 8, 9, 10]);
    const c = centroid([8, 9, 11, 12, 13, 14]);
    const d = centroid([13, 14, 15, 16, 17]);
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
    expect(c.x).toBeLessThan(d.x);
    expect(c.y).toBeGreaterThan(b.y);
    // C1 at the top of ring A, C10 and C5 its shared right-hand edge.
    expect(p[0]!.y).toBeGreaterThan(Math.max(...[1, 2, 3, 4, 9].map((i) => p[i]!.y)));
    expect(p[9]!.x).toBeCloseTo(p[4]!.x, 12);
    // Every core bond is one unit long: regular polygons, computed.
    for (const [i, j] of STEROID_SKELETON.bonds) {
      expect(Math.hypot(p[i]!.x - p[j]!.x, p[i]!.y - p[j]!.y)).toBeCloseTo(1, 12);
    }
  });
});

describe("recognition (decision 181)", () => {
  for (const [file, numbers] of Object.entries(CORES)) {
    it(`${file}: suggests the core with locants 1-17 on the right atoms`, () => {
      const mol = load(file);
      const suggestion = suggestSteroidSkeleton(mol);
      expect(suggestion.kind).toBe("match");
      if (suggestion.kind !== "match") return;
      expect(suggestion.skeleton).toEqual({ name: "steroid", core: ids(numbers) });
      expect(acceptedSkeletonMisfit(mol, STEROID_SKELETON, suggestion.skeleton)).toBeUndefined();
    });
  }

  it("refuses ent-kaurene's 6-6-6-5 rings, whose C/D fusion is bridged, rather than numbering them", () => {
    const suggestion = suggestSteroidSkeleton(load("ent-kaurene.mol"));
    expect(suggestion).toMatchObject({ kind: "refused", reason: "wrong-fusion-topology" });
    if (suggestion.kind === "refused") expect(suggestion.atomIds).toHaveLength(16);
  });

  it("names cholecalciferol a partial core, 9,10-seco", () => {
    const suggestion = suggestSteroidSkeleton(load("cholecalciferol.mol"));
    expect(suggestion).toMatchObject({ kind: "refused", reason: "partial-core", missingBond: ["9", "10"] });
    if (suggestion.kind === "refused") expect(suggestion.atomIds).toHaveLength(17);
  });

  it("says nothing about a molecule with no steroid in it", () => {
    const glucoside = load("cholesteryl-alpha-d-glucopyranoside.mol");
    expect(suggestSteroidSkeleton(glucoside).kind).toBe("match");
    const sugarOnly = readMolblock(
      readFileSync(join(FIXTURES, "..", "projection", "alpha-d-glucopyranose.mol"), "utf8"),
    ).molecule;
    expect(suggestSteroidSkeleton(sugarOnly)).toEqual({ kind: "none" });
  });

  it("stops at its search budget and says so, instead of answering", () => {
    const mol = load("cholesterol.mol");
    expect(() => skeletonEmbeddings(mol, STEROID_SKELETON, undefined, { nodes: 10 })).toThrow(SkeletonSearchLimit);
    // With the real budget there is exactly one embedding: the core has no symmetry.
    expect(skeletonEmbeddings(mol, STEROID_SKELETON, undefined, { nodes: SKELETON_SEARCH_BUDGET })).toHaveLength(1);
  });

  it("names every atom of a stale acceptance: one deleted, one core bond broken", () => {
    const mol = load("testosterone.mol");
    const accepted = { name: "steroid" as const, core: coreOf(mol) };
    expect(acceptedSkeletonMisfit(mol, STEROID_SKELETON, { ...accepted, core: [...accepted.core.slice(0, 16), "a999"] })).toEqual(["a999"]);
    expect(acceptedSkeletonMisfit(mol, STEROID_SKELETON, { ...accepted, core: [...accepted.core.slice(0, 16), "constructor"] })).toEqual(["constructor"]);
    // Locants 13 and 14 exchanged: C13-C17 is then a missing core bond.
    const swapped = [...accepted.core];
    [swapped[12], swapped[13]] = [swapped[13]!, swapped[12]!];
    expect(acceptedSkeletonMisfit(mol, STEROID_SKELETON, { ...accepted, core: swapped })).not.toBeUndefined();
  });
});

describe("numbering (decision 181)", () => {
  it("numbers cholesterol's core, C-18 on C-13, C-19 on C-10, and the cholestane side chain, 26 and 27 left blank", () => {
    const mol = load("cholesterol.mol");
    const locants = steroidNumbering(mol, coreOf(mol));
    const expected: Record<AtomId, string> = {};
    ids(CORES["cholesterol.mol"]!).forEach((id, i) => (expected[id] = String(i + 1)));
    Object.assign(expected, { a28: "18", a27: "19", a2: "20", a1: "21", a3: "22", a4: "23", a5: "24", a6: "25" });
    expect(Object.fromEntries(locants)).toEqual(expected);
    // C-18 is the methyl on C-13, C-19 the methyl on C-10.
    expect(bondBetween(mol, "a28", "a13")).toBeDefined();
    expect(bondBetween(mol, "a27", "a21")).toBeDefined();
    // Ring D reads 13-14-15-16-17: C17 bonded to C13, C15 to C14.
    const byLocant = new Map([...locants].map(([atom, locant]) => [locant, atom]));
    for (const [p, q] of [["13", "14"], ["14", "15"], ["15", "16"], ["16", "17"], ["17", "13"]] as const) {
      expect(bondBetween(mol, byLocant.get(p)!, byLocant.get(q)!), `${p}-${q}`).toBeDefined();
    }
    expect(bondBetween(mol, byLocant.get("17")!, byLocant.get("20")!)).toBeDefined();
    expect(locants.has("a7")).toBe(false);
    expect(locants.has("a8")).toBe(false);
  });

  it("numbers cortisol's pregnane side chain and stops at 19 or 18 where the steroid stops", () => {
    const cortisol = load("cortisol.mol");
    const numbered = steroidNumbering(cortisol, coreOf(cortisol));
    expect(numbered.get("a20")).toBe("20");
    expect(numbered.get("a22")).toBe("21");
    expect(numbered.get("a25")).toBe("18");
    expect(numbered.get("a1")).toBe("19");

    const testosterone = load("testosterone.mol");
    const t = steroidNumbering(testosterone, coreOf(testosterone));
    expect([...t.values()].sort((a, b) => Number(a) - Number(b))).toEqual(
      Array.from({ length: 19 }, (_, i) => String(i + 1)),
    );
    // Estradiol has no C-19: its C-10 is aromatic and carries no methyl.
    const estradiol = load("estradiol.mol");
    const e = steroidNumbering(estradiol, coreOf(estradiol));
    expect(e.get("a1")).toBe("18");
    expect([...e.values()]).not.toContain("19");
  });

  it("leaves a synthetic group and a lone 17-methyl unnumbered: a numbered core with an unnumbered rest is a normal state", () => {
    const abiraterone = load("abiraterone.mol");
    const a = steroidNumbering(abiraterone, coreOf(abiraterone));
    expect(a.size).toBe(19);
    const methyl = load("methyltestosterone.mol");
    const m = steroidNumbering(methyl, coreOf(methyl));
    expect(m.size).toBe(19);
    expect(m.has("a20")).toBe(false);
  });
});

describe("alpha and beta (decision 182)", () => {
  it("reads 5alpha- and 5beta-cholestane: the A/B fusion differs at C-5 and nowhere else", () => {
    const alpha = load("5alpha-cholestane.mol");
    const beta = load("5beta-cholestane.mol");
    const common = {
      "8/H": "beta", "9/H": "alpha", "10/C:a26": "beta", "13/C:a27": "beta", "14/H": "alpha",
      "17/C:a2": "beta", "17/H": "alpha",
    };
    expect(faceTable(alpha, steroidFaces(alpha, stereoConfig(alpha), coreOf(alpha)))).toEqual({ ...common, "5/H": "alpha" });
    expect(faceTable(beta, steroidFaces(beta, stereoConfig(beta), coreOf(beta)))).toEqual({ ...common, "5/H": "beta" });
  });

  it("reads cholesterol's 3β-OH, testosterone's and estradiol's 17β-OH, and cortisol's 11β- and 17α-OH", () => {
    const pins: readonly [string, Record<string, string>][] = [
      ["cholesterol.mol", { "3/O:a26": "beta", "3/H": "alpha" }],
      ["testosterone.mol", { "17/O:a11": "beta", "17/H": "alpha", "10/C:a21": "beta", "13/C:a1": "beta" }],
      ["estradiol.mol", { "17/O:a11": "beta", "13/C:a1": "beta", "8/H": "beta", "9/H": "alpha", "14/H": "alpha" }],
      // Ring C's C-11, where a plane taken from ring A goes wrong.
      ["cortisol.mol", { "11/O:a26": "beta", "17/O:a24": "alpha", "17/C:a20": "beta", "10/C:a1": "beta" }],
      ["methyltestosterone.mol", { "17/O:a21": "beta", "17/C:a20": "alpha" }],
    ];
    for (const [file, pin] of pins) {
      const mol = load(file);
      const table = faceTable(mol, steroidFaces(mol, stereoConfig(mol), coreOf(mol)));
      expect(table, file).toMatchObject(pin);
    }
  });

  it("keeps every label when the drawing is turned 180 degrees or flipped, and inverts every one in the mirror image", () => {
    const mol = load("cholesterol.mol");
    const core = coreOf(mol);
    const faces = faceTable(mol, steroidFaces(mol, stereoConfig(mol), core));
    expect(Object.keys(faces).length).toBeGreaterThan(8);
    const turned = rotateAtoms(mol, mol.atomIds, { x: 0, y: 0 }, Math.PI);
    expect(faceTable(turned, steroidFaces(turned, stereoConfig(turned), core))).toEqual(faces);
    const flipped = flipAtoms(mol, mol.atomIds, verticalMirror({ x: 0, y: 0 }));
    expect(faceTable(flipped, steroidFaces(flipped, stereoConfig(flipped), core))).toEqual(faces);

    // Positions mirrored, marks as drawn: the enantiomer, ent-cholesterol.
    let mirrored = mol;
    for (const id of mol.atomIds) mirrored = setAtomPosition(mirrored, id, { x: -mol.atoms[id]!.pos.x, y: mol.atoms[id]!.pos.y });
    const inverted = faceTable(mirrored, steroidFaces(mirrored, stereoConfig(mirrored), core));
    for (const [key, face] of Object.entries(faces)) expect(inverted[key], key).toBe(face === "alpha" ? "beta" : "alpha");
  });

  it("does not share the anomeric rule: cholesteryl α-D-glucopyranoside's oxygen is 3β while its linkage is α", () => {
    const mol = load("cholesteryl-alpha-d-glucopyranoside.mol");
    const config = stereoConfig(mol);
    // The glycosidic oxygen, a26, on the steroid's C-3 (a24).
    expect(faceTable(mol, steroidFaces(mol, config, coreOf(mol)))["3/O:a26"]).toBe("beta");
    const [sugar] = carbohydrates(mol).filter((unit) => unit.ring !== undefined);
    expect(sugar).toBeDefined();
    const anomer = anomericConfiguration(mol, sugar!);
    expect(anomer).toMatchObject({ kind: "alpha", substituent: "a26" });

    // And the two modules never import each other.
    const dir = dirname(fileURLToPath(import.meta.url));
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      expect(readFileSync(join(dir, file), "utf8"), file).not.toMatch(/from "\.\.\/sugar\.js"/);
    }
    expect(readFileSync(join(dir, "..", "sugar.ts"), "utf8")).not.toMatch(/skeleton\//);
  });
});

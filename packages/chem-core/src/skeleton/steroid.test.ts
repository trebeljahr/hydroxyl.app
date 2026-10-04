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
import { removeBonds, setAtomPosition } from "../ops.js";
import { joinSpecies, species } from "../species.js";
import { carbohydrates, anomericConfiguration } from "../sugar.js";
import { descriptorFromConfig, stereoConfig, type StereoConfig } from "../stereo-config.js";
import { flipAtoms, rotateAtoms, verticalMirror } from "../transform.js";
import type { AtomId, Molecule } from "../types.js";
import { SIDE_CHAIN_PARENTS, STEROID_SKELETON, steroidFaces, steroidNumbering, suggestSteroidSkeleton } from "./steroid.js";
import {
  acceptedSkeletonMisfit,
  extraFusedCarbocycles,
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

/**
 * test/fixtures/skeleton: what the suggestion must refuse, or must still
 * match with a ring fused on (decision 185). PubChem SMILES drawn by RDKit,
 * as above, in their own folder because they are recognition cases only.
 */
const SKELETON_FIXTURES = join(FIXTURES, "..", "skeleton");

function loadSkeleton(file: string): Molecule {
  return readMolblock(readFileSync(join(SKELETON_FIXTURES, file), "utf8")).molecule;
}

/** RDKit's letters for the skeleton fixtures, atom a<i+1> for RDKit atom i. */
const SKELETON_LETTERS: Readonly<Record<string, Readonly<Record<AtomId, string>>>> = {
  "betulin.mol": { a4: "R", a7: "S", a8: "R", a9: "R", a12: "R", a13: "R", a16: "S", a18: "R", a21: "R", a22: "R" },
  "hopane.mol": { a4: "R", a7: "S", a8: "S", a11: "R", a12: "R", a15: "R", a16: "R", a19: "S", a20: "S" },
  "beta-amyrin.mol": { a2: "R", a5: "S", a9: "R", a10: "R", a13: "R", a14: "R", a17: "S", a24: "R" },
  "d-homoestrone.mol": { a2: "S", a5: "S", a6: "R", a7: "S" },
  "stanozolol.mol": { a2: "S", a5: "S", a6: "R", a7: "S", a10: "S", a15: "S", a16: "S" },
  "cyproterone-acetate.mol": { a4: "R", a7: "S", a8: "S", a11: "S", a12: "R", a19: "R", a21: "S", a22: "S" },
  "triamcinolone-acetonide.mol": { a2: "S", a4: "S", a5: "R", a6: "S", a7: "S", a9: "R", a10: "S", a28: "S" },
  "oppenauer-scheme.mol": {
    a2: "R", a9: "R", a12: "S", a13: "R", a16: "S", a17: "S", a21: "R", a24: "S",
    a30: "R", a37: "R", a40: "S", a41: "R", a44: "S", a45: "S", a54: "R",
  },
};

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
  if (suggestion.skeletons.length !== 1) throw new Error(`${suggestion.skeletons.length} cores`);
  return suggestion.skeletons[0]!.core;
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

describe("the skeleton fixtures, before anything is recognised", () => {
  it("has eight molecules and every stereocentre reads RDKit's letter", () => {
    const files = readdirSync(SKELETON_FIXTURES).filter((f) => f.endsWith(".mol")).sort();
    expect(files).toEqual(Object.keys(SKELETON_LETTERS).sort());
    for (const file of files) {
      const mol = loadSkeleton(file);
      expect(letters(mol, stereoConfig(mol)), file).toEqual(SKELETON_LETTERS[file]);
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
      expect(suggestion.skeletons).toEqual([{ name: "steroid", core: ids(numbers) }]);
      expect(suggestion.refusals).toEqual([]);
      expect(acceptedSkeletonMisfit(mol, STEROID_SKELETON, suggestion.skeletons[0]!)).toBeUndefined();
    });
  }

  it("refuses ent-kaurene's 6-6-6-5 rings, whose C/D fusion is bridged, rather than numbering them", () => {
    const suggestion = suggestSteroidSkeleton(load("ent-kaurene.mol"));
    expect(suggestion).toMatchObject({ kind: "refused", refusals: [{ reason: "wrong-fusion-topology" }] });
    if (suggestion.kind === "refused") expect(suggestion.refusals[0]!.atomIds).toHaveLength(16);
  });

  it("names cholecalciferol a partial core, 9,10-seco", () => {
    const suggestion = suggestSteroidSkeleton(load("cholecalciferol.mol"));
    expect(suggestion).toMatchObject({
      kind: "refused",
      refusals: [{ reason: "partial-core", missingBond: ["9", "10"] }],
    });
    if (suggestion.kind === "refused") expect(suggestion.refusals[0]!.atomIds).toHaveLength(17);
  });

  it("refuses a pentacyclic triterpene that holds the whole core, naming the ring fused onto it (decision 185)", () => {
    // Betulin (a lupane): rings B-E embed the gonane core, and ring A (C1,
    // C2, C3 with its OH, C4 with its gem-dimethyl, C5, C10) is fused on.
    const betulin = loadSkeleton("betulin.mol");
    expect(skeletonEmbeddings(betulin, STEROID_SKELETON, undefined, { nodes: SKELETON_SEARCH_BUDGET })).toHaveLength(1);
    expect(suggestSteroidSkeleton(betulin)).toEqual({
      kind: "refused",
      refusals: [{ name: "steroid", reason: "larger-ring-system", atomIds: ids([13, 14, 15, 16, 17, 18]) }],
    });
    // Hopane, 6-6-6-6-5, the same way: its ring A is the carbocycle named.
    const hopane = loadSkeleton("hopane.mol");
    const suggestion = suggestSteroidSkeleton(hopane);
    expect(suggestion).toMatchObject({ kind: "refused", refusals: [{ reason: "larger-ring-system" }] });
    if (suggestion.kind !== "refused") return;
    const [refusal] = suggestion.refusals;
    expect(refusal!.atomIds).toHaveLength(6);
    for (const id of refusal!.atomIds) expect(hopane.atoms[id]!.element).toBe("C");
  });

  it("offers partial-core only for a ring really left open: an oleanane and a D-homo steroid are none", () => {
    // Both embed the core minus its 13-17 bond, but their six-membered ring D
    // still holds both atoms: nothing is open, so nothing is offered.
    expect(suggestSteroidSkeleton(loadSkeleton("beta-amyrin.mol"))).toEqual({ kind: "none" });
    expect(suggestSteroidSkeleton(loadSkeleton("d-homoestrone.mol"))).toEqual({ kind: "none" });
    // Cholecalciferol's C9 and C10 share no ring: still 9,10-seco.
    expect(suggestSteroidSkeleton(load("cholecalciferol.mol"))).toMatchObject({ refusals: [{ reason: "partial-core" }] });
  });

  it("still matches a steroid with a small carbocycle or a heterocycle fused on, and reads its faces", () => {
    const pins: readonly [string, readonly number[], Record<string, string>][] = [
      // 17α-methyl-2'H-5α-androst-2-eno[3,2-c]pyrazol-17β-ol.
      [
        "stanozolol.mol",
        [17, 18, 19, 20, 15, 14, 13, 6, 5, 16, 4, 3, 2, 7, 8, 9, 10],
        { "5/H": "alpha", "17/O:a12": "beta", "17/C:a11": "alpha", "10/C:a24": "beta" },
      ],
      // The 1α,2α-methylene: its carbon, a20, is alpha at both C1 and C2.
      [
        "cyproterone-acetate.mol",
        [21, 19, 17, 16, 15, 14, 13, 12, 11, 22, 10, 9, 8, 7, 6, 5, 4],
        { "1/C:a20": "alpha", "2/C:a20": "alpha", "17/O:a26": "alpha", "17/C:a2": "beta" },
      ],
      // 9α-fluoro-11β-hydroxy-16α,17α-(isopropylidenedioxy).
      [
        "triamcinolone-acetonide.mol",
        [27, 26, 24, 23, 22, 21, 20, 6, 5, 28, 4, 3, 2, 7, 8, 9, 10],
        { "9/F:a30": "alpha", "11/O:a31": "beta", "16/O:a13": "alpha", "17/O:a11": "alpha", "17/C:a16": "beta" },
      ],
    ];
    for (const [file, numbers, faces] of pins) {
      const mol = loadSkeleton(file);
      const suggestion = suggestSteroidSkeleton(mol);
      expect(suggestion.kind, file).toBe("match");
      if (suggestion.kind !== "match") continue;
      expect(suggestion.skeletons.map((s) => s.core), file).toEqual([ids(numbers)]);
      const core = suggestion.skeletons[0]!.core;
      expect(extraFusedCarbocycles(mol, STEROID_SKELETON, core), file).toEqual([]);
      expect(faceTable(mol, steroidFaces(mol, stereoConfig(mol), core)), file).toMatchObject(faces);
    }
  });

  it("offers one core per species: the Oppenauer scheme numbers cholesterol and cholest-4-en-3-one (decision 195)", () => {
    const scheme = loadSkeleton("oppenauer-scheme.mol");
    expect(species(scheme)).toHaveLength(2);
    const suggestion = suggestSteroidSkeleton(scheme);
    expect(suggestion.kind).toBe("match");
    if (suggestion.kind !== "match") return;
    // Cholesterol is the SMILES's first species, read as cholesterol.mol is;
    // the enone's 28 atoms follow, C1 a53, C3 a50 (the ketone), C10 a54.
    expect(suggestion.skeletons).toEqual([
      { name: "steroid", core: ids([22, 23, 24, 25, 20, 19, 18, 17, 16, 21, 15, 14, 13, 12, 11, 10, 9]) },
      { name: "steroid", core: ids([53, 52, 50, 49, 48, 47, 46, 45, 44, 54, 43, 42, 41, 40, 39, 38, 37]) },
    ]);
    expect(suggestion.refusals).toEqual([]);
    for (const skeleton of suggestion.skeletons) {
      expect(acceptedSkeletonMisfit(scheme, STEROID_SKELETON, skeleton)).toBeUndefined();
    }
    // Both numbered to C25, cholestane's 26 and 27 left blank: 25 each.
    expect(suggestion.locants.size).toBe(50);
    expect(suggestion.locants.get("a24")).toBe("3");
    expect(suggestion.locants.get("a50")).toBe("3");
    expect(suggestion.locants.get("a56")).toBe("18");
    expect(suggestion.locants.get("a29")).toBe("21");
    // The 3β-OH is cholesterol's alone; both keep 8β-H, 10β and 17β.
    const config = stereoConfig(scheme);
    const [cholesterol, enone] = suggestion.skeletons.map((s) => faceTable(scheme, steroidFaces(scheme, config, s.core)));
    expect(cholesterol).toMatchObject({ "3/O:a26": "beta", "8/H": "beta", "10/C:a27": "beta", "17/C:a2": "beta" });
    expect(enone).toMatchObject({ "8/H": "beta", "9/H": "alpha", "10/C:a55": "beta", "17/C:a30": "beta" });
    expect(Object.keys(enone!).some((key) => key.startsWith("3/"))).toBe(false);
  });

  it("refuses two cores in ONE species as several-cores: the scheme's steroids joined as one compound", () => {
    const joined = joinSpecies(loadSkeleton("oppenauer-scheme.mol"), ["a1", "a29"]);
    expect(species(joined)).toHaveLength(1);
    const suggestion = suggestSteroidSkeleton(joined);
    expect(suggestion).toMatchObject({ kind: "refused", refusals: [{ reason: "several-cores" }] });
    if (suggestion.kind === "refused") expect(suggestion.refusals[0]!.atomIds).toHaveLength(34);
  });

  it("offers the species that match and says why the others do not: a scheme with a 9,10-seco product", () => {
    // The enone with its C9-C10 bond cut: ring B is open, so the product is a
    // partial core while cholesterol beside it is still offered.
    const scheme = loadSkeleton("oppenauer-scheme.mol");
    const seco = removeBonds(scheme, [bondBetween(scheme, "a44", "a54")!.id]);
    const suggestion = suggestSteroidSkeleton(seco);
    expect(suggestion.kind).toBe("match");
    if (suggestion.kind !== "match") return;
    expect(suggestion.skeletons.map((s) => s.core)).toEqual([ids([22, 23, 24, 25, 20, 19, 18, 17, 16, 21, 15, 14, 13, 12, 11, 10, 9])]);
    expect(suggestion.refusals).toEqual([
      {
        name: "steroid",
        reason: "partial-core",
        atomIds: ids([37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 52, 53, 54]),
        missingBond: ["9", "10"],
      },
    ]);
    expect([...suggestion.locants.values()].filter((locant) => locant === "3")).toHaveLength(1);
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

  it("does not let an acceptance outlive a carbocycle fused onto its core (decision 185)", () => {
    // Betulin's embedded core, as if accepted before its ring A was drawn.
    const betulin = loadSkeleton("betulin.mol");
    const [core] = skeletonEmbeddings(betulin, STEROID_SKELETON, undefined, { nodes: SKELETON_SEARCH_BUDGET });
    expect(core).toBeDefined();
    expect(acceptedSkeletonMisfit(betulin, STEROID_SKELETON, { name: "steroid", core: core! })).toEqual(
      ids([13, 14, 15, 16, 17, 18]),
    );
  });
});

describe("numbering (decision 181)", () => {
  it("exports its side-chain table frozen all the way down", () => {
    expect(Object.isFrozen(SIDE_CHAIN_PARENTS)).toBe(true);
    for (const parent of SIDE_CHAIN_PARENTS) {
      expect(Object.isFrozen(parent), parent.name).toBe(true);
      expect(Object.isFrozen(parent.nodes), parent.name).toBe(true);
      for (const node of parent.nodes) expect(Object.isFrozen(node), `${parent.name} ${node.locant}`).toBe(true);
    }
    expect(SIDE_CHAIN_PARENTS.map((p) => p.name)).toEqual(["pregnane", "cholane", "cholestane", "ergostane", "stigmastane"]);
  });

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

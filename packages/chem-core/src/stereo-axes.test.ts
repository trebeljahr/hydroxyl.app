/**
 * The unrepresentable-stereo detector. An empty StereoConfig on an allene
 * reads as "achiral"; this module is what stops that. Positives must name the
 * element with a reason, and the negatives must report NOTHING, so a plain
 * biphenyl or cyclohexane never grows a warning.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readMolblock } from "./molblock-read.js";
import {
  BIARYL_MIN_ORTHO_SUBSTITUENTS,
  CYCLOPHANE_MAX_BRIDGE_ATOMS,
  HELICENE_MIN_RINGS,
  unrepresentableStereo,
} from "./stereo-axes.js";
import { structuralIssues } from "./stereo.js";
import { stereoConfig, stereoTopology } from "./stereo-config.js";
import type { Molecule } from "./types.js";

const CASES = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "cip", "cases.json"), "utf8"),
) as { cases: Record<string, { molblock: string }> };

function load(name: string): Molecule {
  return readMolblock(CASES.cases[name]!.molblock).molecule;
}

function kinds(name: string): string[] {
  return unrepresentableStereo(load(name)).map((element) => element.kind);
}

describe("unrepresentableStereo", () => {
  it("states its escalated thresholds", () => {
    expect(BIARYL_MIN_ORTHO_SUBSTITUENTS).toBe(2);
    expect(HELICENE_MIN_RINGS).toBe(6);
    expect(CYCLOPHANE_MAX_BRIDGE_ATOMS).toBe(10);
  });

  const positives: [string, string][] = [
    ["penta-2-3-diene", "allene-axis"],
    ["hexa-2-3-4-triene", "cumulene-cis-trans"],
    ["binap", "biaryl-axis"],
    ["binol", "biaryl-axis"],
    // Plain 1,1'-binaphthyl carries no ortho substituent at all: the two
    // occupied positions are its ring-fusion carbons. It is the case the
    // threshold of 2 exists for.
    ["1-1-binaphthyl", "biaryl-axis"],
    ["6-helicene", "helicene"],
    ["1-1-spirobiindane", "spiro-axis"],
    ["4-bromo-2-2-paracyclophane", "planar-cyclophane"],
  ];
  for (const [name, kind] of positives) {
    it(`reports ${name} as ${kind}, with a named reason`, () => {
      const mol = load(name);
      const found = unrepresentableStereo(mol);
      expect(found.map((element) => element.kind)).toEqual([kind]);
      expect(found[0]!.reason.length).toBeGreaterThan(20);
      expect(mol.atoms[found[0]!.anchorAtomId]).toBeDefined();
      // Carried on the config, so an empty config is not mistaken for achiral.
      expect(stereoConfig(mol).unrepresentable).toEqual(found);
      expect(stereoTopology(mol).unrepresentable).toEqual(found);
      const issues = structuralIssues(mol).filter((issue) => issue.kind === "unrepresentable-stereo");
      expect(issues).toHaveLength(1);
      expect(issues[0]!.severity).toBe("warning");
      expect(issues[0]!.message).toContain("contains a stereogenic axis or plane this build cannot express");
    });
  }

  const negatives = [
    "biphenyl",
    "2-methylbiphenyl",
    "2-2-6-6-tetramethylbiphenyl",
    "spiro-4-4-nonane",
    "cyclohexane",
    "bromochlorofluoromethane",
    "3-methylbuta-1-2-diene",
    "phenanthrene",
    "picene",
    "5-helicene",
    "coronene",
    "2-2-paracyclophane",
    "cis-decalin",
    "taxol",
  ];
  for (const name of negatives) {
    it(`reports nothing for ${name}`, () => {
      expect(kinds(name)).toEqual([]);
      expect(structuralIssues(load(name)).filter((i) => i.kind === "unrepresentable-stereo")).toEqual([]);
    });
  }
});

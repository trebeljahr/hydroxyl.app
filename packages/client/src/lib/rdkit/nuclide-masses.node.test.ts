import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import {
  COMMON_ORGANIC_ELEMENTS,
  benzene,
  buildMolecule,
  exactMass,
  fromPolar,
  labellingIsotopes,
  molecularWeight,
  setIsotope,
  vec,
} from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";

import type { JSMolLike, RDKitLogLike, RDKitModuleLike } from "./ops";
import { moleculeToMolblock } from "./translate";

/**
 * chem-core's isotope-labelled masses against the real RDKit.
 *
 * TWO SOURCES, ONE ANSWER. chem-core's nuclide masses are AME2020, generated
 * from the evaluation's own file; RDKit's come from its bundled NIST table. A
 * row filed under the wrong mass number, or a digit dropped in the first four
 * decimals, shows up here as a disagreement by name. RDKit reports masses to
 * five decimals, so the comparison is to the four a mass is quoted to.
 *
 * AND ONE CONVENTION. Decision 118 holds a labelled position at its nuclide's
 * mass in the average weight too, which is what RDKit's MolWt does. The two
 * disagree on chlorine's standard weight (35.453 there, IUPAC's 35.45 here),
 * so the weights are compared as the shift the label causes, not outright.
 *
 * Every structure goes through the app's own molblock bridge, so this also
 * proves `M  ISO` carries the label to RDKit intact.
 */

const require = createRequire(import.meta.url);

/** The one JSMol call this probe needs that the app's bridge does not. */
interface DescribedMol extends JSMolLike {
  get_descriptors(): string;
}

interface Descriptors {
  readonly exactmw: number;
  readonly amw: number;
}

let RDKit: RDKitModuleLike;
let log: RDKitLogLike | null = null;

beforeAll(async () => {
  const initRDKitModule = require("@rdkit/rdkit") as () => Promise<RDKitModuleLike>;
  RDKit = await initRDKitModule();
  log = RDKit.set_log_capture?.("rdApp.*") ?? null;
}, 60_000);

function rdkitMasses(mol: Molecule): Descriptors {
  const written = moleculeToMolblock(mol);
  if (!written.ok) throw new Error(`bridge refused to write it: ${written.error.message}`);
  const parsed = RDKit.get_mol(written.value) as DescribedMol | null;
  if (parsed === null) throw new Error("RDKit refused the molblock");
  try {
    return JSON.parse(parsed.get_descriptors()) as Descriptors;
  } finally {
    parsed.delete();
    log?.clear_buffer();
  }
}

/** A lone labelled atom, its hydrogens left for each side to derive. */
function labelledHydride(symbol: string, isotope: number): Molecule {
  return buildMolecule((b) => void b.atom(symbol, vec(0, 0), { isotope }));
}

function methanol(carbonIsotope?: number): Molecule {
  return buildMolecule((b) => {
    const c = b.atom("C", vec(0, 0), carbonIsotope === undefined ? {} : { isotope: carbonIsotope });
    b.bond(c, b.atom("O", vec(1, 0)), 1);
  });
}

function chloroform(hydrogenIsotope?: number): Molecule {
  return buildMolecule((b) => {
    const c = b.atom("C", vec(0, 0));
    const h = b.atom(
      "H",
      fromPolar(0, 1),
      hydrogenIsotope === undefined ? {} : { isotope: hydrogenIsotope },
    );
    b.bond(c, h, 1);
    for (let i = 1; i <= 3; i++) b.bond(c, b.atom("Cl", fromPolar((i * Math.PI) / 2, 1)), 1);
  });
}

function carbon13Benzene(): Molecule {
  const plain = benzene();
  return setIsotope(plain, plain.atomIds[0]!, 13);
}

describe("isotope-labelled masses against RDKit", () => {
  it("agrees on the exact mass of every label the editor offers", () => {
    const drift: string[] = [];
    for (const symbol of COMMON_ORGANIC_ELEMENTS) {
      for (const isotope of labellingIsotopes(symbol)) {
        const mol = labelledHydride(symbol, isotope);
        const ours = exactMass(mol);
        const theirs = rdkitMasses(mol).exactmw;
        if (Math.abs(ours - theirs) > 5e-5) {
          drift.push(
            `${String(isotope)}${symbol}: RDKit ${String(theirs)}, chem-core ${ours.toFixed(5)}`,
          );
        }
      }
    }
    expect(drift).toEqual([]);
  });

  it.each([
    ["[13C]methanol", methanol(13), methanol()],
    ["CDCl3", chloroform(2), chloroform()],
    ["[1-13C]benzene", carbon13Benzene(), benzene()],
  ])("agrees on %s, exact mass and the label's shift in weight", (_, labelled, plain) => {
    const theirs = rdkitMasses(labelled);
    const theirsPlain = rdkitMasses(plain);
    expect(exactMass(labelled)).toBeCloseTo(theirs.exactmw, 4);
    expect(molecularWeight(labelled) - molecularWeight(plain)).toBeCloseTo(
      theirs.amw - theirsPlain.amw,
      4,
    );
  });
});

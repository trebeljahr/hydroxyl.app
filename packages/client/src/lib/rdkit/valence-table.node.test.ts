import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ELEMENTS,
  buildMolecule,
  fromPolar,
  implicitHydrogenCount,
  isOverValent,
  vec,
} from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";

import type { JSMolLike, RDKitLogLike, RDKitModuleLike } from "./ops";
import { moleculeToMolblock } from "./translate";

/**
 * chem-core's valence table against the real RDKit, element by element.
 *
 * WHY A PROBE AND NOT A COPIED TABLE. chem-core's lists are calibrated to
 * RDKit's so a round trip neither gains nor loses hydrogens, and RDKit's own
 * table moved in 2024.09 without anything here noticing: gallium, indium,
 * xenon and polonium had gained hydrogens there, and iodine and astatine had
 * lost their seventh valence. A table typed into a test would only have pinned
 * the old answer. This asks the wasm the app ships, so the next bump that moves
 * a row fails here, by name, instead of in somebody's export.
 *
 * THE PROBE: every element, carrying 0 to 8 single-bonded chlorines, written by
 * the app's own molblock bridge. That bridge asserts nothing about an atom
 * whose hydrogens a reader can derive, so RDKit counts them from ITS table and
 * the comparison is a real one. Two outcomes are possible per row:
 *
 *   - RDKit sanitises it: its implicit-hydrogen count must equal chem-core's.
 *   - RDKit refuses it: chem-core must report the atom over-valent, so the
 *     badge warns before an export fails.
 *
 * The converse is deliberately not asserted. RDKit lets an alkali or alkaline
 * earth metal take bonds past its valence with no hydrogens and no complaint
 * (a lithium with two chlorines sanitises), while chem-core badges it. The
 * hydrogen count is the same either way, and a badge on a drawing RDKit would
 * accept is a warning, not drift.
 *
 * NEUTRAL ATOMS ONLY. RDKit 2024.09 also changed how a formal charge moves the
 * valence list — it reads a charged atom as the isoelectronic element, so Si+
 * takes aluminium's list — and chem-core still applies the older additive
 * rule. That divergence is real and wider than the table (Si+, Cl+, Pb+, Sn-,
 * Ca- and more), and it lives in `chargeAdjustment`, not in `elements.ts`.
 */

const require = createRequire(import.meta.url);

/** The two JSMol calls this probe needs that the app's bridge does not. */
interface ProbedMol extends JSMolLike {
  get_json(): string;
  is_valid?(): boolean;
}

interface CommonChemAtom {
  readonly z?: number;
  readonly impHs?: number;
}

let RDKit: RDKitModuleLike;
let log: RDKitLogLike | null = null;

beforeAll(async () => {
  const initRDKitModule = require("@rdkit/rdkit") as () => Promise<RDKitModuleLike>;
  RDKit = await initRDKitModule();
  // Captured only so a refused structure does not spray the test output.
  log = RDKit.set_log_capture?.("rdApp.*") ?? null;
}, 60_000);

/** `symbol` with `n` single-bonded chlorines around it. */
function chlorinated(symbol: string, n: number): Molecule {
  return buildMolecule((b) => {
    const centre = b.atom(symbol, vec(0, 0));
    for (let i = 0; i < n; i++) {
      b.bond(centre, b.atom("Cl", fromPolar((2 * Math.PI * i) / Math.max(n, 1), 1)));
    }
  });
}

/** RDKit's implicit hydrogens on the first atom, or null when it refuses. */
function rdkitHydrogens(molblock: string): number | null {
  let mol: ProbedMol | null = null;
  try {
    mol = RDKit.get_mol(molblock) as ProbedMol | null;
  } catch {
    return null;
  }
  if (mol === null) return null;
  try {
    if (mol.is_valid?.() === false) return null;
    const json = JSON.parse(mol.get_json()) as {
      molecules: readonly { atoms: readonly CommonChemAtom[] }[];
    };
    return json.molecules[0]?.atoms[0]?.impHs ?? 0;
  } finally {
    mol.delete();
    log?.clear_buffer();
  }
}

const MAX_LIGANDS = 8;

describe("chem-core's valence table against RDKit", () => {
  it("probes the RDKit this repo pins", () => {
    // elements.ts names the version its lists were read off. A bump is not a
    // failure — the probe below re-reads the table — but the comment would
    // then be naming the wrong release.
    expect(RDKit.version()).toMatch(/^2025\.03\.4/);
  });

  it("agrees on every element's implicit hydrogens, and badges what RDKit refuses", () => {
    const drift: string[] = [];
    for (const element of ELEMENTS) {
      for (let n = 0; n <= MAX_LIGANDS; n++) {
        const mol = chlorinated(element.symbol, n);
        const centre = mol.atomIds[0]!;
        const written = moleculeToMolblock(mol);
        if (!written.ok) {
          drift.push(`${element.symbol}Cl${String(n)}: bridge refused to write it`);
          continue;
        }
        const theirs = rdkitHydrogens(written.value);
        const ours = implicitHydrogenCount(mol, centre);
        if (theirs === null) {
          if (!isOverValent(mol, centre)) {
            drift.push(
              `${element.symbol}Cl${String(n)}: RDKit refuses it, chem-core ` +
                `gives ${String(ours)} H and no over-valence`,
            );
          }
        } else if (theirs !== ours) {
          drift.push(
            `${element.symbol}Cl${String(n)}: RDKit ${String(theirs)} H, chem-core ${String(ours)} H`,
          );
        }
      }
    }
    expect(drift).toEqual([]);
  });
});

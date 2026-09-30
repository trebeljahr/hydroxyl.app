/**
 * The traps this task does NOT land, and who owes each (the scope's last
 * done-when line; decision 208).
 *
 * This task lands only the frame-agnostic traps (T1 Fischer rotation, T2 the
 * convention negative control, T3 transpositions, T6 mirror). A trap for a
 * template that does not exist yet cannot be written today, and scheduling it
 * here would make this task uncompletable, so each is a ROW: pending while
 * its template projects `template-not-built`, and a FAILURE the day the
 * template projects a layout while the trap has not landed. The owning task
 * lands the trap and sets `landedIn` to the test file that holds it; the
 * harness then checks that file exists and names the trap.
 */

import type { HarnessFixture, TemplateKey } from "./fixtures.js";
import { HARNESS_FIXTURES } from "./fixtures.js";

export interface OwedTrap {
  readonly trap: "T4" | "T5" | "T7";
  /** The task in 2-chemistry-sketcher-manual-notes.md that owes it. */
  readonly owner: string;
  /** The template whose first layout turns the row from pending into owed. */
  readonly template: TemplateKey;
  /** The fixture the probe projects, a real molecule the trap is about. */
  readonly probe: HarnessFixture;
  /** The trap as the owner's done-when states it. */
  readonly statement: string;
  /** The owner's test file, relative to packages/chem-core, once the trap has landed. */
  readonly landedIn?: string;
}

function fixture(file: string): HarnessFixture {
  const found = HARNESS_FIXTURES.find((f) => f.file === file);
  if (found === undefined) throw new Error(`no harness fixture ${file}`);
  return found;
}

export const OWED_TRAPS: readonly OwedTrap[] = Object.freeze([
  {
    trap: "T4",
    owner: "chair-conformers-fused-systems-and-depth-rendering",
    template: "ring/chair",
    probe: fixture("beta-d-glucopyranose.mol"),
    statement:
      "beta-D-glucopyranose is all-equatorial in 4C1 and all-axial in the flipped chair, with every CIP descriptor and the anomeric alpha/beta identical across the flip",
  },
  {
    trap: "T5",
    owner: "torsion-conformer-newman-and-sawhorse",
    template: "sightedBond/newman",
    probe: fixture("meso-2-3-dibromobutane.mol"),
    statement:
      "a Newman dihedral swept 0-360 on butane and on both 2,3-dibromobutanes changes no parity and no descriptor at any step, including the eclipsed angles",
  },
  {
    trap: "T7",
    owner: "fischer-and-haworth-projections",
    template: "ring/haworth",
    probe: fixture("alpha-d-glucopyranose.mol"),
    statement:
      "a group on the RIGHT in the Fischer points DOWN in the Haworth for BOTH D- and L-sugars, asserted for D-glucose and L-glucose in the same template",
  },
] satisfies readonly OwedTrap[]);

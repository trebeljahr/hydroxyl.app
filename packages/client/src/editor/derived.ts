/**
 * Derived chemistry, memoised on the Molecule instance.
 *
 * ONE CACHE, SHARED BY EVERY READER. `EditorCanvas` already computed
 * `valenceIssues(doc.molecule)` for the overlay's badges and its comment said
 * in so many words that "whatever status bar arrives later" must not compute
 * them a second time. This module is that shared cache: the canvas and the
 * status bar call the same function and the second caller pays nothing.
 *
 * BE HONEST ABOUT WHAT THE WEAKMAP BUYS. It does NOT help during a drag. The
 * interaction machine commits on every pointer-move, so a new Molecule is
 * minted every frame and every frame is a cache miss — the caching is not what
 * makes dragging affordable (rebuilding from the gesture's base is). What it
 * defends is the far more common case: a re-render that changed nothing
 * chemical. A hover, a pan, a tool change, a keystroke into the title field
 * and a palette opening all re-render the shell without touching the molecule,
 * and without this each one would re-walk every atom twice.
 *
 * A `WeakMap` rather than a one-entry "last molecule" cache because undo and
 * redo alternate between two molecules, and a single slot would miss on every
 * step of a ctrl-Z/ctrl-Y sequence. Entries die with the molecules that key
 * them, which for an undone document is when history drops it.
 */

import { massSummary, valenceIssues } from "@starter/chem-core";
import type { MassSummary, Molecule, ValenceIssue } from "@starter/chem-core";

const massCache = new WeakMap<Molecule, MassSummary>();
const issueCache = new WeakMap<Molecule, readonly ValenceIssue[]>();

/** Formula, weight, exact mass and charge. `exactMass` is `undefined` — not a
 *  substituted average weight — when an element has no verified monoisotopic
 *  value; that is chem-core's contract and the status bar renders it as an
 *  em dash rather than inventing a plausible wrong number. */
export function moleculeMass(mol: Molecule): MassSummary {
  const cached = massCache.get(mol);
  if (cached !== undefined) return cached;
  const computed = massSummary(mol);
  massCache.set(mol, computed);
  return computed;
}

/** Over-valent atoms and negative hydrogen counts, via `explicitValence` — the
 *  resolved number, never the raw `bondOrderSum`. */
export function moleculeIssues(mol: Molecule): readonly ValenceIssue[] {
  const cached = issueCache.get(mol);
  if (cached !== undefined) return cached;
  const computed: readonly ValenceIssue[] = valenceIssues(mol);
  issueCache.set(mol, computed);
  return computed;
}

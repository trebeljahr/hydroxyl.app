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
 * them, which for an undone document is when history drops it. Built through
 * `@/lib/weak-cache` so they are counted: see that module for what the count
 * proves and what it cannot.
 */

import { chemistryIssues, massSummary } from "@starter/chem-core";
import type { ChemistryIssue, MassSummary, Molecule } from "@starter/chem-core";

import { keysRetained, weakCache } from "@/lib/weak-cache";

const massCache = weakCache<Molecule, MassSummary>("molecule");
const issueCache = weakCache<Molecule, readonly ChemistryIssue[]>("molecule");

/** What `derivedCacheStats` reports. */
export interface DerivedCacheStats {
  /**
   * MOLECULES the app's registered caches hold a strong reference to, and
   * therefore keep alive. Zero, always: `weakCache` builds `WeakMap`s, so an
   * entry dies with the molecule that keys it — which for an edited or undone
   * document is as soon as the history drops it.
   *
   * Testing hook, and the only number that can tell a weakly-keyed memo from a
   * leak. `moleculeIssues(m) === moleculeIssues(m)` holds for both, so the
   * identity check a memo test reaches for first cannot see the difference.
   * `src/state/editing-session.test.ts` asserts this after a long session.
   *
   * IT IS NOT THIS MODULE'S NUMBER ANY MORE, and that is the repair. It used
   * to be a fold over a hardcoded `[massCache, issueCache]`, so a third cache
   * added ten lines below contributed nothing and the test stayed green while
   * the cache held every molecule of the session. It now comes from the
   * registry every `weakCache` enrols in at construction, and
   * `src/lib/weak-cache.node.test.ts` fails on a molecule-keyed container that
   * did not come from there.
   */
  readonly moleculesRetained: number;
}

export function derivedCacheStats(): DerivedCacheStats {
  return { moleculesRetained: keysRetained("molecule") };
}

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

/** Both families of chemistry issue — valence and drawing — as chem-core's
 *  `chemistryIssues` composes them, cached so the overlay, the status-bar
 *  count and the issue list are one walk rather than three. */
export function moleculeIssues(mol: Molecule): readonly ChemistryIssue[] {
  const cached = issueCache.get(mol);
  if (cached !== undefined) return cached;
  const computed = chemistryIssues(mol);
  issueCache.set(mol, computed);
  return computed;
}

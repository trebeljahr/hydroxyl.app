/**
 * A tripwire between immer and chem-core.
 *
 * WHY THIS EXISTS: chem-core memoises `adjacency()` and the ring perception
 * cache in `WeakMap`s keyed on the Molecule INSTANCE. An immer draft is a
 * Proxy, a different object identity from the molecule it wraps, and a new one
 * on every recipe. Hand a draft to chem-core and:
 *
 * - every cache misses, forever — an O(1) adjacency lookup silently becomes an
 *   O(atoms + bonds) rebuild per call, on the pointer-move path;
 * - the entries pile up keyed on proxies nobody will ever present again;
 * - the result molecule is assembled out of proxy reads, so it may carry live
 *   drafts in its own fields and be revoked the moment the recipe returns;
 * - and "molecules are immutable, edits return new ones" — the invariant every
 *   other file in this repo is written against — quietly stops being true.
 *
 * None of that throws. It renders perfectly and gets slower and stranger, which
 * is the worst failure mode available, so the store computes molecules OUTSIDE
 * the immer recipe from `get()` and assigns them wholesale into the draft. This
 * module is what turns a slip back into a loud, immediate error.
 *
 * The check is development-only: in production the assertion is a no-op, so the
 * guarded facade costs one extra call frame and nothing else.
 */

import { isDraft } from "immer";
import {
  addAtom as coreAddAtom,
  addBond as coreAddBond,
  attachRingToAtom as coreAttachRingToAtom,
  extractFragment as coreExtractFragment,
  fuseRingOnBond as coreFuseRingOnBond,
  flipAtoms as coreFlipAtoms,
  insertFragment as coreInsertFragment,
  mergeAtoms as coreMergeAtoms,
  removeAtoms as coreRemoveAtoms,
  removeBonds as coreRemoveBonds,
  rotateAtoms as coreRotateAtoms,
  setAtomPosition as coreSetAtomPosition,
  setAtomPositions as coreSetAtomPositions,
  spiroRingAtAtom as coreSpiroRingAtAtom,
  sprout as coreSprout,
  sproutTo as coreSproutTo,
  translateAtoms as coreTranslateAtoms,
  updateAtom as coreUpdateAtom,
  updateBond as coreUpdateBond,
  type InsertedFragment,
  type Molecule,
  type Vec2,
} from "@starter/chem-core";

/**
 * Throws when `value` is an immer draft, naming `what` so the stack points at
 * the offending call rather than at somewhere deep inside chem-core.
 *
 * `process.env.NODE_ENV` is read at CALL time, not module-init time: Next
 * inlines the literal at build so the production branch folds away entirely,
 * while the tests can flip it to prove the no-op.
 */
export function assertNotDraft(value: unknown, what: string): void {
  if (process.env.NODE_ENV === "production") return;
  if (isDraft(value)) {
    throw new Error(
      `${what} received an immer draft. chem-core caches adjacency and rings ` +
        `on the Molecule instance, so a draft defeats them and breaks the ` +
        `immutability invariant. Compute the new molecule outside the recipe ` +
        `from get(), then assign it into the draft wholesale.`,
    );
  }
}

/**
 * Wraps a chem-core op that takes a Molecule first. The rest-tuple keeps the
 * original parameter list — including optional trailing options bags — so a
 * guarded call site reads exactly like an unguarded one and the facade needs no
 * maintenance when a signature gains a parameter.
 */
function guard<A extends readonly unknown[], R>(
  name: string,
  op: (mol: Molecule, ...rest: A) => R,
): (mol: Molecule, ...rest: A) => R {
  return (mol, ...rest) => {
    assertNotDraft(mol, name);
    return op(mol, ...rest);
  };
}

/**
 * The chem-core surface the editor store is allowed to reach for. Signatures
 * are identical to chem-core's; the only difference is the assertion.
 *
 * Deliberately a whitelist rather than a blanket re-export: anything that reads
 * a molecule without producing a new one (`atoms`, `formula`, `adjacency`)
 * needs no guard, and a new mutating op should have to be added here on
 * purpose.
 */
export const guardedOps = {
  removeAtoms: guard("removeAtoms", coreRemoveAtoms),
  removeBonds: guard("removeBonds", coreRemoveBonds),
  updateAtom: guard("updateAtom", coreUpdateAtom),
  updateBond: guard("updateBond", coreUpdateBond),
  setAtomPosition: guard("setAtomPosition", coreSetAtomPosition),
  setAtomPositions: guard("setAtomPositions", coreSetAtomPositions),
  mergeAtoms: guard("mergeAtoms", coreMergeAtoms),
  translateAtoms: guard("translateAtoms", coreTranslateAtoms),
  rotateAtoms: guard("rotateAtoms", coreRotateAtoms),
  flipAtoms: guard("flipAtoms", coreFlipAtoms),
  addAtom: guard("addAtom", coreAddAtom),
  addBond: guard("addBond", coreAddBond),
  extractFragment: guard("extractFragment", coreExtractFragment),

  /**
   * The drawing ops the pointer state machine commits through.
   *
   * They arrive later than the rest because the canvas was read-only until
   * `canvas-editing-fsm`. Deny-by-default cuts both ways, so this list holds
   * exactly the ops something calls and no more — `cycleBondOrder` and
   * `appendChain` were wrapped here before anything used them and have been
   * taken back out; whoever wires the gesture adds the entry with it. All five
   * mint ids, which is exactly the class of call that must never see a proxy:
   * an id minted off a draft's `nextId` is an id the real molecule has not
   * reserved.
   */
  sprout: guard("sprout", coreSprout),
  sproutTo: guard("sproutTo", coreSproutTo),
  fuseRingOnBond: guard("fuseRingOnBond", coreFuseRingOnBond),
  attachRingToAtom: guard("attachRingToAtom", coreAttachRingToAtom),
  spiroRingAtAtom: guard("spiroRingAtAtom", coreSpiroRingAtAtom),

  /**
   * Written out rather than wrapped, because BOTH arguments are molecules —
   * and the fragment is the likelier of the two to be a draft, since it usually
   * comes from a clipboard or template slice that the store also holds.
   */
  insertFragment(
    target: Molecule,
    fragment: Molecule,
    options?: { readonly offset?: Vec2 | undefined },
  ): InsertedFragment {
    assertNotDraft(target, "insertFragment(target)");
    assertNotDraft(fragment, "insertFragment(fragment)");
    return coreInsertFragment(target, fragment, options);
  },
};

export type GuardedOps = typeof guardedOps;

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
  applyIssueFix as coreApplyIssueFix,
  addBond as coreAddBond,
  alignFragments as coreAlignFragments,
  appendChain as coreAppendChain,
  attachGroupToAtom as coreAttachGroupToAtom,
  attachRingToAtom as coreAttachRingToAtom,
  cycleBondOrder as coreCycleBondOrder,
  duplicateFragment as coreDuplicateFragment,
  extractFragment as coreExtractFragment,
  flipBond as coreFlipBond,
  fuseRingOnBond as coreFuseRingOnBond,
  flipAtoms as coreFlipAtoms,
  insertFragment as coreInsertFragment,
  invertStereocentre as coreInvertStereocentre,
  mergeAtoms as coreMergeAtoms,
  removeAtoms as coreRemoveAtoms,
  removeBonds as coreRemoveBonds,
  rotateAtoms as coreRotateAtoms,
  setAtomPosition as coreSetAtomPosition,
  setAtomPositions as coreSetAtomPositions,
  setBondOrder as coreSetBondOrder,
  setBondStereo as coreSetBondStereo,
  setCharge as coreSetCharge,
  setDoubleBondSide as coreSetDoubleBondSide,
  setElement as coreSetElement,
  setExplicitHydrogenCount as coreSetExplicitHydrogenCount,
  setIsotope as coreSetIsotope,
  setLabel as coreSetLabel,
  setLonePairs as coreSetLonePairs,
  spiroRingAtAtom as coreSpiroRingAtAtom,
  sprout as coreSprout,
  sproutTo as coreSproutTo,
  translateAtoms as coreTranslateAtoms,
  updateAtom as coreUpdateAtom,
  updateBond as coreUpdateBond,
  withStereoGroups as coreWithStereoGroups,
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
  duplicateFragment: guard("duplicateFragment", coreDuplicateFragment),

  /**
   * The per-atom and per-bond edits the properties panel, the charge/element
   * tools and the command registry commit through.
   *
   * Added here with the surfaces that call them, which is what the header
   * above asks for — `cycleBondOrder` in particular was wrapped once before
   * anything used it and taken back out again, and it is back now because
   * `structure.cycle-bond-order` in the command registry calls it. None of
   * these mint an id, but all of them read `mol.atoms` / `mol.bonds` and
   * rebuild the record, so a draft reaching one produces a molecule assembled
   * out of proxy reads exactly as a minting op would.
   */
  setElement: guard("setElement", coreSetElement),
  setCharge: guard("setCharge", coreSetCharge),
  setIsotope: guard("setIsotope", coreSetIsotope),
  setLabel: guard("setLabel", coreSetLabel),
  setExplicitHydrogenCount: guard(
    "setExplicitHydrogenCount",
    coreSetExplicitHydrogenCount,
  ),
  setBondOrder: guard("setBondOrder", coreSetBondOrder),
  cycleBondOrder: guard("cycleBondOrder", coreCycleBondOrder),
  setBondStereo: guard("setBondStereo", coreSetBondStereo),
  setDoubleBondSide: guard("setDoubleBondSide", coreSetDoubleBondSide),
  /** Swaps `from`/`to`, which INVERTS a wedge — the narrow end is at `from`,
   *  never at whichever id sorts first. */
  flipBond: guard("flipBond", coreFlipBond),

  /** The issue list's one-click fixes: a charge, a bond order, a wedge. */
  applyIssueFix: guard("applyIssueFix", coreApplyIssueFix),

  /**
   * The canvas context menu's edits that no other surface reached before it:
   * the Lewis pin, the R/S inversion, and lining separate structures up. Added
   * with the menu that calls them, per the rule in the header. `flipAtoms`
   * above had been wrapped with no caller; the menu's flip commands are its
   * first.
   */
  setLonePairs: guard("setLonePairs", coreSetLonePairs),
  invertStereocentre: guard("invertStereocentre", coreInvertStereocentre),
  alignFragments: guard("alignFragments", coreAlignFragments),

  /**
   * The ABS/AND/OR statement, written by decision 89's selection commands.
   *
   * Guarded like the rest although it touches no id: it calls `requireAtom` for
   * every id in every group and rebuilds the molecule around a new field, so a
   * draft reaching it would validate the group against proxy reads and hand back
   * a molecule assembled out of them.
   */
  withStereoGroups: guard("withStereoGroups", coreWithStereoGroups),

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
  appendChain: guard("appendChain", coreAppendChain),
  /** The functional-group tool's one edit. Mints the group's atoms and the
   *  linking bond, so it belongs to the same class as the ring gestures. */
  attachGroupToAtom: guard("attachGroupToAtom", coreAttachGroupToAtom),

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

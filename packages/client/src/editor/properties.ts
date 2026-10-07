/**
 * What the properties readouts measure, and the descriptors RDKit adds to
 * them (decision 235).
 *
 * ── THE SCOPE IS THE SELECTION WHEN THERE IS ONE ──────────────────────────
 *
 * Select a ring and the status bar's formula, masses and charge are the
 * ring's. The selected atoms are cut out by chem-core's `extractSelectedPart`,
 * which keeps the hydrogens they carry in the drawing, so the phenyl of
 * toluene reads C₆H₅ rather than benzene. A selection of nothing but arrows
 * or text has no atoms and leaves the scope on the whole sketch.
 *
 * The cut is memoised per molecule and per selection, so a re-render that
 * changed neither returns the SAME part — and the mass cache in
 * `@/editor/derived` and the descriptor cache below, both keyed on that part,
 * hit instead of starting again.
 *
 * ── DESCRIPTORS ARE ASKED FOR, NEVER AWAITED ──────────────────────────────
 *
 * TPSA, cLogP and the donor/acceptor counts come from RDKit's worker, and the
 * first call pays for a 6.9 MB wasm. So nothing here runs until the
 * properties popover opens, nothing in the editor awaits it, and a session
 * that never opens the popover never fetches the wasm (decision 108: it all
 * still runs locally). The promise is cached on the molecule, so reopening
 * the popover on an unchanged drawing asks nothing twice.
 *
 * ONE SPECIES OR NONE. A TPSA summed over every compound of a reaction scheme
 * is a number that describes nothing, the same objection species.ts records
 * against a scheme-wide exact mass. So a scope of several species answers
 * "select one compound" instead of a sum.
 */

import { exactMass, extractSelectedPart, species } from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";

import type { Descriptors } from "@/lib/rdkit";
import { weakCache } from "@/lib/weak-cache";

export interface PropertiesScope {
  readonly kind: "selection" | "sketch";
  /** What the readouts measure: the sketch's molecule, or the selected part. */
  readonly molecule: Molecule;
}

const partCache = weakCache<Molecule, { readonly key: string; readonly part: Molecule }>(
  "molecule",
);

/**
 * The selection's part of `mol`, or the whole sketch when no atom is
 * selected.
 *
 * ONE SLOT PER MOLECULE, keyed on the selection's ids. The selection changes
 * far more often than the molecule (every click of the select tool), and a
 * molecule that is the document's for a while is measured under one
 * selection at a time.
 */
export function propertiesScope(mol: Molecule, atomIds: readonly AtomId[]): PropertiesScope {
  const present = atomIds.filter((id) => id in mol.atoms);
  if (present.length === 0) return { kind: "sketch", molecule: mol };
  const key = [...present].sort().join(",");
  const cached = partCache.get(mol);
  if (cached !== undefined && cached.key === key) return { kind: "selection", molecule: cached.part };
  const part = extractSelectedPart(mol, present);
  partCache.set(mol, { key, part });
  return { kind: "selection", molecule: part };
}

/**
 * Why `mol` has no exact mass, in chem-core's words, or `undefined` when it
 * has one.
 *
 * `exactMass()` throws rather than substituting an average weight, and its
 * error names the element or the nuclide that is missing. The status bar's
 * em dash says THAT there is no number; this is what the popover says about
 * WHY, so the chemist knows which label to look at.
 */
export function exactMassGap(mol: Molecule): string | undefined {
  try {
    exactMass(mol);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export type DescriptorOutcome =
  | { readonly ok: true; readonly descriptors: Descriptors }
  | {
      readonly ok: false;
      readonly reason: string;
      /**
       * The worker timed out, could not start, or its chunk did not load —
       * a fact about this moment, not about the structure, so the next
       * opening asks again instead of repeating a cached refusal.
       */
      readonly transient: boolean;
    };

interface CachedDescriptors {
  readonly promise: Promise<DescriptorOutcome>;
  stale: boolean;
}

const descriptorCache = weakCache<Molecule, CachedDescriptors>("molecule");

/** The RDKit bridge, loaded on first use. Injectable for tests. */
type LoadRdkit = () => Promise<Pick<typeof import("@/lib/rdkit"), "computeDescriptors">>;

const loadRdkitBridge: LoadRdkit = () => import("@/lib/rdkit");

/**
 * TPSA, cLogP, donors and acceptors for `mol`, never rejecting.
 *
 * Every refusal is an outcome with a reason: an empty scope, a scope of
 * several species, a structure RDKit's sanitizer refuses, a worker that
 * could not start. The popover renders the reason where the numbers would
 * have been — "unavailable", never a zero.
 */
export function descriptorsFor(
  mol: Molecule,
  load: LoadRdkit = loadRdkitBridge,
): Promise<DescriptorOutcome> {
  const cached = descriptorCache.get(mol);
  if (cached !== undefined && !cached.stale) return cached.promise;
  const entry: CachedDescriptors = { promise: compute(mol, load), stale: false };
  void entry.promise.then((outcome) => {
    if (!outcome.ok && outcome.transient) entry.stale = true;
  });
  descriptorCache.set(mol, entry);
  return entry.promise;
}

async function compute(mol: Molecule, load: LoadRdkit): Promise<DescriptorOutcome> {
  if (mol.atomIds.length === 0) return { ok: false, reason: "Nothing is drawn.", transient: false };
  const count = species(mol).length;
  if (count > 1) {
    return {
      ok: false,
      reason: `These are ${String(count)} separate compounds. Select one to see its descriptors.`,
      transient: false,
    };
  }
  try {
    const { computeDescriptors } = await load();
    const result = await computeDescriptors(mol);
    if (!result.ok) {
      const transient =
        result.error.kind === "timeout" || result.error.kind === "worker-unavailable";
      return { ok: false, reason: result.error.message, transient };
    }
    return { ok: true, descriptors: result.value };
  } catch (error) {
    // A chunk that failed to load. Reported, not thrown: the popover is
    // the only place that would hear about it.
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason, transient: true };
  }
}

/**
 * Atom locants for a figure: the numbers a chemist expects beside a sugar's
 * or an amino acid's carbons, and nothing a referee could contradict.
 *
 * PRECEDENCE (decision 142):
 *
 *   1. An EXPLICIT locant the user typed, from the document-level map
 *      (`SketchDocument.locants`). An explicit empty string hides a derived
 *      locant.
 *   2. CHAIN RULES where a real convention exists: an aldose from its
 *      aldehyde carbon, a ketose from the end nearer its carbonyl, an
 *      alpha-amino acid from its carboxyl carbon (sugar.ts, amino-acid.ts).
 *   3. A sugar ring's retained numbering, propagated from its anomeric
 *      carbon, primed (1′ to 5′) for a nucleoside's sugar.
 *   4. Everything else: no locant. Never an atom's id or its position in
 *      `atomIds`, which renumber on any unrelated deletion (decision 18).
 *
 * A LOCANT IS EMITTED ONLY WHERE EVERY NUMBERING THE RULES ALLOW AGREES. The
 * chain stops before a tie rather than choosing by atom id; two units that
 * give one atom different numbers leave it unnumbered. Only backbone CARBONS
 * are numbered; an oxygen is named after its carbon (O-2), which is a label,
 * not a locant.
 *
 * Carbohydrate numbering (IUPAC-IUBMB 2-Carb-2) and amino-acid numbering
 * (3AA-1) only. Not general IUPAC locants: those need principal-chain and
 * characteristic-group selection, which is most of a naming engine.
 *
 * ONE MAP PER DOCUMENT, never per panel: the same number beside the same atom
 * in every panel of a figure. Results are records with a NULL prototype and
 * are read with `Object.hasOwn` (`locantOf`), so an atom id of "constructor"
 * resolves to nothing rather than to `Object.prototype.constructor`.
 */

import { alphaAminoAcids } from "./amino-acid.js";
import { cipTopologyFingerprint } from "./cip.js";
import { LruCache } from "./rings.js";
import { carbohydrateLocant, carbohydrates } from "./sugar.js";
import type { AtomId, Molecule } from "./types.js";

/** Where a locant came from. */
export type LocantSource = "explicit" | "carbohydrate" | "aminoAcid";

export interface AtomNumbering {
  /** Each numbered atom's locant. Null prototype: read with `Object.hasOwn`. */
  readonly locants: Readonly<Record<AtomId, string>>;
  readonly sources: Readonly<Record<AtomId, LocantSource>>;
}

interface Derived {
  readonly locants: ReadonlyMap<AtomId, string>;
  readonly sources: ReadonlyMap<AtomId, LocantSource>;
}

function computeDerived(mol: Molecule): Derived {
  const locants = new Map<AtomId, string>();
  const sources = new Map<AtomId, LocantSource>();
  const conflicted = new Set<AtomId>();
  const claim = (atomId: AtomId, locant: string, source: LocantSource): void => {
    if (conflicted.has(atomId)) return;
    const existing = locants.get(atomId);
    if (existing !== undefined && existing !== locant) {
      locants.delete(atomId);
      sources.delete(atomId);
      conflicted.add(atomId);
      return;
    }
    locants.set(atomId, locant);
    sources.set(atomId, source);
  };
  for (const unit of carbohydrates(mol)) {
    for (const atomId of unit.backbone) claim(atomId, carbohydrateLocant(unit, atomId)!, "carbohydrate");
  }
  for (const unit of alphaAminoAcids(mol)) {
    unit.backbone.forEach((atomId, i) => claim(atomId, String(i + 1), "aminoAcid"));
  }
  return { locants, sources };
}

const DERIVED_BY_INSTANCE = new WeakMap<Molecule, Derived>();
const DERIVED_BY_TOPOLOGY = new LruCache<Derived>(32);

function derived(mol: Molecule): Derived {
  const hit = DERIVED_BY_INSTANCE.get(mol);
  if (hit) return hit;
  const key = cipTopologyFingerprint(mol);
  const shared = DERIVED_BY_TOPOLOGY.get(key);
  if (shared) {
    DERIVED_BY_INSTANCE.set(mol, shared);
    return shared;
  }
  const built = computeDerived(mol);
  DERIVED_BY_TOPOLOGY.set(key, built);
  DERIVED_BY_INSTANCE.set(mol, built);
  return built;
}

/**
 * Every atom's locant: `explicit` first, then what the chain and ring rules
 * derive. `explicit` is read with `Object.hasOwn` and only for atoms `mol`
 * has, so a stale or hostile key names nothing.
 */
export function atomNumbering(
  mol: Molecule,
  explicit?: Readonly<Record<AtomId, string>>,
): AtomNumbering {
  const { locants: derivedLocants, sources: derivedSources } = derived(mol);
  const locants: Record<AtomId, string> = Object.create(null) as Record<AtomId, string>;
  const sources: Record<AtomId, LocantSource> = Object.create(null) as Record<AtomId, LocantSource>;
  for (const atomId of mol.atomIds) {
    if (explicit !== undefined && Object.hasOwn(explicit, atomId)) {
      const value = explicit[atomId];
      if (typeof value === "string") {
        if (value !== "") {
          locants[atomId] = value;
          sources[atomId] = "explicit";
        }
        continue;
      }
    }
    const locant = derivedLocants.get(atomId);
    if (locant !== undefined) {
      locants[atomId] = locant;
      sources[atomId] = derivedSources.get(atomId)!;
    }
  }
  return Object.freeze({ locants: Object.freeze(locants), sources: Object.freeze(sources) });
}

/** `atomId`'s locant, or undefined. Never resolves up a prototype chain. */
export function locantOf(numbering: AtomNumbering, atomId: AtomId): string | undefined {
  return Object.hasOwn(numbering.locants, atomId) ? numbering.locants[atomId] : undefined;
}

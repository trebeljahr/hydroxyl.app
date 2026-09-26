/**
 * The memo caches keyed on a value the store REPLACES on every edit, and the
 * one number that can tell such a cache from a leak.
 *
 * WHY THIS MODULE EXISTS RATHER THAN A `new WeakMap()` PER CALL SITE. The
 * crash report in manual notes 3 describes a heap that climbs steadily under
 * ordinary drawing. The editor's own model path has exactly one shape that
 * would do that: a cache keyed on a `SketchDocument` or a `Molecule`. Both are
 * immutable and both are minted afresh per edit, so a cache with STRONG keys
 * keeps one dead document — and its molecule, its scenes and its issue lists —
 * per edit, forever. With weak keys it keeps none.
 *
 * The two are indistinguishable from the outside. `f(m) === f(m)` holds for
 * both; the newest document has at most one entry either way. The only
 * observable difference is how many keys the container still holds, and a
 * `WeakMap` cannot be enumerated — which is exactly the point: a count is
 * available only if the container degraded to a strong one.
 *
 * WHAT `keysRetained` DOES AND DOES NOT PROVE. It is a sum over the caches
 * BUILT HERE, so it detects the regression it is named for — a `WeakMap` in
 * this module becoming a `Map`, or a new cache registered here holding keys —
 * and it detects it wherever in the app that cache lives. It is NOT a measure
 * of the process's retention: a retainer of another shape (a module-scope
 * array of documents, a plain object keyed by id, a cache someone wrote with
 * `new Map` instead of `weakCache`) contributes nothing to it and never will.
 * `weak-cache.node.test.ts` is the guard for that second gap: it reads the
 * client's source and fails if any module-scope container is keyed on a
 * `Molecule` or a `SketchDocument` without coming through here. The two
 * together are the contract; either alone is a shape check wearing a count's
 * name.
 */

/**
 * The key kinds worth tracking: the values the editor store replaces on every
 * edit. A cache keyed on anything stable — a tool id, an element symbol — is
 * bounded by its key space and is not this module's business.
 */
export type CacheKeyKind = "molecule" | "document";

/** The read/write surface a memo needs. Deliberately narrower than `WeakMap`:
 *  nothing outside may iterate or clear a cache, and a caller that only sees
 *  this cannot accidentally depend on the container's identity. */
export interface WeakCache<K extends object, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
}

interface Registered {
  readonly kind: CacheKeyKind;
  readonly container: object;
}

const registered: Registered[] = [];

/**
 * A weakly-keyed memo that counts towards `keysRetained(kind)`.
 *
 * Registration happens at construction, so enrolment cannot be forgotten
 * separately from creation — the hardcoded list this replaces could be, and a
 * cache missing from it reported zero while holding thousands.
 */
export function weakCache<K extends object, V>(kind: CacheKeyKind): WeakCache<K, V> {
  const container = new WeakMap<K, V>();
  registered.push({ kind, container });
  return container;
}

/**
 * How many keys of `kind` the caches built here are holding strongly.
 *
 * Zero while they are weakly keyed, on every platform and at every heap size,
 * because a `WeakMap` has no `size` to report. A non-zero answer means one of
 * them is a strong container, and the number is its population.
 */
export function keysRetained(kind: CacheKeyKind): number {
  let total = 0;
  for (const entry of registered) {
    if (entry.kind !== kind) continue;
    // `instanceof Map` rather than a `size` duck-check: a `WeakMap` has no
    // `size`, so this is true exactly when the container is a strong one.
    total += entry.container instanceof Map ? entry.container.size : 0;
  }
  return total;
}

/**
 * Frames against one molecule: canonical views, resolution, coverage.
 *
 * RESOLUTION IS TOTAL AND NEVER THROWS. A panel's view is saved with the
 * document and outlives the edits made after it: the ring it names loses an
 * atom, the backbone gains a branch, the sighted bond is deleted. Every name
 * is therefore checked with `Object.hasOwn` BEFORE any traversal touches it,
 * and a name that no longer resolves is an `unavailable` with the ids to fix,
 * never an exception from inside a ring walk.
 *
 * A RING IS NAMED BY ITS ATOM-ID SET, resolved here at projection time
 * against `rings(mol)` — never by an index into that list. Perception is
 * derived, the symmetrised SSSR can change the ring COUNT, and indices
 * renumber on any topology edit, so an index would silently retarget. The set
 * resolves exactly when it IS a perceived ring; a part of a ring (one atom,
 * say) resolves when exactly one perceived ring contains it; and when several
 * do, or the set is empty and the molecule has several rings, the answer is
 * `needsChoice` with every candidate, never a guess by list position.
 *
 * Everything here reads TOPOLOGY only, which is what lets the engine cache it
 * across a drag (engine.ts).
 */

import { isKnownElement } from "../elements.js";
import { bondBetween, neighborIds } from "../molecule.js";
import { rings } from "../rings.js";
import { compareIds } from "../selection.js";
import {
  stereoTopology,
  type CentreReading,
  type DoubleBondReading,
  type StereoConfig,
} from "../stereo-config.js";
import type { AtomId, BondId, Molecule } from "../types.js";
import {
  PROJECTION_TEMPLATES,
  type ProjectionAvailability,
  type ProjectionCoverage,
  type ProjectionUnavailable,
  type ProjectionUnavailableReason,
  type ProjectionView,
  type ResolvedProjectionFrame,
  type SightedBondReferenceFallback,
  type StereoUnitRef,
} from "./types.js";

// ---------------------------------------------------------------------------
// Canonical views
// ---------------------------------------------------------------------------

/**
 * An angle in degrees, in [0, 360). 370 and 10 are one view, and so are −60
 * and 300; −0 becomes 0 so the two serialise alike. Undefined for a value
 * that is not a finite number.
 */
export function canonicalDegrees(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const turned = value % 360;
  const positive = turned < 0 ? turned + 360 : turned;
  // `x % 360` of a value just under a multiple of 360 can round to 360.
  return positive >= 360 || positive === 0 ? 0 : positive;
}

function sortedUnique<T extends string>(ids: readonly T[]): T[] {
  return [...new Set(ids)].sort(compareIds);
}

/**
 * `view` in its one canonical spelling: angles in [0, 360), a ring's atoms and
 * an overlay's bonds as sorted sets, no key holding `undefined`. Two views
 * that draw the same picture canonicalise to deep-equal values, which is what
 * the engine's cache keys on. `invalid-parameter` for an angle that is not a
 * finite number.
 */
export function canonicalProjectionView(
  view: ProjectionView,
): ProjectionView | ProjectionUnavailable {
  switch (view.kind) {
    case "planar": {
      const rotationDeg = canonicalDegrees(view.params.rotationDeg);
      if (rotationDeg === undefined) return projectionUnavailable("invalid-parameter");
      return {
        kind: "planar",
        template: view.template,
        frame: {},
        params: { rotationDeg, mirror: view.params.mirror === true },
      };
    }
    case "chain":
      return {
        kind: "chain",
        template: view.template,
        frame: { backbone: [...view.frame.backbone] },
        params: { top: view.params.top === "last" ? "last" : "first" },
      };
    case "ring": {
      const frame =
        view.frame.referenceAtomId === undefined
          ? { ringAtomIds: sortedUnique(view.frame.ringAtomIds) }
          : {
              ringAtomIds: sortedUnique(view.frame.ringAtomIds),
              referenceAtomId: view.frame.referenceAtomId,
            };
      const face = view.params.face === "back" ? "back" : "front";
      const conformer = view.params.conformer;
      return {
        kind: "ring",
        template: view.template,
        frame,
        params:
          conformer === undefined
            ? { face }
            : { face, conformer: { form: conformer.form, frontAtomId: conformer.frontAtomId } },
      };
    }
    case "sightedBond": {
      const torsionDeg = canonicalDegrees(view.params.torsionDeg);
      const rollDeg = canonicalDegrees(view.params.rollDeg);
      if (torsionDeg === undefined || rollDeg === undefined) return projectionUnavailable("invalid-parameter");
      return {
        kind: "sightedBond",
        template: view.template,
        frame: {
          front: view.frame.front,
          back: view.frame.back,
          ...(view.frame.frontReference === undefined ? {} : { frontReference: view.frame.frontReference }),
          ...(view.frame.backReference === undefined ? {} : { backReference: view.frame.backReference }),
        },
        params: { torsionDeg, rollDeg },
      };
    }
    case "annotationOverlay":
      return {
        kind: "annotationOverlay",
        template: view.template,
        frame: { bondIds: sortedUnique(view.frame.bondIds) },
        params: {},
      };
  }
}

/** Whether `template` is one of `kind`'s listed templates (a view from a file). */
export function isListedProjectionTemplate(view: ProjectionView): boolean {
  const listed: readonly string[] = PROJECTION_TEMPLATES[view.kind];
  return listed.includes(view.template);
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

const NO_IDS: readonly string[] = Object.freeze([]);

export function projectionUnavailable(
  reason: ProjectionUnavailableReason,
  atomIds: readonly AtomId[] = NO_IDS,
  bondIds: readonly BondId[] = NO_IDS,
): ProjectionUnavailable {
  return Object.freeze({
    kind: "unavailable",
    reason,
    atomIds: Object.freeze([...atomIds]),
    bondIds: Object.freeze([...bondIds]),
  });
}

/** Named atoms the molecule does not have. `Object.hasOwn`, so "constructor" is missing. */
function missingAtoms(mol: Molecule, ids: readonly AtomId[]): AtomId[] {
  return sortedUnique(ids.filter((id) => !Object.hasOwn(mol.atoms, id)));
}

/**
 * Resolves a CANONICAL view's frame against `mol`: every name checked, a ring
 * set turned into its walk, and the coverage the frame reaches. Topology only.
 *
 * An atom whose element the table does not know (an "R" placeholder) has no
 * valence, so no hydrogens and no stereo topology: every frame is refused
 * for it up front, the question `representationAvailability` asks first too,
 * rather than letting the traversal below throw.
 */
export function resolveCanonicalProjectionFrame(mol: Molecule, view: ProjectionView): ProjectionAvailability {
  if (mol.atomIds.length === 0) return projectionUnavailable("empty-molecule");
  const unknown = mol.atomIds.filter((id) => {
    const atom = Object.hasOwn(mol.atoms, id) ? mol.atoms[id] : undefined;
    return atom === undefined || !isKnownElement(atom.element);
  });
  if (unknown.length > 0) return projectionUnavailable("unknown-element", unknown);
  switch (view.kind) {
    case "planar":
      return resolved({ kind: "planar" }, wholeCoverage(mol));
    case "annotationOverlay": {
      const missing = view.frame.bondIds.filter((id) => !Object.hasOwn(mol.bonds, id));
      if (missing.length > 0) return projectionUnavailable("missing-bond", NO_IDS, missing);
      return resolved({ kind: "annotationOverlay", bondIds: view.frame.bondIds }, wholeCoverage(mol));
    }
    case "chain":
      return resolveChain(mol, view.frame.backbone);
    case "ring":
      return resolveRing(mol, view.frame.ringAtomIds, view.frame.referenceAtomId);
    case "sightedBond":
      return resolveSightedBond(mol, view.frame);
  }
}

function resolved(frame: ResolvedProjectionFrame, coverage: ProjectionCoverage): ProjectionAvailability {
  return Object.freeze({ kind: "available", frame: Object.freeze(frame), coverage });
}

function resolveChain(mol: Molecule, backbone: readonly AtomId[]): ProjectionAvailability {
  const missing = missingAtoms(mol, backbone);
  if (missing.length > 0) return projectionUnavailable("missing-atom", missing);
  const seen = new Set<AtomId>();
  const repeated = new Set<AtomId>();
  for (const id of backbone) (seen.has(id) ? repeated : seen).add(id);
  if (repeated.size > 0) return projectionUnavailable("repeated-atom", sortedUnique([...repeated]));
  if (backbone.length < 3) return projectionUnavailable("backbone-too-short", backbone);
  for (let i = 0; i + 1 < backbone.length; i++) {
    const a = backbone[i]!;
    const b = backbone[i + 1]!;
    if (bondBetween(mol, a, b) === undefined) return projectionUnavailable("not-a-path", [a, b]);
  }
  // A bond between two backbone atoms that are not neighbours in the list
  // closes a ring through the backbone, which no vertical chain can draw.
  const index = new Map(backbone.map((id, i) => [id, i]));
  for (let i = 0; i < backbone.length; i++) {
    const id = backbone[i]!;
    for (const other of neighborIds(mol, id)) {
      const j = index.get(other);
      if (j !== undefined && Math.abs(i - j) > 1) {
        return projectionUnavailable("backbone-in-ring", sortedUnique([id, other]));
      }
    }
  }
  // A Fischer's termini are condensed groups, so only interior atoms are
  // drawn as a crossing with a configuration of their own.
  const interior = new Set(backbone.slice(1, -1));
  return resolved(
    { kind: "chain", backbone: Object.freeze([...backbone]) },
    coverageOf(mol, (id) => interior.has(id), () => false),
  );
}

/**
 * The ring a set names: exactly, when the set is a perceived ring; otherwise
 * every perceived ring containing it — and the reference atom, when one is
 * named — as candidates. A reference atom is part of what the frame says:
 * offering a ring without it would offer a choice that then fails.
 */
function resolveRing(
  mol: Molecule,
  ringAtomIds: readonly AtomId[],
  referenceAtomId: AtomId | undefined,
): ProjectionAvailability {
  const named = referenceAtomId === undefined ? ringAtomIds : [...ringAtomIds, referenceAtomId];
  const missing = missingAtoms(mol, named);
  if (missing.length > 0) return projectionUnavailable("missing-atom", missing);

  const perceived = rings(mol);
  if (perceived.length === 0) return projectionUnavailable("no-ring");
  const wanted = new Set(ringAtomIds);
  const exact = perceived.find(
    (ring) => ring.atomIds.length === wanted.size && ring.atomIds.every((id) => wanted.has(id)),
  );
  const contained = new Set(named);
  const candidates =
    exact !== undefined
      ? [exact]
      : perceived.filter((ring) => [...contained].every((id) => ring.atomIds.includes(id)));
  if (candidates.length === 0) return projectionUnavailable("not-a-ring", sortedUnique(named));
  if (candidates.length > 1) {
    const position = new Map(mol.atomIds.map((id, i) => [id, i]));
    const ordered = [...candidates].sort((p, q) => {
      // Fixed by the atoms alone: first atom's place in the molecule, then size.
      const byFirst = position.get(p.atomIds[0]!)! - position.get(q.atomIds[0]!)!;
      if (byFirst !== 0) return byFirst;
      if (p.size !== q.size) return p.size - q.size;
      return p.atomIds.join("\u0000") < q.atomIds.join("\u0000") ? -1 : 1;
    });
    return Object.freeze({
      kind: "needsChoice",
      choice: "ring",
      candidates: Object.freeze(ordered.map((ring) => Object.freeze([...ring.atomIds]))),
    });
  }
  const ring = candidates[0]!;
  const reference = referenceAtomId ?? ring.atomIds[0]!;
  if (!ring.atomIds.includes(reference)) return projectionUnavailable("not-a-ring", [reference]);
  const members = new Set(ring.atomIds);
  return resolved(
    {
      kind: "ring",
      ringAtomIds: Object.freeze([...ring.atomIds]),
      referenceAtomId: reference,
    },
    coverageOf(mol, (id) => members.has(id), () => false),
  );
}

/**
 * A sighted bond: both ends must exist and be bonded, or the frame is
 * unavailable. Its stored reference substituents are softer: an omitted one,
 * a deleted one, or one an edit has moved off its end falls back to that
 * end's lowest-id substituent, and the resolution lists the fallback rather
 * than refusing the panel (the picture turns; the chemistry is unchanged).
 */
function resolveSightedBond(
  mol: Molecule,
  frame: {
    readonly front: AtomId;
    readonly back: AtomId;
    readonly frontReference?: AtomId;
    readonly backReference?: AtomId;
  },
): ProjectionAvailability {
  const { front, back } = frame;
  const missing = missingAtoms(mol, [front, back]);
  if (missing.length > 0) return projectionUnavailable("missing-atom", missing);
  const bond = front === back ? undefined : bondBetween(mol, front, back);
  if (bond === undefined) return projectionUnavailable("not-bonded", sortedUnique([front, back]));

  const fallbacks: SightedBondReferenceFallback[] = [];
  const reference = (end: "front" | "back", atomId: AtomId, other: AtomId, stored: AtomId | undefined) => {
    const substituents = neighborIds(mol, atomId)
      .filter((id) => id !== other)
      .sort(compareIds);
    if (stored !== undefined && Object.hasOwn(mol.atoms, stored) && substituents.includes(stored)) return stored;
    const reason: SightedBondReferenceFallback["reason"] =
      stored === undefined ? "omitted" : Object.hasOwn(mol.atoms, stored) ? "not-a-substituent" : "missing-atom";
    fallbacks.push(Object.freeze({ end, reason }));
    return substituents[0];
  };
  const frontReference = reference("front", front, back, frame.frontReference);
  const backReference = reference("back", back, front, frame.backReference);

  const ends = new Set([front, back]);
  return resolved(
    {
      kind: "sightedBond",
      front,
      back,
      bondId: bond.id,
      ...(frontReference === undefined ? {} : { frontReference }),
      ...(backReference === undefined ? {} : { backReference }),
      referenceFallbacks: Object.freeze(fallbacks),
    },
    coverageOf(mol, (id) => ends.has(id), (id) => id === bond.id),
  );
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

function wholeCoverage(mol: Molecule): ProjectionCoverage {
  return coverageOf(mol, () => true, () => true);
}

function coverageOf(
  mol: Molecule,
  centre: (atomId: AtomId) => boolean,
  doubleBond: (bondId: BondId) => boolean,
): ProjectionCoverage {
  const topology = stereoTopology(mol);
  return Object.freeze({
    centres: Object.freeze(sortedUnique(topology.centres.map((c) => c.atomId).filter(centre))),
    doubleBonds: Object.freeze(sortedUnique(topology.doubleBonds.map((b) => b.bondId).filter(doubleBond))),
  });
}

/**
 * `config` with only the units `coverage` names — the restriction operator
 * the round-trip law is stated through. Units outside are UNREPORTED, not
 * unspecified: they are absent, not present with an `undetermined` reading.
 * `unrepresentable` is a property of the molecule, not of a unit, and stays.
 */
export function restrictStereoConfig(config: StereoConfig, coverage: ProjectionCoverage): StereoConfig {
  const centres = new Set(coverage.centres);
  const doubleBonds = new Set(coverage.doubleBonds);
  return Object.freeze({
    centres: Object.freeze(config.centres.filter((c) => centres.has(c.atomId))),
    doubleBonds: Object.freeze(config.doubleBonds.filter((b) => doubleBonds.has(b.bondId))),
    unrepresentable: config.unrepresentable,
  });
}

/**
 * Every unit of `coverage` on which `actual` does not state what `expected`
 * does: a different parity or relation, a mixture against a specified
 * reading, a unit missing from one side. Two undetermined readings agree
 * whatever their reasons, because a Fischer and a wedge drawing refuse the
 * same centre for different reasons and neither states it.
 */
export function stereoDisagreements(
  expected: StereoConfig,
  actual: StereoConfig,
  coverage: ProjectionCoverage,
): readonly StereoUnitRef[] {
  const out: StereoUnitRef[] = [];
  const expectedCentres = new Map(expected.centres.map((c) => [c.atomId, c.reading]));
  const actualCentres = new Map(actual.centres.map((c) => [c.atomId, c.reading]));
  for (const atomId of coverage.centres) {
    if (!centreReadingsAgree(expectedCentres.get(atomId), actualCentres.get(atomId))) {
      out.push({ kind: "centre", atomId });
    }
  }
  const expectedBonds = new Map(expected.doubleBonds.map((b) => [b.bondId, b.reading]));
  const actualBonds = new Map(actual.doubleBonds.map((b) => [b.bondId, b.reading]));
  for (const bondId of coverage.doubleBonds) {
    if (!bondReadingsAgree(expectedBonds.get(bondId), actualBonds.get(bondId))) {
      out.push({ kind: "doubleBond", bondId });
    }
  }
  return Object.freeze(out);
}

function centreReadingsAgree(a: CentreReading | undefined, b: CentreReading | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "specified" && b.kind === "specified") return a.parity === b.parity;
  return true;
}

function bondReadingsAgree(a: DoubleBondReading | undefined, b: DoubleBondReading | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "specified" && b.kind === "specified") return a.relation === b.relation;
  return true;
}

/**
 * The projection engine: `project` a molecule and its configuration into a
 * view, and `readProjection` the configuration back out of the result.
 *
 * `project(mol, config, view)` FACTORS INTO TWO STEPS, and the factoring is
 * the firewall decision 12 asks for:
 *
 *   placeConfiguration   the template's `place`: positions and marks chosen
 *                        so the layout states `config`, checked by reading
 *                        the draft back through the template's convention.
 *   applyConformation    what a panel may change WITHOUT touching
 *                        configuration: a rotation about a sighted bond, a
 *                        swapped pucker. It only ever moves one rigid tripod
 *                        about its own axis or negates a pucker sign, both of
 *                        which preserve every parity by construction. Every
 *                        template built today has its conformation fixed by
 *                        convention (a planar drawing; a Fischer, eclipsed by
 *                        definition), so every arm is the identity today;
 *                        the torsion and ring-conformer arms are typed now
 *                        (a panel can store them) and act once the Newman
 *                        and chair templates land, inside that same contract.
 *
 * THEN IT CHECKS ITSELF (decision 146). The finished draft is read back, and
 * every unit on which it does not state what `config` states leaves the
 * layout's coverage for `unplaced`. `readProjection` reports exactly the
 * layout's coverage, so the round-trip law
 *
 *     restrict(readProjection(mol, project(mol, C, V)), cov) = restrict(C, cov)
 *
 * holds by construction for `cov = layout.coverage`, and a harness checking
 * it must also check that `unplaced` is empty — the law alone is passed by a
 * layout that placed nothing. The reader never falls back to `config` for a
 * unit it cannot read; that fallback is the trap that makes such a suite
 * green while proving nothing.
 *
 * MEMOISED IN TWO LAYERS, split like stereo-config's cache (decision 19):
 *
 *   TOPOLOGY  frame resolution and the template's skeleton — which ring, which
 *             atoms fold into which label, which ids the derived nodes get —
 *             keyed on cip.ts's topology fingerprint plus the canonical view,
 *             in an LRU behind an instance WeakMap. A drag produces a fresh
 *             Molecule per pointer frame with only positions changed and
 *             reuses it; `projectionTopologyComputationCount` counts real work.
 *   RESULT    the finished `ProjectionResult`, per molecule instance, per
 *             configuration instance, per view, so asking again for the same
 *             panel returns the same object. BOUNDED per configuration
 *             (`RESULTS_PER_CONFIGURATION` views, least recently used out): a
 *             page-turn or torsion gesture asks for a new view every pointer
 *             frame of one unchanged molecule, and an unbounded map would
 *             keep every frame's layout until the next edit.
 *
 * COLLISIONS ARE REPORTED, NEVER NUDGED. Two nodes nearer than
 * `LAYOUT_COLLISION_DISTANCE` bond lengths are listed in `collisions`, and
 * nothing moves: a crowded Fischer arm or a 1,3-diaxial pair is the chemistry
 * the figure shows, and an export that nudged would stop matching the
 * template a reader recognises.
 *
 * NOTHING HERE SCALES TO PX OR NEGATES A Y. Layouts are model units, y up;
 * chem-render's `modelToPx` is the only conversion, as for a drawn molecule.
 */

import { cipTopologyFingerprint } from "../cip.js";
import { LruCache } from "../rings.js";
import { compareIds } from "../selection.js";
import { speciesJoinsOf } from "../species.js";
import {
  readConfig,
  stereoTopology,
  type ConfigRead,
  type StereoConfig,
} from "../stereo-config.js";
import type { AtomId, BondId, Molecule } from "../types.js";
import type { Vec2 } from "../vec.js";
import { chainFischerTemplate } from "./fischer.js";
import {
  canonicalProjectionView,
  isListedProjectionTemplate,
  resolveCanonicalProjectionFrame,
  restrictStereoConfig,
  stereoDisagreements,
  projectionUnavailable,
} from "./frames.js";
import { planarMillsTemplate } from "./mills.js";
import { planarWedgeDashTemplate } from "./planar.js";
import { planarSteroidTemplate } from "./steroid-panel.js";
import {
  draftLayoutAccess,
  placementOfLayout,
  type LayoutAccess,
  type PlacedLayout,
  type ProjectionTemplateImplementation,
  type ProjectionTemplateResolution,
} from "./template.js";
import {
  LAYOUT_COLLISION_DISTANCE,
  type Conformation,
  type LayoutCollision,
  type ProjectedLayout,
  type ProjectionAvailability,
  type ProjectionCoverage,
  type ProjectionResult,
  type ProjectionView,
  type StereoUnitRef,
  type UnplacedUnit,
} from "./types.js";

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * The built templates (decision 148), by `kind/template`. A listed template
 * with no entry here projects as `template-not-built`.
 */
const TEMPLATES: Readonly<Record<string, ProjectionTemplateImplementation<ProjectionView, unknown>>> = {
  "planar/wedgeDash": planarWedgeDashTemplate as ProjectionTemplateImplementation<ProjectionView, unknown>,
  "planar/mills": planarMillsTemplate as ProjectionTemplateImplementation<ProjectionView, unknown>,
  "planar/steroid": planarSteroidTemplate as ProjectionTemplateImplementation<ProjectionView, unknown>,
  "chain/fischer": chainFischerTemplate as ProjectionTemplateImplementation<ProjectionView, unknown>,
};

function templateFor(view: ProjectionView): ProjectionTemplateImplementation<ProjectionView, unknown> | undefined {
  const key = `${view.kind}/${view.template}`;
  return Object.hasOwn(TEMPLATES, key) ? TEMPLATES[key] : undefined;
}

// ---------------------------------------------------------------------------
// The topology layer
// ---------------------------------------------------------------------------

interface TopologyRecord {
  readonly frame: ProjectionAvailability;
  /** Undefined when the frame did not resolve or the template is not built. */
  readonly template: ProjectionTemplateResolution<unknown> | undefined;
}

const TOPOLOGY_BY_INSTANCE = new WeakMap<Molecule, Map<string, TopologyRecord>>();
const TOPOLOGY_BY_KEY = new LruCache<TopologyRecord>(64);
let topologyComputations = 0;

/**
 * The part of a canonical view the topology layer depends on: the template
 * and its frame, plus a chain's top end (it orders the skeleton). A page
 * rotation, a mirror, a ring's face and a torsion are left out, so a drag of
 * any of them re-uses the skeleton every frame. A template's `resolve` reads
 * nothing else of the view — that is the contract this key encodes.
 */
function topologyViewKey(view: ProjectionView): string {
  switch (view.kind) {
    case "planar":
      // The accepted skeletons are topology: which atoms are each core,
      // checked against the molecule (decisions 163, 195).
      return JSON.stringify([view.kind, view.template, view.params.skeletons ?? null]);
    case "chain":
      return JSON.stringify([view.kind, view.template, view.frame, view.params.top]);
    case "ring":
    case "sightedBond":
    case "annotationOverlay":
      return JSON.stringify([view.kind, view.template, view.frame]);
  }
}

function topologyRecord(mol: Molecule, view: ProjectionView): TopologyRecord {
  const viewKey = topologyViewKey(view);
  let perInstance = TOPOLOGY_BY_INSTANCE.get(mol);
  const hit = perInstance?.get(viewKey);
  if (hit !== undefined) return hit;
  // Species joins are topology too: accepted skeletons are checked one per
  // species (decision 220), and the CIP fingerprint leaves the joins out.
  const key = `${cipTopologyFingerprint(mol)}\u0000${JSON.stringify(speciesJoinsOf(mol))}\u0000${viewKey}`;
  let record = TOPOLOGY_BY_KEY.get(key);
  if (record === undefined) {
    // Incremented here and nowhere else, so a cache hit never looks like work.
    topologyComputations++;
    const frame = resolveCanonicalProjectionFrame(mol, view);
    const template = frame.kind === "available" ? templateFor(view)?.resolve(mol, view, frame.frame) : undefined;
    record = Object.freeze({ frame, template });
    TOPOLOGY_BY_KEY.set(key, record);
  }
  if (perInstance === undefined) {
    perInstance = new Map();
    TOPOLOGY_BY_INSTANCE.set(mol, perInstance);
  }
  perInstance.set(viewKey, record);
  return record;
}

/** Testing hook: how many times the topology layer has actually run. */
export function projectionTopologyComputationCount(): number {
  return topologyComputations;
}

/** Testing hook. The counter is process-global, so each assertion resets. */
export function resetProjectionTopologyComputationCount(): void {
  topologyComputations = 0;
}

/**
 * Whether `view`'s FRAME resolves against `mol`, and what it reaches:
 * `available` with the resolved frame and coverage, `needsChoice` with the
 * candidates, or `unavailable` with the ids to fix. Never throws, and never
 * looks at the configuration or at positions.
 */
export function resolveProjectionFrame(mol: Molecule, view: ProjectionView): ProjectionAvailability {
  const canonical = canonicalProjectionView(view);
  if (canonical.kind === "unavailable") return canonical;
  return topologyRecord(mol, canonical).frame;
}

/** The units `view`'s frame reaches in `mol`, or undefined when it does not resolve. */
export function projectionCoverage(mol: Molecule, view: ProjectionView): ProjectionCoverage | undefined {
  const resolved = resolveProjectionFrame(mol, view);
  return resolved.kind === "available" ? resolved.coverage : undefined;
}

// ---------------------------------------------------------------------------
// project
// ---------------------------------------------------------------------------

/**
 * Views remembered per (molecule, configuration). Well above the panels one
 * figure shows of one molecule (a planar, a Fischer, a Haworth, a Newman and
 * a chair each at most twice), so a figure re-rendering every panel per frame
 * never evicts its own, and well below a gesture's hundreds of frames.
 */
export const RESULTS_PER_CONFIGURATION = 16;

const RESULTS = new WeakMap<Molecule, WeakMap<StereoConfig, LruCache<ProjectionResult>>>();

const NO_CONFORMATION: Conformation = Object.freeze({ kind: "none" });

/**
 * The layout of `mol` stating `config` in `view`, or why there is none.
 *
 * `config` is normally `stereoConfig(mol)`, the configuration the drawing
 * states; a configuration read from another panel is what cross-porting
 * passes. Its units must be `mol`'s own (same ligands, same references), or
 * the answer is `config-mismatch`. A unit the frame reaches that `config`
 * does not mention is unreported in `config`, so the layout does not state it
 * either and lists it `unspecified-in-config`.
 *
 * `conformation` overrides the view's own for a live gesture that has not
 * been committed to the panel yet; omitted, the view's is used.
 */
export function project(
  mol: Molecule,
  config: StereoConfig,
  view: ProjectionView,
  conformation?: Conformation,
): ProjectionResult {
  const canonical = canonicalProjectionView(view);
  if (canonical.kind === "unavailable") return canonical;
  const viewKey = JSON.stringify(canonical);
  const conformed = conformation ?? conformationOf(canonical);
  const resultKey = `${viewKey}\u0000${JSON.stringify(conformed)}`;

  let byConfig = RESULTS.get(mol);
  const cached = byConfig?.get(config)?.get(resultKey);
  if (cached !== undefined) return cached;

  const result = computeProjection(mol, config, canonical, conformed);
  if (byConfig === undefined) {
    byConfig = new WeakMap();
    RESULTS.set(mol, byConfig);
  }
  let byView = byConfig.get(config);
  if (byView === undefined) {
    byView = new LruCache<ProjectionResult>(RESULTS_PER_CONFIGURATION);
    byConfig.set(config, byView);
  }
  byView.set(resultKey, result);
  return result;
}

/**
 * The conformation a view stores: a torsion for a sighted bond, a ring's
 * conformer when it names one, else none.
 */
function conformationOf(view: ProjectionView): Conformation {
  if (view.kind === "sightedBond") return { kind: "torsion", torsionDeg: view.params.torsionDeg };
  if (view.kind === "ring" && view.params.conformer !== undefined) {
    return { kind: "ringConformer", conformer: view.params.conformer };
  }
  return NO_CONFORMATION;
}

function computeProjection(
  mol: Molecule,
  config: StereoConfig,
  view: ProjectionView,
  conformation: Conformation,
): ProjectionResult {
  if (!isListedProjectionTemplate(view)) return projectionUnavailable("template-not-built");
  const topology = topologyRecord(mol, view);
  if (topology.frame.kind !== "available") return topology.frame;
  const template = templateFor(view);
  if (template === undefined || topology.template === undefined) return projectionUnavailable("template-not-built");
  if (topology.template.kind !== "available") return topology.template;
  const refusal = template.refuseParams?.(view);
  if (refusal !== undefined) return refusal;

  const mismatch = configMismatch(mol, config);
  if (mismatch !== undefined) return mismatch;

  // Only what the configuration states is placed; a unit it does not mention
  // is not the layout's to state.
  const frameCoverage = topology.frame.coverage;
  const stated = new Set(config.centres.map((c) => c.atomId));
  const statedBonds = new Set(config.doubleBonds.map((b) => b.bondId));
  const toPlace: ProjectionCoverage = {
    centres: frameCoverage.centres.filter((id) => stated.has(id)),
    doubleBonds: frameCoverage.doubleBonds.filter((id) => statedBonds.has(id)),
  };

  const placed = placeConfiguration(template, mol, config, view, topology.template.skeleton, toPlace, frameCoverage);
  const conformed = applyConformationToDraft(placed, conformation);
  const unmentioned: UnplacedUnit[] = [
    ...frameCoverage.centres
      .filter((atomId) => !stated.has(atomId))
      .map((atomId): UnplacedUnit => ({ unit: { kind: "centre", atomId }, reason: "unspecified-in-config" })),
    ...frameCoverage.doubleBonds
      .filter((bondId) => !statedBonds.has(bondId))
      .map((bondId): UnplacedUnit => ({ unit: { kind: "doubleBond", bondId }, reason: "unspecified-in-config" })),
  ];
  return Object.freeze({
    kind: "available",
    layout: finishLayout(mol, config, view, conformed, frameCoverage, unmentioned),
  });
}

/** Step one of `project`: the template places the configuration. */
function placeConfiguration(
  template: ProjectionTemplateImplementation<ProjectionView, unknown>,
  mol: Molecule,
  config: StereoConfig,
  view: ProjectionView,
  skeleton: unknown,
  toPlace: ProjectionCoverage,
  reach: ProjectionCoverage,
): PlacedLayout {
  return template.place(mol, config, view, skeleton, toPlace, reach);
}

/**
 * Step two: the conformation. Every built template's is fixed by convention,
 * so this is the identity for all of them; a torsion or a ring conformer
 * asked of a planar or Fischer layout has nothing to move and changes
 * nothing.
 */
function applyConformationToDraft(draft: PlacedLayout, conformation: Conformation): PlacedLayout {
  switch (conformation.kind) {
    case "none":
    case "torsion":
    case "ringConformer":
      return draft;
  }
}

/**
 * `layout` in `conformation`: the public face of `project`'s second step,
 * for a caller holding a finished layout (the harness's negative law,
 * read(applyConformation(L, k)) = read(L)). Returns the layout BY REFERENCE
 * when there is nothing to change, which today is always.
 */
export function applyConformation(layout: ProjectedLayout, conformation: Conformation): ProjectedLayout {
  switch (conformation.kind) {
    case "none":
    case "torsion":
    case "ringConformer":
      return layout;
  }
}

/**
 * `config-mismatch` when `config` names a unit `mol` does not have, or names
 * it with other ligands or references — a configuration from another
 * molecule would otherwise be placed against the wrong neighbours.
 */
function configMismatch(mol: Molecule, config: StereoConfig): ProjectionResult | undefined {
  const topology = stereoTopology(mol);
  const centres = new Map(topology.centres.map((c) => [c.atomId, c]));
  const bad: AtomId[] = [];
  for (const centre of config.centres) {
    const own = centres.get(centre.atomId);
    if (
      own === undefined ||
      own.implicitHydrogen !== centre.implicitHydrogen ||
      own.lonePair !== centre.lonePair ||
      own.order.length !== centre.order.length ||
      own.order.some((id, i) => id !== centre.order[i])
    ) {
      bad.push(centre.atomId);
    }
  }
  const bonds = new Map(topology.doubleBonds.map((b) => [b.bondId, b]));
  const badBonds: BondId[] = [];
  for (const unit of config.doubleBonds) {
    const own = bonds.get(unit.bondId);
    if (own === undefined || own.refOnFrom !== unit.refOnFrom || own.refOnTo !== unit.refOnTo) {
      badBonds.push(unit.bondId);
    }
  }
  if (bad.length === 0 && badBonds.length === 0) return undefined;
  return projectionUnavailable("config-mismatch", bad, badBonds);
}

// ---------------------------------------------------------------------------
// Finishing: verify, order, freeze
// ---------------------------------------------------------------------------

function finishLayout(
  mol: Molecule,
  config: StereoConfig,
  view: ProjectionView,
  draft: PlacedLayout,
  frameCoverage: ProjectionCoverage,
  unmentioned: readonly UnplacedUnit[],
): ProjectedLayout {
  const unplaced = new Map<string, UnplacedUnit>();
  const keyOf = (unit: StereoUnitRef): string =>
    unit.kind === "centre" ? `c\u0000${unit.atomId}` : `d\u0000${unit.bondId}`;
  for (const entry of [...unmentioned, ...draft.unplaced]) {
    if (!unplaced.has(keyOf(entry.unit))) unplaced.set(keyOf(entry.unit), entry);
  }

  // The read-back (decision 146): whatever the template claims, the layout
  // states only what it can be read to state. The read is scoped to the
  // claim (decision 171), so an atom the layout does not draw, at the
  // molecule's own coordinates, can never refuse it.
  const claimed: ProjectionCoverage = {
    centres: frameCoverage.centres.filter((atomId) => !unplaced.has(keyOf({ kind: "centre", atomId }))),
    doubleBonds: frameCoverage.doubleBonds.filter((bondId) => !unplaced.has(keyOf({ kind: "doubleBond", bondId }))),
  };
  const read = readConfig(placementOfLayout(mol, draftLayoutAccess(draft)), draft.convention, claimed);
  const disagreeing =
    read.kind === "read"
      ? stereoDisagreements(restrictStereoConfig(config, claimed), read.config, claimed)
      : [
          ...claimed.centres.map((atomId): StereoUnitRef => ({ kind: "centre", atomId })),
          ...claimed.doubleBonds.map((bondId): StereoUnitRef => ({ kind: "doubleBond", bondId })),
        ];
  for (const unit of disagreeing) unplaced.set(keyOf(unit), { unit, reason: "not-reproduced" });

  const coverage: ProjectionCoverage = Object.freeze({
    centres: Object.freeze(claimed.centres.filter((atomId) => !unplaced.has(keyOf({ kind: "centre", atomId })))),
    doubleBonds: Object.freeze(
      claimed.doubleBonds.filter((bondId) => !unplaced.has(keyOf({ kind: "doubleBond", bondId }))),
    ),
  });

  return freezeLayout(mol, view, draft, coverage, orderedUnplaced([...unplaced.values()]));
}

function orderedUnplaced(entries: readonly UnplacedUnit[]): readonly UnplacedUnit[] {
  const sorted = [...entries].sort((p, q) => {
    if (p.unit.kind !== q.unit.kind) return p.unit.kind === "centre" ? -1 : 1;
    const a = p.unit.kind === "centre" ? p.unit.atomId : p.unit.bondId;
    const b = q.unit.kind === "centre" ? q.unit.atomId : q.unit.bondId;
    return compareIds(a, b);
  });
  return Object.freeze(
    sorted.map((entry) => Object.freeze({ unit: Object.freeze(entry.unit), reason: entry.reason })),
  );
}

/**
 * The draft as a frozen value in the engine's one order: source atoms in
 * `mol.atomIds` order, then derived nodes by their host's place in it (ties
 * by id); source bonds in `mol.bondIds` order, then derived lines in their
 * nodes' order. Two runs therefore serialise byte for byte whatever order a
 * template happened to fill the draft in.
 */
function freezeLayout(
  mol: Molecule,
  view: ProjectionView,
  draft: PlacedLayout,
  coverage: ProjectionCoverage,
  unplaced: readonly UnplacedUnit[],
): ProjectedLayout {
  const atomIndex = new Map(mol.atomIds.map((id, i) => [id, i]));
  const derived = [...draft.derivedNodes.values()].sort((p, q) => {
    const byHost = (atomIndex.get(p.host) ?? 0) - (atomIndex.get(q.host) ?? 0);
    return byHost !== 0 ? byHost : compareIds(p.id, q.id);
  });
  const nodeOrder: string[] = [
    ...mol.atomIds.filter((id) => draft.positions.has(id) && !draft.derivedNodes.has(id)),
    ...derived.map((node) => node.id),
  ];

  const positions: Record<string, Vec2> = {};
  const provenance: Record<string, readonly AtomId[]> = {};
  for (const id of nodeOrder) {
    const pos = draft.positions.get(id)!;
    positions[id] = Object.freeze({ x: pos.x, y: pos.y });
    provenance[id] = Object.freeze([...(draft.provenance.get(id) ?? [])]);
  }

  const bondIndex = new Map(mol.bondIds.map((id, i) => [id, i]));
  const nodeIndex = new Map(nodeOrder.map((id, i) => [id, i]));
  const bonds = [...draft.bonds.values()].sort((p, q) => {
    const ps = p.sourceBondId === undefined ? undefined : bondIndex.get(p.sourceBondId);
    const qs = q.sourceBondId === undefined ? undefined : bondIndex.get(q.sourceBondId);
    if (ps !== undefined && qs !== undefined) return ps - qs;
    if (ps !== undefined) return -1;
    if (qs !== undefined) return 1;
    const byNode = (nodeIndex.get(p.to) ?? 0) - (nodeIndex.get(q.to) ?? 0);
    return byNode !== 0 ? byNode : compareIds(p.id, q.id);
  });
  const marks: Record<string, ProjectedLayout["marks"][string]> = {};
  const depth: Record<string, ProjectedLayout["depth"][string]> = {};
  for (const bond of bonds) {
    const mark = draft.marks.get(bond.id);
    if (mark !== undefined) marks[bond.id] = Object.freeze({ stereo: mark.stereo, narrowEnd: mark.narrowEnd });
    depth[bond.id] = draft.depth.get(bond.id) ?? "inPlane";
  }

  const drawnAs: Record<AtomId, string> = {};
  for (const atomId of mol.atomIds) {
    const node = draft.drawnAs.get(atomId);
    if (node !== undefined) drawnAs[atomId] = node;
  }

  const locants: Record<AtomId, string> = {};
  for (const atomId of mol.atomIds) {
    const locant = draft.locants.get(atomId);
    if (locant !== undefined) locants[atomId] = locant;
  }
  // A face label is a claim about a centre, so only a centre the layout
  // states may carry one (decisions 146, 155).
  const stated = new Set(coverage.centres);
  const labelOrder = new Map(mol.atomIds.map((id, i) => [id, i]));
  const faceLabels = draft.faceLabels
    .filter((label) => stated.has(label.atomId))
    .sort((p, q) => {
      const byAtom = (labelOrder.get(p.atomId) ?? 0) - (labelOrder.get(q.atomId) ?? 0);
      if (byAtom !== 0) return byAtom;
      if (p.ligand.kind !== q.ligand.kind) return p.ligand.kind === "atom" ? -1 : 1;
      return p.ligand.kind === "atom" && q.ligand.kind === "atom" ? compareIds(p.ligand.atomId, q.ligand.atomId) : 0;
    })
    .map((label) =>
      Object.freeze({
        atomId: label.atomId,
        locant: label.locant,
        ligand: Object.freeze({ ...label.ligand }),
        face: label.face,
        ...(label.group === undefined ? {} : { group: label.group }),
      }),
    );

  const frozenBonds = bonds.map((bond) =>
    Object.freeze(
      bond.sourceBondId === undefined
        ? { id: bond.id, from: bond.from, to: bond.to, order: bond.order }
        : { id: bond.id, from: bond.from, to: bond.to, order: bond.order, sourceBondId: bond.sourceBondId },
    ),
  );

  return Object.freeze({
    kind: view.kind,
    template: view.template,
    convention: draft.convention,
    bondLength: draft.bondLength,
    positions: Object.freeze(positions),
    bonds: Object.freeze(frozenBonds),
    marks: Object.freeze(marks),
    depth: Object.freeze(depth),
    derivedNodes: Object.freeze(
      derived.map((node) =>
        Object.freeze({
          id: node.id,
          kind: node.kind,
          host: node.host,
          label: Object.freeze([...node.label]),
          anchor: node.anchor,
        }),
      ),
    ),
    provenance: Object.freeze(provenance),
    drawnAs: Object.freeze(drawnAs),
    coverage,
    unplaced,
    collisions: collisions(nodeOrder, positions, draft.bondLength),
    locants: Object.freeze(locants),
    faceLabels: Object.freeze(faceLabels),
  });
}

/**
 * Node pairs nearer than `LAYOUT_COLLISION_DISTANCE` bond lengths, found on a
 * grid of that cell size so a large drawing is not an all-pairs scan. In node
 * order, so the report is as deterministic as the layout.
 */
function collisions(
  nodeOrder: readonly string[],
  positions: Readonly<Record<string, Vec2>>,
  bondLength: number,
): readonly LayoutCollision[] {
  const limit = LAYOUT_COLLISION_DISTANCE * bondLength;
  if (!(limit > 0)) return Object.freeze([]);
  const cells = new Map<string, number[]>();
  const cellOf = (p: Vec2): [number, number] => [Math.floor(p.x / limit), Math.floor(p.y / limit)];
  nodeOrder.forEach((id, index) => {
    const [cx, cy] = cellOf(positions[id]!);
    const key = `${cx},${cy}`;
    const bucket = cells.get(key);
    if (bucket === undefined) cells.set(key, [index]);
    else bucket.push(index);
  });
  const found: LayoutCollision[] = [];
  nodeOrder.forEach((id, index) => {
    const p = positions[id]!;
    const [cx, cy] = cellOf(p);
    const near: number[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of cells.get(`${cx + dx},${cy + dy}`) ?? []) if (other > index) near.push(other);
      }
    }
    near.sort((a, b) => a - b);
    for (const other of near) {
      const q = positions[nodeOrder[other]!]!;
      const distance = Math.sqrt((q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y));
      if (distance < limit) found.push(Object.freeze({ a: id, b: nodeOrder[other]!, distance }));
    }
  });
  return Object.freeze(found);
}

// ---------------------------------------------------------------------------
// readProjection
// ---------------------------------------------------------------------------

/**
 * The configuration `layout` states, read from ITS geometry and marks under
 * its own convention — never from `mol`'s coordinates or wedges — and
 * restricted to the layout's coverage. A unit outside the coverage is absent
 * from the result, not undetermined.
 *
 * `mol` supplies only topology: which atoms are centres and their ligand
 * orders. The read is scoped to the coverage (decision 171), so only a
 * covered centre can make the convention refuse the placement as a whole (a
 * Fischer bond off the page axes) — and in a layout `project` made, none
 * does.
 */
export function readProjection(mol: Molecule, layout: ProjectedLayout): ConfigRead {
  const read = readConfig(placementOfLayout(mol, layoutAccess(layout)), layout.convention, layout.coverage);
  if (read.kind !== "read") return read;
  // The scope reads every other unit as `not-covered`; outside the coverage
  // a unit is unreported, so the restriction drops it.
  return Object.freeze({ kind: "read", config: restrictStereoConfig(read.config, layout.coverage) });
}

function layoutAccess(layout: ProjectedLayout): LayoutAccess {
  const bySource = new Map<BondId, ProjectedLayout["bonds"][number]>();
  for (const bond of layout.bonds) if (bond.sourceBondId !== undefined) bySource.set(bond.sourceBondId, bond);
  return {
    convention: layout.convention,
    position: (node) => (Object.hasOwn(layout.positions, node) ? layout.positions[node] : undefined),
    nodeOf: (atomId) => (Object.hasOwn(layout.drawnAs, atomId) ? layout.drawnAs[atomId] : undefined),
    bondFor: (bondId) => bySource.get(bondId),
    mark: (bondId) => (Object.hasOwn(layout.marks, bondId) ? layout.marks[bondId] : undefined),
    hydrogenNodes: () => layout.derivedNodes.filter((node) => node.kind === "hydrogen"),
  };
}

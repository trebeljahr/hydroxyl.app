/**
 * The round-trip law and the operators the harness states it through.
 *
 * THE LAW (decision 146, the scope's first paragraph):
 *
 *     restrict(read(project(M, C, F)), cov) = restrict(C, cov)
 *
 * with `cov` the LAYOUT's coverage, and the CIP descriptors agreeing on that
 * restriction; nothing is asserted outside it. It is passed by a layout that
 * placed nothing, so every row also asserts `unplaced` is empty, that the
 * layout covers the whole of what its frame reaches, and that the descriptors
 * are letters before anything is compared: an undetermined descriptor
 * survives every projection perfectly.
 *
 * THE READER NEVER SEES THE MODEL'S DRAWING. `readProjection` reads the
 * layout's own geometry and marks; the operators below (turn, reflect,
 * transpose) change a layout VALUE and read it again, never the molecule, so
 * a test here cannot pass by reading the author's wedges back.
 */

import { project, readProjection, projectionCoverage } from "../../src/projection/engine.js";
import { restrictStereoConfig, stereoDisagreements } from "../../src/projection/frames.js";
import type {
  ProjectedLayout,
  ProjectionCoverage,
  ProjectionResult,
  ProjectionView,
} from "../../src/projection/types.js";
import { rankStereoDoubleBond } from "../../src/cip.js";
import { cipConfiguration, descriptorFromConfig, stereoConfig, type StereoConfig } from "../../src/stereo-config.js";
import type { AtomId, Molecule } from "../../src/types.js";
import type { Vec2 } from "../../src/vec.js";
import {
  HARNESS_FIXTURES,
  TEMPLATE_KEYS,
  fixtureName,
  loadFixture,
  viewFor,
  type HarnessFixture,
  type TemplateKey,
} from "./fixtures.js";

/** "R", "S", "r", "s", "mixture", "undetermined:<reason>" or "none", by centre. */
export function letters(mol: Molecule, config: StereoConfig): Record<AtomId, string> {
  const out: Record<AtomId, string> = {};
  for (const centre of config.centres) {
    const d = descriptorFromConfig(mol, centre, config);
    out[centre.atomId] = d === undefined ? "none" : d.kind === "undetermined" ? `undetermined:${d.reason}` : d.kind;
  }
  return out;
}

/** cis/trans by bond id, as the configuration states it. */
export function relations(config: StereoConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of config.doubleBonds) {
    out[b.bondId] = b.reading.kind === "specified" ? b.reading.relation : `undetermined:${b.reading.reason}`;
  }
  return out;
}

/**
 * E or Z of each double bond `config` states, from its cis/trans relation and
 * the CIP ranking of its ends under that configuration: E/Z is read from the
 * configuration, never from the drawing, so a mirrored or re-laid layout's
 * read-back is lettered exactly as the model is.
 */
export function doubleBondLetters(mol: Molecule, config: StereoConfig): Record<string, string> {
  const out: Record<string, string> = {};
  const cip = cipConfiguration(config);
  for (const unit of config.doubleBonds) {
    if (unit.reading.kind !== "specified") {
      out[unit.bondId] = `undetermined:${unit.reading.reason}`;
      continue;
    }
    const ranking = rankStereoDoubleBond(mol, unit.bondId, cip);
    if (ranking === undefined || ranking.kind !== "ranked") {
      out[unit.bondId] = ranking === undefined ? "none" : ranking.kind;
      continue;
    }
    // The relation is stated against the lowest-id reference at each end;
    // an end whose senior group is the other one flips it.
    const flips = (ranking.topOnFrom === unit.refOnFrom ? 0 : 1) + (ranking.topOnTo === unit.refOnTo ? 0 : 1);
    const seniorsCis = (unit.reading.relation === "cis") === (flips % 2 === 0);
    out[unit.bondId] = seniorsCis ? "Z" : "E";
  }
  return out;
}

export function isLetter(value: string): boolean {
  return /^[RSrs]$/.test(value);
}

/** Only the entries of `record` whose key `keep` holds. */
export function pick<T>(record: Readonly<Record<string, T>>, keep: readonly string[]): Record<string, T> {
  const wanted = new Set(keep);
  return Object.fromEntries(Object.entries(record).filter(([key]) => wanted.has(key)));
}

export function readBack(mol: Molecule, layout: ProjectedLayout): StereoConfig {
  const read = readProjection(mol, layout);
  if (read.kind !== "read") throw new Error(`the reader refused the layout: ${read.reason} at ${read.atomIds.join(", ")}`);
  return read.config;
}

// ---------------------------------------------------------------------------
// Rows: one per fixture and listed template
// ---------------------------------------------------------------------------

/**
 * One cell of the matrix.
 *
 *   built           the template projects a layout; the law runs
 *   pending         the template is listed and owed (`template-not-built`):
 *                   a todo now, and the whole law the day it projects, with
 *                   no edit here
 *   refused         the template refuses this molecule for a reason it
 *                   documents and the fixture table declares
 *   not-applicable  no frame declared, or no steroid core to accept
 */
export type Row =
  | { readonly status: "built"; readonly key: TemplateKey; readonly fixture: HarnessFixture; readonly view: ProjectionView; readonly layout: ProjectedLayout }
  | { readonly status: "pending"; readonly key: TemplateKey; readonly fixture: HarnessFixture; readonly view: ProjectionView }
  | {
      readonly status: "refused";
      readonly key: TemplateKey;
      readonly fixture: HarnessFixture;
      readonly view: ProjectionView;
      readonly result: Exclude<ProjectionResult, { kind: "available" }>;
      /** The refusal the fixture table declares; undefined makes the row a failure. */
      readonly declared: string | undefined;
    }
  | { readonly status: "not-applicable"; readonly key: TemplateKey; readonly fixture: HarnessFixture; readonly why: string };

/**
 * Throws unless every stereo unit of `mol` reads a letter. Called before any
 * layout of it is made, at collection time too, so no row of the matrix is
 * ever computed for a fixture whose descriptors could pass vacuously.
 */
export function requireLetters(mol: Molecule, name: string): void {
  const config = stereoConfig(mol);
  for (const [atomId, letter] of Object.entries(letters(mol, config))) {
    if (!isLetter(letter)) throw new Error(`${name}: ${atomId} reads ${letter}, so no projection of it can be checked`);
  }
  for (const unit of config.doubleBonds) {
    if (unit.reading.kind !== "specified") throw new Error(`${name}: ${unit.bondId} is not specified`);
  }
}

export function rowFor(fixture: HarnessFixture, key: TemplateKey): Row {
  const mol = loadFixture(fixture);
  requireLetters(mol, fixtureName(fixture));
  const chosen = viewFor(fixture, mol, key);
  if (chosen.kind === "not-applicable") return { status: "not-applicable", key, fixture, why: chosen.why };
  const result = project(mol, stereoConfig(mol), chosen.view);
  if (result.kind === "available") return { status: "built", key, fixture, view: chosen.view, layout: result.layout };
  if (result.kind === "unavailable" && result.reason === "template-not-built") {
    return { status: "pending", key, fixture, view: chosen.view };
  }
  return { status: "refused", key, fixture, view: chosen.view, result, declared: fixture.refusals?.[key] };
}

/** The whole matrix, in fixture order then PROJECTION_TEMPLATES order. */
export function matrixRows(): readonly Row[] {
  return HARNESS_FIXTURES.flatMap((fixture) => TEMPLATE_KEYS.map((key) => rowFor(fixture, key)));
}

export function rowName(row: Row): string {
  return `${fixtureName(row.fixture)} x ${row.key}`;
}

// ---------------------------------------------------------------------------
// The law, as data a test asserts and a golden records
// ---------------------------------------------------------------------------

export interface LawOutcome {
  /** The frame's reach; the layout must cover all of it. */
  readonly reach: ProjectionCoverage | undefined;
  readonly coverage: ProjectionCoverage;
  readonly unplaced: ProjectedLayout["unplaced"];
  /** Units on which the read-back disagrees with the configuration. */
  readonly disagreements: readonly unknown[];
  /** The configuration's letters on the coverage, and the read-back's. */
  readonly expectedLetters: Readonly<Record<AtomId, string>>;
  readonly readLetters: Readonly<Record<AtomId, string>>;
  readonly expectedRelations: Readonly<Record<string, string>>;
  readonly readRelations: Readonly<Record<string, string>>;
  /** E/Z on the coverage, the model's and the read-back's. */
  readonly expectedBondLetters: Readonly<Record<string, string>>;
  readonly readBondLetters: Readonly<Record<string, string>>;
}

export function lawOutcome(mol: Molecule, view: ProjectionView, layout: ProjectedLayout): LawOutcome {
  const config = stereoConfig(mol);
  const read = readBack(mol, layout);
  const expected = restrictStereoConfig(config, layout.coverage);
  // The read is lettered with the WHOLE configuration beside it for rules
  // 3-5 (a pseudoasymmetric centre's branches), but its own reading of each
  // covered unit.
  const merged = mergeReadings(config, read);
  return {
    reach: projectionCoverage(mol, view),
    coverage: layout.coverage,
    unplaced: layout.unplaced,
    disagreements: stereoDisagreements(expected, read, layout.coverage),
    expectedLetters: pick(letters(mol, config), layout.coverage.centres),
    readLetters: pick(letters(mol, merged), layout.coverage.centres),
    expectedRelations: relations(expected),
    readRelations: relations(read),
    expectedBondLetters: pick(doubleBondLetters(mol, config), layout.coverage.doubleBonds),
    readBondLetters: pick(doubleBondLetters(mol, merged), layout.coverage.doubleBonds),
  };
}

/**
 * `config` with every unit `read` states replaced by `read`'s reading. A
 * pseudoasymmetric centre is ranked through its neighbours' configurations
 * (rules 3-5), so a read restricted to one centre is ranked against the
 * model's configuration elsewhere, never against nothing.
 */
export function mergeReadings(config: StereoConfig, read: StereoConfig): StereoConfig {
  const centres = new Map(read.centres.map((c) => [c.atomId, c]));
  const bonds = new Map(read.doubleBonds.map((b) => [b.bondId, b]));
  return {
    centres: config.centres.map((c) => centres.get(c.atomId) ?? c),
    doubleBonds: config.doubleBonds.map((b) => bonds.get(b.bondId) ?? b),
    unrepresentable: config.unrepresentable,
  };
}

/**
 * CROSS-PORT: the configuration read from `from`'s layout, projected into
 * `to`'s view and read back, agrees with the model on the intersection of
 * the two layouts' coverages. Returns the units carried and any that did not
 * survive. The second projection is handed ONLY what the first stated, so a
 * unit outside the first coverage is `unspecified-in-config` in the second
 * layout, by design, and never compared.
 */
export function crossPort(
  mol: Molecule,
  from: Extract<Row, { status: "built" }>,
  to: Extract<Row, { status: "built" }>,
): { readonly carried: readonly AtomId[]; readonly carriedBonds: readonly string[]; readonly lost: readonly unknown[] } {
  const carriedConfig = readBack(mol, from.layout);
  const result = project(mol, carriedConfig, to.view);
  if (result.kind !== "available") throw new Error(`${rowName(to)} refused a configuration read from ${rowName(from)}: ${result.kind}`);
  const second = result.layout;
  const intersection: ProjectionCoverage = {
    centres: from.layout.coverage.centres.filter((id) => second.coverage.centres.includes(id)),
    doubleBonds: from.layout.coverage.doubleBonds.filter((id) => second.coverage.doubleBonds.includes(id)),
  };
  // Every unit the first stated and the second's frame reaches must be
  // placed by the second: carried, not dropped.
  const reached = to.layout.coverage;
  const dropped = [
    ...from.layout.coverage.centres.filter((id) => reached.centres.includes(id) && !intersection.centres.includes(id)),
    ...from.layout.coverage.doubleBonds.filter((id) => reached.doubleBonds.includes(id) && !intersection.doubleBonds.includes(id)),
  ];
  const read = readBack(mol, second);
  const lost = [...dropped.map((id) => ({ dropped: id })), ...stereoDisagreements(stereoConfig(mol), read, intersection)];
  return { carried: intersection.centres, carriedBonds: intersection.doubleBonds, lost };
}

// ---------------------------------------------------------------------------
// Operators on a layout value
// ---------------------------------------------------------------------------

function mapPositions(layout: ProjectedLayout, f: (p: Vec2) => Vec2): ProjectedLayout {
  const positions: Record<string, Vec2> = {};
  for (const [id, p] of Object.entries(layout.positions)) positions[id] = f(p);
  return { ...layout, positions };
}

/**
 * The layout turned `degrees` counter-clockwise on the page about the origin,
 * marks and depth untouched: what a Fischer turned in the plane of the paper
 * is (T1). Exact at quarter turns, so a turned Fischer is still on its axes.
 */
export function turnLayout(layout: ProjectedLayout, degrees: number): ProjectedLayout {
  const quarter = ((Math.round(degrees / 90) % 4) + 4) % 4;
  if (Math.abs(degrees - Math.round(degrees / 90) * 90) > 1e-9) throw new Error("turnLayout takes quarter turns");
  const turn = [
    (p: Vec2) => ({ x: p.x, y: p.y }),
    (p: Vec2) => ({ x: -p.y, y: p.x }),
    (p: Vec2) => ({ x: -p.x, y: -p.y }),
    (p: Vec2) => ({ x: p.y, y: -p.x }),
  ][quarter]!;
  return mapPositions(layout, turn);
}

/**
 * The layout reflected in the vertical axis, marks KEPT: the mirror image, the
 * other enantiomer (T6). Not a planar panel's `mirror`, which exchanges wedge
 * and hash so the same molecule is re-posed.
 */
export function reflectLayout(layout: ProjectedLayout): ProjectedLayout {
  return mapPositions(layout, (p) => ({ x: -p.x, y: p.y }));
}

/** The layout read under another convention: the negative control of T2. */
export function withConvention(layout: ProjectedLayout, convention: ProjectedLayout["convention"]): ProjectedLayout {
  return { ...layout, convention };
}

/** A layout stating only `centres` of its coverage: one centre read at a time. */
export function scopedTo(layout: ProjectedLayout, centres: readonly AtomId[]): ProjectedLayout {
  return { ...layout, coverage: { centres, doubleBonds: [] } };
}

/** `R` for `S` and back; `r`, `s` and anything else unchanged (reflection-invariant). */
export function mirrorLetter(letter: string): string {
  return letter === "R" ? "S" : letter === "S" ? "R" : letter;
}

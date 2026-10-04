/**
 * The harness's fixtures and the frames each is projected through
 * (decisions 189, 208, 211).
 *
 * THREE CHECKED-IN SETS, every molblock generated once by RDKit and none
 * hand-typed: the projection reference set (ef1fdc4), the steroid set
 * (a7c9b8d) and the harness's own (schemes, the propylene pentamers, butane,
 * an allene, a wedge on a non-stereocentre), which
 * packages/client/scripts/build-harness-fixtures.mjs writes and checks.
 *
 * THE FRAMES ARE DECLARED, NEVER PERCEIVED (decision 208). A Fischer's
 * backbone, a Haworth's ring and a Newman's bond are written down here by
 * atom id, so a regression in sugar or amino-acid perception cannot silently
 * drop a row: the row is still there, and projects or says why not. The
 * planar templates need no frame; the steroid panel needs the skeleton the
 * suggestion offers, which the harness accepts on the user's behalf.
 *
 * EVERY LISTED TEMPLATE GETS A ROW, built or not. `viewFor` builds the view a
 * template would draw from the declared frame; a template listed in
 * PROJECTION_TEMPLATES that this file does not know throws, so a fourteenth
 * depiction cannot land without a row in the matrix.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readMolblock } from "../../src/molblock-read.js";
import { bondBetween } from "../../src/molecule.js";
import { PROJECTION_TEMPLATES, type ProjectionUnavailableReason, type ProjectionView } from "../../src/projection/types.js";
import { suggestSteroidSkeleton } from "../../src/skeleton/steroid.js";
import type { AtomId, BondId, Molecule } from "../../src/types.js";

export const FIXTURE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

export type FixtureSet = "projection" | "steroid" | "harness";

/**
 * What a fixture is, for the tiers that care: the RDKit tier is REQUIRED for
 * every sugar and steroid (the scope's third tier), and a scheme is checked
 * for balance before it is projected.
 */
export type FixtureFamily = "sugar" | "steroid" | "amino-acid" | "scheme" | "molecule";

/** `kind/template`, as the engine registers a template. */
export type TemplateKey = `${keyof typeof PROJECTION_TEMPLATES}/${string}`;

/** Every listed template, built or not, in PROJECTION_TEMPLATES order. */
export const TEMPLATE_KEYS: readonly TemplateKey[] = Object.freeze(
  (Object.keys(PROJECTION_TEMPLATES) as (keyof typeof PROJECTION_TEMPLATES)[]).flatMap((kind) =>
    PROJECTION_TEMPLATES[kind].map((template): TemplateKey => `${kind}/${template}`),
  ),
);

export interface DeclaredFrames {
  /** A Fischer's backbone, top end first. */
  readonly fischer?: readonly AtomId[];
  /** A Natta projection's main chain. */
  readonly natta?: readonly AtomId[];
  /** A Haworth's ring and the atom at its reference vertex (the anomeric carbon). */
  readonly haworth?: { readonly ringAtomIds: readonly AtomId[]; readonly referenceAtomId: AtomId };
  /** The ring a chair draws. */
  readonly chair?: readonly AtomId[];
  /** The bond a Newman and a sawhorse sight down, front atom first. */
  readonly sighted?: readonly [AtomId, AtomId];
  /** The bonds the torsion overlay annotates, each as its two atoms. */
  readonly torsion?: readonly (readonly [AtomId, AtomId])[];
}

export interface HarnessFixture {
  readonly set: FixtureSet;
  readonly file: string;
  readonly family: FixtureFamily;
  readonly frames: DeclaredFrames;
  /**
   * A refusal the template documents for this molecule, which the matrix
   * records as `refused` instead of failing: ent-kaurene's bridged C/D rings
   * have no Mills layout (decision 186). Anything else a built template
   * refuses is a failure.
   */
  readonly refusals?: Readonly<Partial<Record<TemplateKey, ProjectionUnavailableReason>>>;
}

/** `set/file`, the name a row, a record and a golden use. */
export function fixtureName(fixture: HarnessFixture): string {
  return `${fixture.set}/${fixture.file}`;
}

const GLUCOSE_BACKBONE = ["a2", "a3", "a5", "a7", "a9", "a11"];
const PYRANOSE_RING = ["a3", "a4", "a5", "a7", "a9", "a11"];
/** C1..C15 of 3,5,7,9,11-pentamethylpentadecane; the methyls are a4, a7, a10, a13, a16. */
const PENTAMER_CHAIN = ["a1", "a2", "a3", "a5", "a6", "a8", "a9", "a11", "a12", "a14", "a15", "a17", "a18", "a19", "a20"];

/**
 * The matrix's fixtures. Atom ids are molblock rows (a1 = row 1); each
 * backbone was read off the file, top end first as a textbook draws it:
 * C1 (the carbonyl) on top for a sugar, the carboxyl on top for an amino
 * acid.
 */
export const HARNESS_FIXTURES: readonly HarnessFixture[] = Object.freeze([
  // ── The projection reference set ──────────────────────────────────────────
  { set: "projection", file: "r-glyceraldehyde.mol", family: "sugar", frames: { fischer: ["a2", "a3", "a5"], sighted: ["a3", "a5"] } },
  { set: "projection", file: "s-glyceraldehyde.mol", family: "sugar", frames: { fischer: ["a2", "a3", "a5"] } },
  {
    set: "projection",
    file: "d-glucose-open.mol",
    family: "sugar",
    frames: { fischer: GLUCOSE_BACKBONE, sighted: ["a5", "a7"], torsion: [["a3", "a5"], ["a5", "a7"], ["a7", "a9"]] },
  },
  { set: "projection", file: "l-glucose-open.mol", family: "sugar", frames: { fischer: GLUCOSE_BACKBONE } },
  { set: "projection", file: "d-galactose-open.mol", family: "sugar", frames: { fischer: GLUCOSE_BACKBONE } },
  { set: "projection", file: "d-fructose-open.mol", family: "sugar", frames: { fischer: GLUCOSE_BACKBONE } },
  { set: "projection", file: "d-ribose-open.mol", family: "sugar", frames: { fischer: ["a2", "a3", "a5", "a7", "a9"] } },
  { set: "projection", file: "2-deoxy-d-ribose-open.mol", family: "sugar", frames: { fischer: ["a2", "a3", "a4", "a6", "a8"] } },
  {
    set: "projection",
    file: "alpha-d-glucopyranose.mol",
    family: "sugar",
    frames: { haworth: { ringAtomIds: PYRANOSE_RING, referenceAtomId: "a5" }, chair: PYRANOSE_RING },
  },
  {
    set: "projection",
    file: "beta-d-glucopyranose.mol",
    family: "sugar",
    frames: { haworth: { ringAtomIds: PYRANOSE_RING, referenceAtomId: "a5" }, chair: PYRANOSE_RING },
  },
  {
    set: "projection",
    file: "alpha-d-mannopyranose.mol",
    family: "sugar",
    frames: { haworth: { ringAtomIds: PYRANOSE_RING, referenceAtomId: "a5" }, chair: PYRANOSE_RING },
  },
  {
    set: "projection",
    file: "alpha-l-fucopyranose.mol",
    family: "sugar",
    frames: {
      haworth: { ringAtomIds: ["a2", "a3", "a4", "a6", "a8", "a10"], referenceAtomId: "a4" },
      chair: ["a2", "a3", "a4", "a6", "a8", "a10"],
    },
  },
  {
    set: "projection",
    file: "adenosine.mol",
    family: "sugar",
    frames: { haworth: { ringAtomIds: ["a11", "a12", "a13", "a16", "a18"], referenceAtomId: "a11" } },
  },
  { set: "projection", file: "ribaric-acid.mol", family: "sugar", frames: { fischer: ["a2", "a4", "a6", "a8", "a10"] } },
  { set: "projection", file: "l-alanine.mol", family: "amino-acid", frames: { fischer: ["a4", "a2", "a3"] } },
  { set: "projection", file: "l-cysteine.mol", family: "amino-acid", frames: { fischer: ["a5", "a2", "a3"] } },
  { set: "projection", file: "l-isoleucine.mol", family: "amino-acid", frames: { fischer: ["a7", "a5", "a3", "a2", "a1"] } },
  { set: "projection", file: "cis-2-butene.mol", family: "molecule", frames: {} },
  { set: "projection", file: "trans-2-butene.mol", family: "molecule", frames: {} },
  {
    set: "projection",
    file: "rr-tartaric-acid.mol",
    family: "molecule",
    frames: { fischer: ["a2", "a4", "a6", "a8"], sighted: ["a4", "a6"] },
  },
  {
    set: "projection",
    file: "meso-tartaric-acid.mol",
    family: "molecule",
    frames: { fischer: ["a2", "a4", "a6", "a8"], sighted: ["a4", "a6"] },
  },
  {
    set: "projection",
    file: "pentane-2r3s-diol.mol",
    family: "molecule",
    frames: { fischer: ["a1", "a2", "a4", "a6", "a7"], sighted: ["a2", "a4"] },
  },
  { set: "projection", file: "cis-1-2-dimethylcyclohexane.mol", family: "molecule", frames: { chair: ["a2", "a3", "a4", "a5", "a6", "a7"], sighted: ["a2", "a7"] } },
  { set: "projection", file: "trans-1-2-dimethylcyclohexane.mol", family: "molecule", frames: { chair: ["a2", "a3", "a4", "a5", "a6", "a7"], sighted: ["a2", "a7"] } },
  {
    set: "projection",
    file: "rr-2-3-dibromobutane.mol",
    family: "molecule",
    frames: { fischer: ["a1", "a2", "a4", "a6"], sighted: ["a2", "a4"], torsion: [["a2", "a4"]] },
  },
  {
    set: "projection",
    file: "meso-2-3-dibromobutane.mol",
    family: "molecule",
    frames: { fischer: ["a1", "a2", "a4", "a6"], sighted: ["a2", "a4"], torsion: [["a2", "a4"]] },
  },
  { set: "projection", file: "5alpha-androstane.mol", family: "steroid", frames: {} },
  { set: "projection", file: "chd-ethanol.mol", family: "molecule", frames: { fischer: ["a1", "a2", "a4"] } },
  { set: "projection", file: "methyl-p-tolyl-sulfoxide.mol", family: "molecule", frames: {} },

  // ── The steroid set ───────────────────────────────────────────────────────
  { set: "steroid", file: "cholesterol.mol", family: "steroid", frames: {} },
  { set: "steroid", file: "testosterone.mol", family: "steroid", frames: {} },
  { set: "steroid", file: "cortisol.mol", family: "steroid", frames: {} },
  { set: "steroid", file: "estradiol.mol", family: "steroid", frames: {} },
  { set: "steroid", file: "5alpha-cholestane.mol", family: "steroid", frames: {} },
  { set: "steroid", file: "5beta-cholestane.mol", family: "steroid", frames: {} },
  { set: "steroid", file: "methyltestosterone.mol", family: "steroid", frames: {} },
  { set: "steroid", file: "abiraterone.mol", family: "steroid", frames: {} },
  { set: "steroid", file: "cholesteryl-alpha-d-glucopyranoside.mol", family: "steroid", frames: {} },
  { set: "steroid", file: "cholecalciferol.mol", family: "steroid", frames: {} },
  {
    set: "steroid",
    file: "ent-kaurene.mol",
    family: "steroid",
    frames: {},
    refusals: { "planar/mills": "bridged-ring-system" },
  },

  // ── The harness's own (decision 211) ──────────────────────────────────────
  {
    set: "harness",
    file: "butane.mol",
    family: "molecule",
    frames: { fischer: ["a1", "a2", "a3", "a4"], sighted: ["a2", "a3"], torsion: [["a2", "a3"]] },
  },
  { set: "harness", file: "isotactic-pentamer.mol", family: "molecule", frames: { fischer: PENTAMER_CHAIN, natta: PENTAMER_CHAIN } },
  { set: "harness", file: "syndiotactic-pentamer.mol", family: "molecule", frames: { fischer: PENTAMER_CHAIN, natta: PENTAMER_CHAIN } },
  { set: "harness", file: "atactic-pentamer.mol", family: "molecule", frames: { fischer: PENTAMER_CHAIN, natta: PENTAMER_CHAIN } },
  { set: "harness", file: "penta-2-3-diene.mol", family: "molecule", frames: {} },
  { set: "harness", file: "propan-2-ol-wedged.mol", family: "molecule", frames: { fischer: ["a1", "a2", "a3"] } },
  // The schemes' Fischers draw one species each: the stereocentre that the
  // scheme is about, with every other species off the page axes beside it
  // (decision 171 scopes the read to the backbone).
  { set: "harness", file: "sn2-scheme.mol", family: "scheme", frames: { fischer: ["a2", "a3", "a5", "a6"] } },
  { set: "harness", file: "aldol-scheme.mol", family: "scheme", frames: { fischer: ["a10", "a11", "a13", "a14", "a16"] } },
  { set: "harness", file: "allyl-cation-resonance.mol", family: "scheme", frames: {} },
  { set: "harness", file: "ester-hydrolysis-equilibrium.mol", family: "scheme", frames: { fischer: ["a1", "a2", "a4"] } },
] satisfies readonly HarnessFixture[]);

const MOLECULES = new Map<string, Molecule>();

/** The fixture's molecule, read once per run with chem-core's own reader. */
export function loadFixture(fixture: HarnessFixture): Molecule {
  const name = fixtureName(fixture);
  let mol = MOLECULES.get(name);
  if (mol === undefined) {
    mol = readMolblock(readFileSync(fixturePath(fixture), "utf8")).molecule;
    MOLECULES.set(name, mol);
  }
  return mol;
}

export function fixturePath(fixture: HarnessFixture): string {
  return join(FIXTURE_ROOT, fixture.set, fixture.file);
}

function bondIdOf(mol: Molecule, [a, b]: readonly [AtomId, AtomId]): BondId {
  const bond = bondBetween(mol, a, b);
  if (bond === undefined) throw new Error(`the harness declares a bond ${a}-${b} the molecule does not have`);
  return bond.id;
}

/**
 * The view `key` draws of `fixture`, or why there is none to draw: no frame
 * declared, or (for the steroid panel) no steroid core to accept.
 *
 * The steroid panel is given every core `suggestSteroidSkeleton` offers, one
 * per species (decision 195), accepted as a user would (decision 163).
 */
export function viewFor(
  fixture: HarnessFixture,
  mol: Molecule,
  key: TemplateKey,
): { readonly kind: "view"; readonly view: ProjectionView } | { readonly kind: "not-applicable"; readonly why: string } {
  const frames = fixture.frames;
  const none = (why: string) => ({ kind: "not-applicable", why }) as const;
  const view = (value: ProjectionView) => ({ kind: "view", view: value }) as const;
  switch (key) {
    case "planar/wedgeDash":
      return view({ kind: "planar", template: "wedgeDash", frame: {}, params: { rotationDeg: 0, mirror: false } });
    case "planar/mills":
      return view({ kind: "planar", template: "mills", frame: {}, params: { rotationDeg: 0, mirror: false } });
    case "planar/steroid": {
      const suggestion = suggestSteroidSkeleton(mol);
      if (suggestion.kind !== "match") return none(`no steroid core to accept (${suggestion.kind})`);
      return view({
        kind: "planar",
        template: "steroid",
        frame: {},
        params: { rotationDeg: 0, mirror: false, skeletons: suggestion.skeletons },
      });
    }
    case "chain/fischer":
      return frames.fischer === undefined
        ? none("no backbone declared")
        : view({ kind: "chain", template: "fischer", frame: { backbone: frames.fischer }, params: { top: "first" } });
    case "chain/natta":
      return frames.natta === undefined
        ? none("no main chain declared")
        : view({ kind: "chain", template: "natta", frame: { backbone: frames.natta }, params: { top: "first" } });
    case "ring/haworth":
      return frames.haworth === undefined
        ? none("no ring declared")
        : view({ kind: "ring", template: "haworth", frame: frames.haworth, params: { face: "front" } });
    case "ring/chair":
      return frames.chair === undefined
        ? none("no ring declared")
        : view({ kind: "ring", template: "chair", frame: { ringAtomIds: frames.chair }, params: { face: "front" } });
    case "sightedBond/newman":
    case "sightedBond/sawhorse": {
      if (frames.sighted === undefined) return none("no sighted bond declared");
      const [front, back] = frames.sighted;
      return view({
        kind: "sightedBond",
        template: key === "sightedBond/newman" ? "newman" : "sawhorse",
        frame: { front, back },
        params: { torsionDeg: 60, rollDeg: 0 },
      });
    }
    case "annotationOverlay/torsion":
      return frames.torsion === undefined
        ? none("no bonds declared")
        : view({
            kind: "annotationOverlay",
            template: "torsion",
            frame: { bondIds: frames.torsion.map((pair) => bondIdOf(mol, pair)) },
            params: {},
          });
    default:
      throw new Error(
        `${key} is listed in PROJECTION_TEMPLATES but the harness has no view for it: declare its frame in test/harness/fixtures.ts`,
      );
  }
}

// ---------------------------------------------------------------------------
// The harness set's manifest: species, arrows, conditions
// ---------------------------------------------------------------------------

export interface ManifestSpecies {
  readonly name: string;
  readonly smiles: string;
  /** RDKit's letters, in SMILES atom order, which is molblock row order. */
  readonly cip: readonly string[];
  readonly inchiKey: string;
  readonly atoms: number;
}

export interface ManifestArrow {
  readonly kind: "forward" | "equilibrium" | "resonance";
  readonly from: readonly number[];
  readonly to: readonly number[];
  readonly above?: readonly string[];
  readonly below?: readonly string[];
}

export interface ManifestEntry {
  readonly file: string;
  readonly name: string;
  readonly smiles: string;
  readonly inchiKey: string;
  readonly species: readonly ManifestSpecies[];
  readonly arrows?: readonly ManifestArrow[];
}

export function harnessManifest(): readonly ManifestEntry[] {
  return (
    JSON.parse(readFileSync(join(FIXTURE_ROOT, "harness", "manifest.json"), "utf8")) as {
      fixtures: ManifestEntry[];
    }
  ).fixtures;
}

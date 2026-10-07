/**
 * One 3D conformer for a drawn structure, with the drawn stereochemistry
 * checked rather than hoped for (decisions 222 and 232).
 *
 * ── WHY NOT RDKit's ETKDG ──────────────────────────────────────────────────
 *
 * The bundled `@rdkit/rdkit` 2025.3.4 MinimalLib has no conformer embedding:
 * its JSMol exposes `set_new_coords`/`get_new_coords` (2D only) and nothing
 * from DistGeom, ETKDG, UFF or MMFF. Decision 232 records the probe. A custom
 * MinimalLib build is the only way to get ETKDG into the browser, so the
 * fallback decision 222 allows is used: OpenChemLib's MMFF94s+ force field.
 *
 * ── WHY NOT OpenChemLib's OWN ConformerGenerator ───────────────────────────
 *
 * It is right, and it is far too slow in its GWT-compiled form: measured on
 * 2026-10-07 in node, 25 s for alanine the first time and 227 s for
 * cholesterol, almost all of it building rigid-fragment conformers that the
 * Java build loads from a precomputed cache the JS build does not ship. For a
 * view that refreshes as the user draws that is not a fallback, it is a hang.
 *
 * ── WHAT THIS DOES INSTEAD ─────────────────────────────────────────────────
 *
 * The drawing's own 2D coordinates are a good start: bond lengths are
 * uniform and every ring is already closed. They are scaled to 1.5 Å, the
 * hydrogens are filled in, and each atom is lifted off the plane by what the
 * drawing says about depth — the far end of a wedge up, of a hash down, and a
 * stereocentre's hydrogens to the side its wedged neighbour is not on — plus
 * a little seeded noise so no ring is left balanced on a planar saddle point.
 * MMFF94s+ then minimises the whole thing. On cholesterol this lands at
 * 98 kcal/mol, the same minimum the ConformerGenerator reaches, in seconds.
 *
 * ── THE STEREO CHECK IS THE POINT ──────────────────────────────────────────
 *
 * A minimiser started from a flat drawing CAN walk a stereocentre through the
 * plane, and a 3D view showing the enantiomer of the drawn molecule is the
 * plausible wrong answer this project refuses everywhere else. So every
 * attempt is read back from its 3D coordinates and each stereocentre and
 * stereo double bond the DRAWING specifies is compared with the drawing's.
 * Centres the drawing leaves unspecified are not compared: the 3D structure
 * has to pick one, and either is faithful. An attempt that disagrees is
 * thrown away and the next seed is tried; when every seed disagrees the
 * result is a refusal, never the best wrong one.
 *
 * Pure apart from OpenChemLib, which is passed in so the node tests can load
 * it directly and the worker can load it bundled.
 */

import type * as OCLNamespace from "openchemlib";

import type { ConformerResult, ConformerAtom, ConformerBond } from "./protocol";

export type OCL = typeof OCLNamespace;
type OclMolecule = InstanceType<OCL["Molecule"]>;

/**
 * The slice of OpenChemLib's `resources.json` the force field reads. The rest
 * (the COD torsion tables the ConformerGenerator needs, the toxicity and
 * drug-likeness predictors) is never loaded, so it is never shipped.
 */
export const FORCE_FIELD_RESOURCE_PREFIX = "/resources/forcefield/";

/** Target C–C distance for the scaled drawing, in ångström. */
const START_BOND_LENGTH = 1.5;
/** How far a wedge's far end, or a hydrogen, starts above or below the plane. */
const LIFT = 0.9;
/** Seeded jitter, in ångström: in-plane and out-of-plane. */
const JITTER_XY = 0.2;
const JITTER_Z = 0.4;
/** Seeds tried before refusing. Measured: cholesterol and estradiol each fail
 *  one seed in three, so five makes a refusal rare without making a real one
 *  slow. */
export const MAX_ATTEMPTS = 5;
/**
 * Heavy atoms above which the view refuses. The minimiser's non-bonded terms
 * are quadratic in atom count; 150 heavy atoms with their hydrogens is about
 * 300 atoms, which minimises in tens of seconds in a worker.
 */
export const MAX_HEAVY_ATOMS = 150;
const MINIMISE_ITERATIONS = 4000;

/** Park–Miller-style LCG: deterministic, so one drawing gives one picture. */
function jitter(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff - 0.5;
  };
}

function readMolblock(ocl: OCL, molblock: string): OclMolecule {
  const mol = ocl.Molecule.fromMolfile(molblock);
  mol.ensureHelperArrays(ocl.Molecule.cHelperParities);
  return mol;
}

interface StereoSpec {
  readonly atoms: readonly (readonly [index: number, parity: number])[];
  readonly bonds: readonly (readonly [index: number, parity: number])[];
}

/** Only what the drawing actually states: parity 1/2, E/Z. */
function specifiedStereo(ocl: OCL, mol: OclMolecule): StereoSpec {
  const { cAtomParity1, cAtomParity2, cBondParityEor1, cBondParityZor2 } = ocl.Molecule;
  const atoms: [number, number][] = [];
  for (let a = 0; a < mol.getAtoms(); a++) {
    const parity = mol.getAtomParity(a);
    if (parity === cAtomParity1 || parity === cAtomParity2) atoms.push([a, parity]);
  }
  const bonds: [number, number][] = [];
  for (let b = 0; b < mol.getBonds(); b++) {
    const parity = mol.getBondParity(b);
    if (parity === cBondParityEor1 || parity === cBondParityZor2) bonds.push([b, parity]);
  }
  return { atoms, bonds };
}

function keepsStereo(ocl: OCL, molfile: string, spec: StereoSpec): boolean {
  // Read back through a molfile so the parities come from the 3D coordinates
  // alone, exactly as any other program reading the result would see them.
  const back = readMolblock(ocl, molfile);
  return (
    spec.atoms.every(([a, parity]) => back.getAtomParity(a) === parity) &&
    spec.bonds.every(([b, parity]) => back.getBondParity(b) === parity)
  );
}

/** The drawing, lifted off the plane as described in the header. */
function startingGeometry(ocl: OCL, molblock: string, seed: number): OclMolecule {
  const mol = ocl.Molecule.fromMolfile(molblock);
  mol.addImplicitHydrogens();
  mol.ensureHelperArrays(ocl.Molecule.cHelperNeighbours);
  // Drawn bonds only: the hydrogens just added sit at OpenChemLib's own 2D length.
  const average = mol.getAverageBondLength(true);
  const scale = average > 0 ? START_BOND_LENGTH / average : 1;
  const count = mol.getAllAtoms();
  const z = new Float64Array(count);

  for (let b = 0; b < mol.getAllBonds(); b++) {
    const type = mol.getBondType(b);
    const far = mol.getBondAtom(1, b);
    if (type === ocl.Molecule.cBondTypeUp) z[far] = (z[far] ?? 0) + LIFT;
    else if (type === ocl.Molecule.cBondTypeDown) z[far] = (z[far] ?? 0) - LIFT;
  }

  // A stereocentre drawn with one wedged neighbour has its hydrogen on the
  // other face; an atom with nothing wedged gets its hydrogens alternately up
  // and down, which is where an sp3 CH2 puts them anyway.
  for (let a = 0; a < mol.getAtoms(); a++) {
    const za = z[a] ?? 0;
    let heavyLift = 0;
    const hydrogens: number[] = [];
    for (let i = 0; i < mol.getAllConnAtoms(a); i++) {
      const n = mol.getConnAtom(a, i);
      if (mol.getAtomicNo(n) === 1) hydrogens.push(n);
      else heavyLift += (z[n] ?? 0) - za;
    }
    let side = heavyLift > 0.01 ? -1 : 1;
    for (const h of hydrogens) {
      z[h] = za + side * LIFT;
      side = -side;
    }
  }

  const noise = jitter(seed);
  for (let a = 0; a < count; a++) {
    // OpenChemLib holds coordinates y-down, as a screen does; a molfile is
    // y-up. Its reader flips y on the way in, so turning it back here keeps
    // a wedge meaning "towards the viewer" in a right-handed frame.
    mol.setAtomX(a, mol.getAtomX(a) * scale + noise() * JITTER_XY);
    mol.setAtomY(a, -mol.getAtomY(a) * scale + noise() * JITTER_XY);
    mol.setAtomZ(a, (z[a] ?? 0) + noise() * JITTER_Z);
  }
  return mol;
}

/**
 * The result, read from the conformer's molfile rather than from
 * OpenChemLib's in-memory coordinates: a molfile's frame is the documented,
 * right-handed one, it is the same text the stereo check just read back, and
 * so what the viewer draws is exactly what was checked.
 */
function describe(molfile: string, energy: number, attempts: number): ConformerResult {
  const lines = molfile.split("\n");
  const counts = lines[3] ?? "";
  const atomCount = Number.parseInt(counts.slice(0, 3), 10);
  const bondCount = Number.parseInt(counts.slice(3, 6), 10);
  const atoms: ConformerAtom[] = [];
  for (let i = 0; i < atomCount; i++) {
    const line = lines[4 + i] ?? "";
    atoms.push({
      element: line.slice(31, 34).trim(),
      x: Number.parseFloat(line.slice(0, 10)),
      y: Number.parseFloat(line.slice(10, 20)),
      z: Number.parseFloat(line.slice(20, 30)),
    });
  }
  const n = atoms.length || 1;
  const cx = atoms.reduce((sum, atom) => sum + atom.x, 0) / n;
  const cy = atoms.reduce((sum, atom) => sum + atom.y, 0) / n;
  const cz = atoms.reduce((sum, atom) => sum + atom.z, 0) / n;
  const centred = atoms.map((atom) => ({ ...atom, x: atom.x - cx, y: atom.y - cy, z: atom.z - cz }));
  const bonds: ConformerBond[] = [];
  for (let i = 0; i < bondCount; i++) {
    const line = lines[4 + atomCount + i] ?? "";
    const order = Number.parseInt(line.slice(6, 9), 10);
    bonds.push({
      a: Number.parseInt(line.slice(0, 3), 10) - 1,
      b: Number.parseInt(line.slice(3, 6), 10) - 1,
      order: order === 3 ? 3 : order === 2 ? 2 : 1,
    });
  }
  return { ok: true, atoms: centred, bonds, energy, attempts };
}

function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * A conformer for `molblock`, or a sentence saying why there is none. Never
 * throws: a structure MMFF94 has no atom types for (a metal, boron) is a
 * normal thing to draw.
 */
export function embedConformer(ocl: OCL, molblock: string): ConformerResult {
  let drawn: OclMolecule;
  try {
    drawn = readMolblock(ocl, molblock);
  } catch (error) {
    return { ok: false, reason: "unreadable", message: `The structure could not be read: ${message(error)}` };
  }
  if (drawn.getAllAtoms() === 0) {
    return { ok: false, reason: "empty", message: "Draw a structure to see it in 3D." };
  }
  if (drawn.getAtoms() > MAX_HEAVY_ATOMS) {
    return {
      ok: false,
      reason: "too-large",
      message: `The 3D view handles up to ${MAX_HEAVY_ATOMS} heavy atoms; this structure has ${drawn.getAtoms()}.`,
    };
  }
  const fragments = drawn.getFragments();
  if (fragments.length <= 1) return embedOne(ocl, molblock, drawn);
  return embedSpecies(ocl, fragments);
}

/**
 * One connected structure: the seeded attempts and the stereo check from the
 * header.
 */
function embedOne(ocl: OCL, molblock: string, drawn: OclMolecule): ConformerResult {
  const spec = specifiedStereo(ocl, drawn);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const mol = startingGeometry(ocl, molblock, attempt);
    let energy: number;
    try {
      const field = new ocl.ForceFieldMMFF94(mol, "MMFF94s+");
      field.minimise({ maxIts: MINIMISE_ITERATIONS });
      energy = field.getTotalEnergy();
    } catch (error) {
      return {
        ok: false,
        reason: "force-field",
        message:
          "The MMFF94 force field has no parameters for an atom in this structure " +
          `(metals, boron and most charged main-group atoms have none): ${message(error)}`,
      };
    }
    if (!Number.isFinite(energy)) continue;
    // V2000 always: the heavy-atom cap keeps every conformer far inside its
    // 999-atom counts field, and `describe` reads that format.
    const molfile = mol.toMolfile();
    if (keepsStereo(ocl, molfile, spec)) return describe(molfile, energy, attempt);
  }
  return {
    ok: false,
    reason: "stereo",
    message: `No 3D geometry kept the drawn stereochemistry after ${MAX_ATTEMPTS} attempts, so none is shown.`,
  };
}

/** Space between two species' bounding spheres, in ångström. */
const SPECIES_GAP = 1.5;

/**
 * Several species (a salt, a reagent beside a product, a scheme): each is
 * embedded on its own and they are set side by side, left to right in the
 * order they are drawn. Minimised together, the force field's attraction
 * pulls separate molecules into one clump wherever they started, which shows
 * an encounter complex nobody drew.
 */
function embedSpecies(ocl: OCL, fragments: readonly OclMolecule[]): ConformerResult {
  const placed = fragments
    .map((fragment) => {
      fragment.ensureHelperArrays(ocl.Molecule.cHelperParities);
      let x = 0;
      for (let a = 0; a < fragment.getAllAtoms(); a++) x += fragment.getAtomX(a);
      return { fragment, drawnX: x / Math.max(1, fragment.getAllAtoms()) };
    })
    .sort((p, q) => p.drawnX - q.drawnX);

  const atoms: ConformerAtom[] = [];
  const bonds: ConformerBond[] = [];
  let energy = 0;
  let attempts = 0;
  let cursor = 0;
  for (const { fragment } of placed) {
    const molblock = fragment.toMolfile();
    const result = embedOne(ocl, molblock, readMolblock(ocl, molblock));
    if (!result.ok) return result;
    // `describe` centred it; its bounding radius plus a hydrogen's reach.
    const radius = result.atoms.reduce((max, atom) => Math.max(max, Math.hypot(atom.x, atom.y, atom.z)), 0) + 1.2;
    const offset = atoms.length;
    const centre = cursor + radius;
    for (const atom of result.atoms) atoms.push({ ...atom, x: atom.x + centre });
    for (const bond of result.bonds) bonds.push({ ...bond, a: bond.a + offset, b: bond.b + offset });
    cursor = centre + radius + SPECIES_GAP;
    energy += result.energy;
    attempts = Math.max(attempts, result.attempts);
  }
  const shift = cursor / 2 - SPECIES_GAP / 2;
  return {
    ok: true,
    atoms: atoms.map((atom) => ({ ...atom, x: atom.x - shift })),
    bonds,
    energy,
    attempts,
  };
}

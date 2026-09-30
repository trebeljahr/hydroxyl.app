/**
 * Generate the projection harness's own fixtures (decisions 189, 211):
 * `packages/chem-core/test/fixtures/harness/*.mol` and its `manifest.json`.
 *
 *   node packages/client/scripts/build-harness-fixtures.mjs
 *
 * THE SOURCE TABLES BELOW ARE THE THING TO EDIT. The projection reference set
 * (ef1fdc4) and the steroid and Mills sets (a7c9b8d) were generated once by
 * RDKit from SMILES by hand; this is the same recipe written down, for the
 * molecules and schemes the harness adds: RDKit lays each species out in 2D
 * (`set_new_coords()`, as those sets were), and the molblock is checked-in
 * text chem-core reads with its own reader. No wasm runs in the unit tests.
 *
 * A SCHEME IS ONE MOLECULE OF SEVERAL SPECIES (decision 102). Each species is
 * laid out by RDKit on its own and the script places them left to right on a
 * common baseline, with a gap an arrow and its conditions fit in, and joins
 * the atom and bond blocks. Reaction arrows are not drawn yet, so the arrows
 * and conditions are recorded in the manifest, where the harness reads them
 * to check the scheme balances before it projects anything.
 *
 * EVERY ROW CARRIES ITS OWN CHECK, and the script refuses to write if any
 * fails, because a SMILES typed with one `@` the wrong way round is a
 * different molecule that no formula can tell apart:
 *
 *   cip       the expected CIP letter of every stereocentre, in SMILES atom
 *             order, transcribed from the compound's name ("(R)-2-bromobutane")
 *             or, for the propylene pentamers, derived by hand in the row's
 *             comment. An empty list asserts RDKit finds NO centre.
 *   inchiKey  the InChIKey of the WRITTEN molblock, read back by RDKit, must
 *             equal that of the source SMILES (the layout kept the
 *             configuration), must equal the published key where the row
 *             gives one, and must equal the key already in the manifest, so a
 *             regeneration can never quietly change a fixture's identity.
 */

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "..", "chem-core", "test", "fixtures", "harness");
const manifestFile = path.join(outDir, "manifest.json");

/** RDKit's depictor draws bonds 1.5 long; species are this many bonds apart. */
const SPECIES_GAP = 3 * 1.5;

/**
 * @typedef {{ name: string, smiles: string, cip: string[], inchiKey?: string, wedge?: [number, number] }} Species
 * @typedef {{ kind: "forward" | "equilibrium" | "resonance", from: number[], to: number[], above?: string[], below?: string[] }} Arrow
 * @typedef {{ file: string, name: string, species: Species[], arrows?: Arrow[], source?: string, note?: string }} Row
 */

/** @type {Row[]} */
const ROWS = [
  // ── Molecules the scope lists that the reference set lacked ─────────────
  {
    file: "butane.mol",
    name: "butane",
    note: "No stereo unit at all: every row asserts that emptiness against RDKit (decision 211).",
    species: [{ name: "butane", smiles: "CCCC", cip: [] }],
  },
  {
    // 3,5,7,9,11-pentamethylpentadecane: a propylene pentamer with an ethyl
    // and a butyl end, so all five methines are true stereocentres (a
    // symmetric chain would make the middle one pseudoasymmetric). The same
    // chirality mark on every repeat is the same configuration relative to
    // the chain: ISOTACTIC. Letters by hand: at C3, C5 and C7 the branch
    // toward C15 outranks the one toward C1 (it meets a methine first); at
    // C9 and C11 the order turns, because the butyl end is unbranched and
    // the chain toward C1 reaches a methine sooner. So [C@@H] everywhere is
    // (3R,5R,7R,9S,11S): an isotactic chain does NOT read one letter.
    file: "isotactic-pentamer.mol",
    name: "isotactic 3,5,7,9,11-pentamethylpentadecane (propylene pentamer)",
    species: [
      {
        name: "isotactic 3,5,7,9,11-pentamethylpentadecane",
        smiles: "CC[C@@H](C)C[C@@H](C)C[C@@H](C)C[C@@H](C)C[C@@H](C)CCCC",
        cip: ["R", "R", "R", "S", "S"],
      },
    ],
  },
  {
    // Alternating marks: SYNDIOTACTIC, (3R,5S,7R,9R,11S) by the same ranking.
    file: "syndiotactic-pentamer.mol",
    name: "syndiotactic 3,5,7,9,11-pentamethylpentadecane (propylene pentamer)",
    species: [
      {
        name: "syndiotactic 3,5,7,9,11-pentamethylpentadecane",
        smiles: "CC[C@@H](C)C[C@H](C)C[C@@H](C)C[C@H](C)C[C@@H](C)CCCC",
        cip: ["R", "S", "R", "R", "S"],
      },
    ],
  },
  {
    // Neither pattern: @@ @@ @ @@ @, so (3R,5R,7S,9S,11R).
    file: "atactic-pentamer.mol",
    name: "atactic 3,5,7,9,11-pentamethylpentadecane (propylene pentamer)",
    species: [
      {
        name: "atactic 3,5,7,9,11-pentamethylpentadecane",
        smiles: "CC[C@@H](C)C[C@@H](C)C[C@H](C)C[C@@H](C)C[C@H](C)CCCC",
        cip: ["R", "R", "S", "S", "R"],
      },
    ],
  },
  {
    file: "penta-2-3-diene.mol",
    name: "penta-2,3-diene (an allene)",
    note:
      "Axial chirality no SMILES here can state and no CIP centre RDKit labels; chem-core reports it as `allene-axis` in `unrepresentable` (decision 211).",
    species: [{ name: "penta-2,3-diene", smiles: "CC=C=CC", cip: [] }],
  },
  {
    file: "propan-2-ol-wedged.mol",
    name: "propan-2-ol with a wedge drawn on C2-O (a wedge on a non-stereocentre)",
    note: "The script draws the wedge (narrow end C2, SMILES atoms 2 and 4); the molecule has no stereocentre, and nothing may read one.",
    species: [{ name: "propan-2-ol", smiles: "CC(C)O", cip: [], inchiKey: "KFZMGEQAYNKOFK-UHFFFAOYSA-N", wedge: [2, 4] }],
  },

  // ── Schemes: one molecule of several species ────────────────────────────
  {
    file: "sn2-scheme.mol",
    name: "SN2: hydroxide and (R)-2-bromobutane give (S)-butan-2-ol and bromide",
    note: "Walden inversion: the letter changes because the configuration does, OH taking Br's place in the ranking.",
    species: [
      { name: "hydroxide", smiles: "[OH-]", cip: [] },
      { name: "(R)-2-bromobutane", smiles: "C[C@@H](Br)CC", cip: ["R"] },
      { name: "(S)-butan-2-ol", smiles: "C[C@H](O)CC", cip: ["S"] },
      { name: "bromide", smiles: "[Br-]", cip: [] },
    ],
    arrows: [{ kind: "forward", from: [0, 1], to: [2, 3] }],
  },
  {
    file: "aldol-scheme.mol",
    name: "Proline-catalysed aldol: acetone and 2-methylpropanal give (R)-4-hydroxy-5-methylhexan-2-one",
    source: "List, Lerner and Barbas, J. Am. Chem. Soc. 2000, 122, 2395: L-proline (30 mol%), DMSO, rt.",
    species: [
      { name: "acetone", smiles: "CC(C)=O", cip: [] },
      { name: "2-methylpropanal", smiles: "CC(C)C=O", cip: [] },
      { name: "(R)-4-hydroxy-5-methylhexan-2-one", smiles: "CC(=O)C[C@@H](O)C(C)C", cip: ["R"] },
    ],
    arrows: [{ kind: "forward", from: [0, 1], to: [2], above: ["L-proline (30 mol%)"], below: ["DMSO, rt"] }],
  },
  {
    file: "allyl-cation-resonance.mol",
    name: "the allyl cation's two resonance forms",
    note: "One compound drawn twice: formula and net charge must agree (speciesRelationIssues), and neither form has a stereo unit.",
    species: [
      { name: "allyl cation, charge on C1", smiles: "[CH2+]C=C", cip: [] },
      { name: "allyl cation, charge on C3", smiles: "C=C[CH2+]", cip: [] },
    ],
    arrows: [{ kind: "resonance", from: [0], to: [1] }],
  },
  {
    file: "ester-hydrolysis-equilibrium.mol",
    name: "Acid-catalysed ester hydrolysis at equilibrium: ethyl (S)-lactate and water give (S)-lactic acid and ethanol",
    note: "The centre is not touched, so both sides read (S).",
    species: [
      { name: "ethyl (S)-lactate", smiles: "C[C@H](O)C(=O)OCC", cip: ["S"] },
      { name: "water", smiles: "O", cip: [], inchiKey: "XLYOFNOQVPJJNP-UHFFFAOYSA-N" },
      { name: "(S)-lactic acid", smiles: "C[C@H](O)C(=O)O", cip: ["S"] },
      { name: "ethanol", smiles: "CCO", cip: [], inchiKey: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N" },
    ],
    arrows: [{ kind: "equilibrium", from: [0, 1], to: [2, 3], above: ["H+ (cat.)"], below: [] }],
  },
];

// ---------------------------------------------------------------------------

const initRDKitModule = require("@rdkit/rdkit");
const RDKit = await initRDKitModule();
const RDKIT = `RDKit ${RDKit.version()}`;
// The local calendar date, as the other fixture sets record it.
const today = new Date().toLocaleDateString("sv-SE");

const previous = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : { fixtures: [] };
const previousKey = new Map(previous.fixtures.map((f) => [f.file, f.inchiKey]));

const failures = [];

/** RDKit's CIP letters, in atom order, for a molecule it has parsed. */
function cipOf(mol) {
  const tags = JSON.parse(mol.get_stereo_tags());
  return tags.CIP_atoms.sort((a, b) => a[0] - b[0]).map(([, label]) => label.replace(/[()]/g, ""));
}

function inchiKeyOf(mol) {
  return RDKit.get_inchikey_for_inchi(mol.get_inchi());
}

/** One V2000 molblock, split into the parts a join needs. */
function parseV2000(block, where) {
  const lines = block.split("\n");
  const counts = lines[3];
  if (!/V2000\s*$/.test(counts)) throw new Error(`${where}: not a V2000 molblock`);
  const atomCount = Number(counts.slice(0, 3));
  const bondCount = Number(counts.slice(3, 6));
  const atoms = lines.slice(4, 4 + atomCount);
  const bonds = lines.slice(4 + atomCount, 4 + atomCount + bondCount);
  const properties = [];
  for (const line of lines.slice(4 + atomCount + bondCount)) {
    if (line.startsWith("M  END")) break;
    if (/^M {2}(CHG|ISO|RAD)/.test(line)) properties.push(line);
    else if (line.trim() !== "") throw new Error(`${where}: property line the join does not know: ${line}`);
  }
  return { atoms, bonds, properties };
}

const pad = (value, width) => String(value).padStart(width, " ");
const coordinate = (value) => pad(value.toFixed(4), 10);

/**
 * The species' blocks joined into one, left to right: each species moved so
 * its leftmost atom sits a gap after the previous one's rightmost and its
 * vertical centre on y = 0. Atom rows are renumbered; nothing else changes.
 */
function joinSpecies(blocks) {
  const atoms = [];
  const bonds = [];
  const properties = { CHG: [], ISO: [], RAD: [] };
  let cursor = 0;
  for (const block of blocks) {
    const offset = atoms.length;
    const xs = block.atoms.map((line) => Number(line.slice(0, 10)));
    const ys = block.atoms.map((line) => Number(line.slice(10, 20)));
    const dx = cursor - Math.min(...xs);
    const dy = -(Math.min(...ys) + Math.max(...ys)) / 2;
    block.atoms.forEach((line, i) => {
      atoms.push(`${coordinate(xs[i] + dx)}${coordinate(ys[i] + dy)}${line.slice(20)}`);
    });
    for (const line of block.bonds) {
      bonds.push(`${pad(Number(line.slice(0, 3)) + offset, 3)}${pad(Number(line.slice(3, 6)) + offset, 3)}${line.slice(6)}`);
    }
    for (const line of block.properties) {
      const kind = line.slice(3, 6);
      const entries = line.slice(6).trim().split(/\s+/).map(Number);
      for (let i = 1; i < entries.length; i += 2) properties[kind].push([entries[i] + offset, entries[i + 1]]);
    }
    cursor = Math.max(...xs) + dx + SPECIES_GAP;
  }
  const propertyLines = [];
  for (const [kind, entries] of Object.entries(properties)) {
    for (let i = 0; i < entries.length; i += 8) {
      const chunk = entries.slice(i, i + 8);
      propertyLines.push(`M  ${kind}${pad(chunk.length, 3)}${chunk.map(([a, v]) => `${pad(a, 4)}${pad(v, 4)}`).join("")}`);
    }
  }
  return { atoms, bonds, properties: propertyLines };
}

const entries = [];

for (const row of ROWS) {
  const where = row.file;
  const blocks = [];
  const speciesOut = [];
  let rowFailed = false;
  for (const species of row.species) {
    const at = `${where} / ${species.name} (${species.smiles})`;
    const mol = RDKit.get_mol(species.smiles);
    if (mol === null || !mol.is_valid()) {
      failures.push(`${at}: RDKit could not read the SMILES`);
      mol?.delete();
      rowFailed = true;
      continue;
    }
    try {
      const cip = cipOf(mol);
      if (cip.join(",") !== species.cip.join(",")) failures.push(`${at}: CIP ${cip.join(",") || "none"}, expected ${species.cip.join(",") || "none"}`);
      const inchiKey = inchiKeyOf(mol);
      if (species.inchiKey !== undefined && inchiKey !== species.inchiKey) {
        failures.push(`${at}: InChIKey ${inchiKey}, expected the published ${species.inchiKey}`);
      }
      mol.set_new_coords();
      const block = parseV2000(mol.get_molblock(), at);
      if (species.wedge !== undefined) {
        const [narrow, wide] = species.wedge;
        const index = block.bonds.findIndex((line) => {
          const a = Number(line.slice(0, 3));
          const b = Number(line.slice(3, 6));
          return (a === narrow && b === wide) || (a === wide && b === narrow);
        });
        if (index < 0) failures.push(`${at}: no bond ${narrow}-${wide} to put the wedge on`);
        else {
          const line = block.bonds[index];
          // Narrow end first, stereo field 1 (wedge).
          block.bonds[index] = `${pad(narrow, 3)}${pad(wide, 3)}${line.slice(6, 9)}  1${line.slice(12)}`;
        }
      }
      blocks.push(block);
      speciesOut.push({ name: species.name, smiles: species.smiles, cip: species.cip, inchiKey, atoms: block.atoms.length });
    } finally {
      mol.delete();
    }
  }
  if (rowFailed) continue;

  const joined = joinSpecies(blocks);
  const smiles = row.species.map((s) => s.smiles).join(".");
  const title = `${row.name} (generated ${today}, ${RDKIT})`;
  const molblock = [
    title,
    "     RDKit          2D",
    smiles,
    `${pad(joined.atoms.length, 3)}${pad(joined.bonds.length, 3)}  0  0  0  0  0  0  0  0999 V2000`,
    ...joined.atoms,
    ...joined.bonds,
    ...joined.properties,
    "M  END",
    "",
  ].join("\n");

  // The written text must still be the molecule the SMILES names: read it
  // back into RDKit and compare the InChIKey (which carries configuration)
  // and every letter, species by species in atom order.
  const expectedKey = (() => {
    const mol = RDKit.get_mol(smiles);
    try {
      return inchiKeyOf(mol);
    } finally {
      mol.delete();
    }
  })();
  const reread = RDKit.get_mol(molblock);
  if (reread === null || !reread.is_valid()) {
    failures.push(`${where}: RDKit could not read the written molblock`);
    reread?.delete();
    continue;
  }
  try {
    const key = inchiKeyOf(reread);
    if (key !== expectedKey) failures.push(`${where}: the molblock reads as ${key}, the SMILES as ${expectedKey}`);
    const letters = cipOf(reread);
    const expectedLetters = row.species.flatMap((s) => s.cip);
    if (letters.join(",") !== expectedLetters.join(",")) {
      failures.push(`${where}: the molblock reads CIP ${letters.join(",") || "none"}, expected ${expectedLetters.join(",") || "none"}`);
    }
    const before = previousKey.get(row.file);
    if (before !== undefined && before !== key) {
      failures.push(`${where}: InChIKey ${key}, but the checked-in manifest says ${before}; a fixture's identity never changes on regeneration`);
    }
    entries.push({
      file: row.file,
      name: row.name,
      smiles,
      inchiKey: key,
      ...(row.source === undefined ? {} : { source: row.source }),
      ...(row.note === undefined ? {} : { note: row.note }),
      species: speciesOut,
      ...(row.arrows === undefined ? {} : { arrows: row.arrows }),
      molblock,
    });
  } finally {
    reread.delete();
  }
}

if (failures.length > 0) {
  console.error(`Refusing to write ${path.relative(process.cwd(), outDir)}:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
for (const entry of entries) writeFileSync(path.join(outDir, entry.file), entry.molblock);
const manifest = {
  generated: today,
  rdkit: `@rdkit/rdkit ${RDKit.version()} (MinimalLib): get_mol(smiles); set_new_coords(); get_molblock(), one species at a time, joined left to right by packages/client/scripts/build-harness-fixtures.mjs. Header line 1 is the name, line 3 the SMILES. Species atoms follow one another in the order listed; arrows name species by index.`,
  fixtures: entries.map(({ molblock, ...rest }) => rest),
};
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${entries.length} fixtures to ${path.relative(process.cwd(), outDir)}`);

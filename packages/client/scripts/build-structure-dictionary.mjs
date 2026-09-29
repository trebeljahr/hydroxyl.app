/**
 * Generate chem-core's structure dictionary: `packages/chem-core/src/dictionary-entries.ts`.
 *
 *   pnpm --filter @starter/client build:dictionary
 *
 * The SOURCE TABLE BELOW IS THE THING TO EDIT. Each row is a name, its
 * synonyms and a SMILES; this script has RDKit lay the SMILES out in 2D and
 * writes the molblock out as checked-in text. The editor reads that text with
 * chem-core's own molfile reader, so looking a name up never loads the wasm —
 * RDKit is needed here, once, and never at runtime.
 *
 * WHY HERE AND NOT IN chem-core. chem-core must not depend on RDKit, not even
 * to build. The client already owns the RDKit dependency and a script that
 * stages it (`copy-rdkit.mjs`), so the one-off layout step lives beside that.
 *
 * EVERY STEREO ROW CARRIES ITS OWN CHECK, because a SMILES typed from memory
 * with one `@` the wrong way round is a different sugar that no formula, mass
 * or atom count can tell apart. `cip` is the expected CIP descriptor of every
 * stereocentre in SMILES atom order, transcribed from the compound's IUPAC
 * name (β-D-glucopyranose is (2R,3R,4S,5S,6R)-6-(hydroxymethyl)oxane-2,3,4,5-
 * tetrol); `inchiKey`, where given, is the published key. The script refuses
 * to write the file if RDKit disagrees with either, and it refuses a row that
 * has stereocentres but no `cip` unless the row says `racemic`.
 *
 * NEUTRAL FORMS. Amino acids are written un-ionised (H2N–CH(R)–COOH), the way
 * a structure is drawn in a scheme, not as the zwitterion that exists in
 * water; a chemist who wants the zwitterion draws the two charges.
 *
 * WHICH FORM A BARE SUGAR NAME MEANS is decided by `synonyms`: "glucose" is a
 * synonym of β-D-glucopyranose, the anomer that dominates at equilibrium and
 * the one textbooks draw; fructose and ribose default to their β-furanoses,
 * the forms biochemistry draws them in (sucrose, nucleotides). The insert box
 * always shows the full name and lists the other forms beside it, so the
 * default is visible rather than silent.
 */

import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(here, "..", "..", "chem-core", "src", "dictionary-entries.ts");

/**
 * @typedef {"solvent" | "aromatic" | "sugar" | "amino-acid" | "nucleobase" | "biomolecule" | "drug"} Category
 * @typedef {{
 *   id: string, name: string, synonyms: string[], category: Category, smiles: string,
 *   cip?: string[], inchiKey?: string, racemic?: true
 * }} Source
 */

/** @type {Source[]} */
const SOURCES = [
  // ── Solvents and reagents ────────────────────────────────────────────────
  { id: "water", name: "water", synonyms: [], category: "solvent", smiles: "O", inchiKey: "XLYOFNOQVPJJNP-UHFFFAOYSA-N" },
  { id: "methanol", name: "methanol", synonyms: ["MeOH", "methyl alcohol"], category: "solvent", smiles: "CO" },
  { id: "ethanol", name: "ethanol", synonyms: ["EtOH", "ethyl alcohol", "alcohol"], category: "solvent", smiles: "CCO", inchiKey: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N" },
  { id: "isopropanol", name: "propan-2-ol", synonyms: ["isopropanol", "isopropyl alcohol", "IPA", "2-propanol", "iPrOH"], category: "solvent", smiles: "CC(C)O" },
  { id: "acetone", name: "acetone", synonyms: ["propanone", "propan-2-one"], category: "solvent", smiles: "CC(C)=O" },
  { id: "acetonitrile", name: "acetonitrile", synonyms: ["MeCN", "methyl cyanide"], category: "solvent", smiles: "CC#N" },
  { id: "dmso", name: "dimethyl sulfoxide", synonyms: ["DMSO"], category: "solvent", smiles: "CS(C)=O" },
  { id: "dmf", name: "N,N-dimethylformamide", synonyms: ["DMF", "dimethylformamide"], category: "solvent", smiles: "CN(C)C=O" },
  { id: "thf", name: "tetrahydrofuran", synonyms: ["THF", "oxolane"], category: "solvent", smiles: "C1CCOC1" },
  { id: "dioxane", name: "1,4-dioxane", synonyms: ["dioxane"], category: "solvent", smiles: "C1COCCO1" },
  { id: "dichloromethane", name: "dichloromethane", synonyms: ["DCM", "methylene chloride"], category: "solvent", smiles: "ClCCl" },
  { id: "chloroform", name: "chloroform", synonyms: ["trichloromethane"], category: "solvent", smiles: "ClC(Cl)Cl" },
  { id: "ethyl-acetate", name: "ethyl acetate", synonyms: ["EtOAc", "ethyl ethanoate"], category: "solvent", smiles: "CCOC(C)=O" },
  { id: "diethyl-ether", name: "diethyl ether", synonyms: ["ether", "Et2O", "ethoxyethane"], category: "solvent", smiles: "CCOCC" },
  { id: "hexane", name: "hexane", synonyms: ["n-hexane"], category: "solvent", smiles: "CCCCCC" },
  { id: "cyclohexane", name: "cyclohexane", synonyms: [], category: "solvent", smiles: "C1CCCCC1" },
  { id: "acetic-acid", name: "acetic acid", synonyms: ["AcOH", "ethanoic acid"], category: "solvent", smiles: "CC(=O)O" },
  { id: "formic-acid", name: "formic acid", synonyms: ["methanoic acid"], category: "solvent", smiles: "OC=O" },
  { id: "triethylamine", name: "triethylamine", synonyms: ["NEt3", "Et3N", "TEA"], category: "solvent", smiles: "CCN(CC)CC" },

  // ── Arenes and heterocycles ──────────────────────────────────────────────
  { id: "benzene", name: "benzene", synonyms: [], category: "aromatic", smiles: "c1ccccc1", inchiKey: "UHOVQNZJYSORNB-UHFFFAOYSA-N" },
  { id: "toluene", name: "toluene", synonyms: ["methylbenzene"], category: "aromatic", smiles: "Cc1ccccc1" },
  { id: "phenol", name: "phenol", synonyms: ["hydroxybenzene"], category: "aromatic", smiles: "Oc1ccccc1" },
  { id: "aniline", name: "aniline", synonyms: ["aminobenzene", "benzenamine"], category: "aromatic", smiles: "Nc1ccccc1" },
  { id: "naphthalene", name: "naphthalene", synonyms: [], category: "aromatic", smiles: "c1ccc2ccccc2c1" },
  { id: "pyridine", name: "pyridine", synonyms: [], category: "aromatic", smiles: "c1ccncc1" },
  { id: "pyrrole", name: "pyrrole", synonyms: ["1H-pyrrole"], category: "aromatic", smiles: "c1cc[nH]c1" },
  { id: "furan", name: "furan", synonyms: [], category: "aromatic", smiles: "c1ccoc1" },
  { id: "thiophene", name: "thiophene", synonyms: [], category: "aromatic", smiles: "c1ccsc1" },
  { id: "imidazole", name: "imidazole", synonyms: ["1H-imidazole"], category: "aromatic", smiles: "c1c[nH]cn1" },
  { id: "indole", name: "indole", synonyms: ["1H-indole"], category: "aromatic", smiles: "c1ccc2[nH]ccc2c1" },
  { id: "pyrimidine", name: "pyrimidine", synonyms: [], category: "aromatic", smiles: "c1cncnc1" },
  { id: "purine", name: "purine", synonyms: ["7H-purine"], category: "aromatic", smiles: "c1ncc2[nH]cnc2n1" },

  // ── Sugars ───────────────────────────────────────────────────────────────
  {
    id: "beta-d-glucopyranose",
    name: "β-D-glucopyranose",
    synonyms: ["glucose", "D-glucose", "dextrose", "β-D-glucose", "beta-D-glucose", "beta-D-glucopyranose"],
    category: "sugar",
    smiles: "C([C@@H]1[C@H]([C@@H]([C@H]([C@@H](O1)O)O)O)O)O",
    // SMILES order is C5, C4, C3, C2, C1 (sugar numbering).
    cip: ["R", "S", "S", "R", "R"],
    inchiKey: "WQZGKKKJIJFFOK-VFUOTHLCSA-N",
  },
  {
    id: "alpha-d-glucopyranose",
    name: "α-D-glucopyranose",
    synonyms: ["α-D-glucose", "alpha-D-glucose", "alpha-D-glucopyranose"],
    category: "sugar",
    smiles: "C([C@@H]1[C@H]([C@@H]([C@H]([C@H](O1)O)O)O)O)O",
    cip: ["R", "S", "S", "R", "S"],
    inchiKey: "WQZGKKKJIJFFOK-DVKNGEFBSA-N",
  },
  {
    id: "aldehydo-d-glucose",
    name: "D-glucose (open chain)",
    synonyms: ["aldehydo-D-glucose", "open-chain glucose", "open chain glucose"],
    category: "sugar",
    smiles: "C([C@H]([C@H]([C@@H]([C@H](C=O)O)O)O)O)O",
    // (2R,3S,4R,5R)-2,3,4,5,6-pentahydroxyhexanal; SMILES order C5, C4, C3, C2.
    cip: ["R", "R", "S", "R"],
  },
  {
    id: "beta-d-galactopyranose",
    name: "β-D-galactopyranose",
    synonyms: ["galactose", "D-galactose", "β-D-galactose", "beta-D-galactose", "beta-D-galactopyranose"],
    category: "sugar",
    // The C4 epimer of glucose: only the second centre in SMILES order flips.
    smiles: "C([C@@H]1[C@@H]([C@@H]([C@H]([C@@H](O1)O)O)O)O)O",
    cip: ["R", "R", "S", "R", "R"],
  },
  {
    id: "beta-d-mannopyranose",
    name: "β-D-mannopyranose",
    synonyms: ["mannose", "D-mannose", "β-D-mannose", "beta-D-mannose", "beta-D-mannopyranose"],
    category: "sugar",
    // The C2 epimer of glucose: only the fourth centre in SMILES order flips.
    smiles: "C([C@@H]1[C@H]([C@@H]([C@@H]([C@@H](O1)O)O)O)O)O",
    cip: ["R", "S", "S", "S", "R"],
  },
  {
    id: "beta-d-fructofuranose",
    name: "β-D-fructofuranose",
    synonyms: ["fructose", "D-fructose", "β-D-fructose", "beta-D-fructose", "beta-D-fructofuranose"],
    category: "sugar",
    // (2R,3S,4S,5R)-2,5-bis(hydroxymethyl)oxolane-2,3,4-triol; SMILES order C5, C4, C3, C2.
    smiles: "C([C@@H]1[C@H]([C@@H]([C@](O1)(CO)O)O)O)O",
    cip: ["R", "S", "S", "R"],
  },
  {
    id: "keto-d-fructose",
    name: "D-fructose (open chain)",
    synonyms: ["keto-D-fructose", "open-chain fructose", "open chain fructose"],
    category: "sugar",
    // (3S,4R,5R)-1,3,4,5,6-pentahydroxyhexan-2-one; SMILES order C5, C4, C3.
    smiles: "C([C@H]([C@H]([C@@H](C(=O)CO)O)O)O)O",
    cip: ["R", "R", "S"],
  },
  {
    id: "beta-d-ribofuranose",
    name: "β-D-ribofuranose",
    synonyms: ["ribose", "D-ribose", "β-D-ribose", "beta-D-ribose", "beta-D-ribofuranose"],
    category: "sugar",
    // (2R,3R,4S,5R)-5-(hydroxymethyl)oxolane-2,3,4-triol; SMILES order C4, C3, C2, C1.
    smiles: "C([C@@H]1[C@H]([C@H]([C@@H](O1)O)O)O)O",
    cip: ["R", "S", "R", "R"],
  },
  {
    id: "aldehydo-d-ribose",
    name: "D-ribose (open chain)",
    synonyms: ["aldehydo-D-ribose", "open-chain ribose", "open chain ribose"],
    category: "sugar",
    // (2R,3R,4R)-2,3,4,5-tetrahydroxypentanal; SMILES order C4, C3, C2.
    smiles: "C([C@H]([C@H]([C@H](C=O)O)O)O)O",
    cip: ["R", "R", "R"],
  },
  {
    id: "2-deoxy-beta-d-ribofuranose",
    name: "2-deoxy-β-D-ribofuranose",
    synonyms: ["deoxyribose", "2-deoxyribose", "2-deoxy-D-ribose", "2-deoxy-beta-D-ribose", "2-deoxy-beta-D-ribofuranose"],
    category: "sugar",
    // (2R,4S,5R)-5-(hydroxymethyl)oxolane-2,4-diol; SMILES order C4, C3, C1.
    smiles: "C([C@@H]1[C@H](C[C@@H](O1)O)O)O",
    cip: ["R", "S", "R"],
  },
  {
    id: "sucrose",
    name: "sucrose",
    synonyms: ["saccharose", "table sugar", "cane sugar"],
    category: "sugar",
    smiles: "C([C@@H]1[C@H]([C@@H]([C@H]([C@H](O1)O[C@]2([C@H]([C@@H]([C@H](O2)CO)O)O)CO)O)O)O)O",
    // Glucose C5, C4, C3, C2, C1, then fructose C2, C3, C4, C5.
    cip: ["R", "S", "S", "R", "R", "S", "S", "S", "R"],
    inchiKey: "CZMRCDWAGMRECN-UGDNZRGBSA-N",
  },

  // ── Amino acids (L, un-ionised) ──────────────────────────────────────────
  { id: "glycine", name: "glycine", synonyms: ["Gly"], category: "amino-acid", smiles: "NCC(=O)O", inchiKey: "DHMQDGOQFOQNFH-UHFFFAOYSA-N" },
  { id: "l-alanine", name: "L-alanine", synonyms: ["alanine", "Ala"], category: "amino-acid", smiles: "C[C@@H](C(=O)O)N", cip: ["S"], inchiKey: "QNAYBMKLOCPYGJ-REOHCLBHSA-N" },
  { id: "l-valine", name: "L-valine", synonyms: ["valine", "Val"], category: "amino-acid", smiles: "CC(C)[C@@H](C(=O)O)N", cip: ["S"] },
  { id: "l-leucine", name: "L-leucine", synonyms: ["leucine", "Leu"], category: "amino-acid", smiles: "CC(C)C[C@@H](C(=O)O)N", cip: ["S"] },
  // (2S,3S): SMILES order Cβ, Cα.
  { id: "l-isoleucine", name: "L-isoleucine", synonyms: ["isoleucine", "Ile"], category: "amino-acid", smiles: "CC[C@H](C)[C@@H](C(=O)O)N", cip: ["S", "S"] },
  { id: "l-proline", name: "L-proline", synonyms: ["proline", "Pro"], category: "amino-acid", smiles: "C1C[C@H](NC1)C(=O)O", cip: ["S"] },
  { id: "l-phenylalanine", name: "L-phenylalanine", synonyms: ["phenylalanine", "Phe"], category: "amino-acid", smiles: "c1ccc(cc1)C[C@@H](C(=O)O)N", cip: ["S"] },
  { id: "l-tryptophan", name: "L-tryptophan", synonyms: ["tryptophan", "Trp"], category: "amino-acid", smiles: "c1ccc2c(c1)c(c[nH]2)C[C@@H](C(=O)O)N", cip: ["S"] },
  { id: "l-methionine", name: "L-methionine", synonyms: ["methionine", "Met"], category: "amino-acid", smiles: "CSCC[C@@H](C(=O)O)N", cip: ["S"] },
  { id: "l-serine", name: "L-serine", synonyms: ["serine", "Ser"], category: "amino-acid", smiles: "C([C@@H](C(=O)O)N)O", cip: ["S"] },
  // (2S,3R): SMILES order Cβ, Cα.
  { id: "l-threonine", name: "L-threonine", synonyms: ["threonine", "Thr"], category: "amino-acid", smiles: "C[C@H]([C@@H](C(=O)O)N)O", cip: ["R", "S"] },
  // The one proteinogenic L-amino acid that is R: sulfur outranks the carboxyl.
  { id: "l-cysteine", name: "L-cysteine", synonyms: ["cysteine", "Cys"], category: "amino-acid", smiles: "C([C@@H](C(=O)O)N)S", cip: ["R"], inchiKey: "XUJNEKJLAYXESH-REOHCLBHSA-N" },
  { id: "l-tyrosine", name: "L-tyrosine", synonyms: ["tyrosine", "Tyr"], category: "amino-acid", smiles: "c1cc(ccc1C[C@@H](C(=O)O)N)O", cip: ["S"] },
  { id: "l-asparagine", name: "L-asparagine", synonyms: ["asparagine", "Asn"], category: "amino-acid", smiles: "C([C@@H](C(=O)O)N)C(=O)N", cip: ["S"] },
  { id: "l-glutamine", name: "L-glutamine", synonyms: ["glutamine", "Gln"], category: "amino-acid", smiles: "C(CC(=O)N)[C@@H](C(=O)O)N", cip: ["S"] },
  { id: "l-aspartic-acid", name: "L-aspartic acid", synonyms: ["aspartic acid", "aspartate", "Asp"], category: "amino-acid", smiles: "C([C@@H](C(=O)O)N)C(=O)O", cip: ["S"] },
  { id: "l-glutamic-acid", name: "L-glutamic acid", synonyms: ["glutamic acid", "glutamate", "Glu"], category: "amino-acid", smiles: "C(CC(=O)O)[C@@H](C(=O)O)N", cip: ["S"] },
  { id: "l-lysine", name: "L-lysine", synonyms: ["lysine", "Lys"], category: "amino-acid", smiles: "C(CCN)C[C@@H](C(=O)O)N", cip: ["S"] },
  { id: "l-arginine", name: "L-arginine", synonyms: ["arginine", "Arg"], category: "amino-acid", smiles: "C(C[C@@H](C(=O)O)N)CN=C(N)N", cip: ["S"] },
  { id: "l-histidine", name: "L-histidine", synonyms: ["histidine", "His"], category: "amino-acid", smiles: "c1c(nc[nH]1)C[C@@H](C(=O)O)N", cip: ["S"] },

  // ── Nucleobases ──────────────────────────────────────────────────────────
  { id: "adenine", name: "adenine", synonyms: [], category: "nucleobase", smiles: "Nc1ncnc2[nH]cnc12" },
  { id: "guanine", name: "guanine", synonyms: [], category: "nucleobase", smiles: "Nc1nc2[nH]cnc2c(=O)[nH]1" },
  { id: "cytosine", name: "cytosine", synonyms: [], category: "nucleobase", smiles: "Nc1cc[nH]c(=O)n1" },
  { id: "thymine", name: "thymine", synonyms: ["5-methyluracil"], category: "nucleobase", smiles: "Cc1c[nH]c(=O)[nH]c1=O" },
  { id: "uracil", name: "uracil", synonyms: [], category: "nucleobase", smiles: "O=c1cc[nH]c(=O)[nH]1" },

  // ── Small biomolecules ───────────────────────────────────────────────────
  { id: "urea", name: "urea", synonyms: ["carbamide"], category: "biomolecule", smiles: "NC(N)=O" },
  { id: "glycerol", name: "glycerol", synonyms: ["glycerin", "propane-1,2,3-triol"], category: "biomolecule", smiles: "OCC(O)CO" },
  { id: "citric-acid", name: "citric acid", synonyms: ["citrate"], category: "biomolecule", smiles: "OC(=O)CC(O)(CC(=O)O)C(=O)O" },
  { id: "dopamine", name: "dopamine", synonyms: [], category: "biomolecule", smiles: "NCCc1ccc(O)c(O)c1" },
  { id: "serotonin", name: "serotonin", synonyms: ["5-hydroxytryptamine", "5-HT"], category: "biomolecule", smiles: "NCCc1c[nH]c2ccc(O)cc12" },
  { id: "adrenaline", name: "(R)-adrenaline", synonyms: ["adrenaline", "epinephrine", "(R)-epinephrine"], category: "biomolecule", smiles: "CNC[C@H](O)c1ccc(O)c(O)c1", cip: ["R"] },
  {
    id: "cholesterol",
    name: "cholesterol",
    synonyms: [],
    category: "biomolecule",
    smiles: "C[C@H](CCCC(C)C)[C@H]1CC[C@@H]2[C@@]1(CC[C@H]3[C@H]2CC=C4[C@@]3(CC[C@@H](C4)O)C)C",
    // (3S,8S,9S,10R,13R,14S,17R,20R), in SMILES order: C20, C17, C14, C13, C9, C8, C10, C3.
    cip: ["R", "R", "S", "R", "S", "S", "R", "S"],
    inchiKey: "HVYWMOMLDIMFJA-DPAQBDIFSA-N",
  },

  // ── Drugs ────────────────────────────────────────────────────────────────
  { id: "caffeine", name: "caffeine", synonyms: ["1,3,7-trimethylxanthine"], category: "drug", smiles: "Cn1cnc2c1c(=O)n(C)c(=O)n2C", inchiKey: "RYYVLZVUVIJVGH-UHFFFAOYSA-N" },
  { id: "aspirin", name: "aspirin", synonyms: ["acetylsalicylic acid", "ASA"], category: "drug", smiles: "CC(=O)Oc1ccccc1C(=O)O", inchiKey: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N" },
  { id: "salicylic-acid", name: "salicylic acid", synonyms: ["2-hydroxybenzoic acid"], category: "drug", smiles: "OC(=O)c1ccccc1O" },
  { id: "paracetamol", name: "paracetamol", synonyms: ["acetaminophen", "APAP"], category: "drug", smiles: "CC(=O)Nc1ccc(O)cc1", inchiKey: "RZVAJINKPMORJF-UHFFFAOYSA-N" },
  // Sold and dosed as the racemate, so the centre is deliberately left unset.
  { id: "ibuprofen", name: "ibuprofen", synonyms: [], category: "drug", smiles: "CC(C)Cc1ccc(cc1)C(C)C(=O)O", racemic: true },
  { id: "nicotine", name: "(S)-nicotine", synonyms: ["nicotine"], category: "drug", smiles: "CN1CCC[C@H]1c1cccnc1", cip: ["S"] },
];

// ---------------------------------------------------------------------------

const initRDKitModule = require("@rdkit/rdkit");
const RDKit = await initRDKitModule();

const failures = [];
const entries = [];
const seen = new Set();

for (const source of SOURCES) {
  const where = `${source.id} (${source.smiles})`;
  if (seen.has(source.id)) failures.push(`${where}: duplicate id`);
  seen.add(source.id);

  const mol = RDKit.get_mol(source.smiles);
  if (mol === null || !mol.is_valid()) {
    failures.push(`${where}: RDKit could not read the SMILES`);
    mol?.delete();
    continue;
  }
  try {
    const tags = JSON.parse(mol.get_stereo_tags());
    const cip = tags.CIP_atoms.sort((a, b) => a[0] - b[0]).map(([, label]) => label.replace(/[()]/g, ""));
    if (tags.CIP_bonds.length > 0) failures.push(`${where}: stereo double bonds are not supported here`);
    if (source.cip === undefined) {
      if (cip.length > 0 && source.racemic !== true) {
        failures.push(`${where}: has stereocentres ${cip.join(",")} but no expected cip to check them against`);
      }
    } else if (cip.join(",") !== source.cip.join(",")) {
      failures.push(`${where}: CIP ${cip.join(",")}, expected ${source.cip.join(",")}`);
    }

    const inchiKey = RDKit.get_inchikey_for_inchi(mol.get_inchi());
    if (source.inchiKey !== undefined && inchiKey !== source.inchiKey) {
      failures.push(`${where}: InChIKey ${inchiKey}, expected ${source.inchiKey}`);
    }

    // CoordGen, as the app's own "Clean up structure" uses.
    mol.set_new_coords(true);
    const lines = mol.get_molblock().split("\n");
    // Header line 1 is the title; RDKit leaves it blank.
    lines[0] = source.name;
    const molblock = lines.join("\n");
    if (molblock.includes("`") || molblock.includes("${")) {
      failures.push(`${where}: molblock would break the template literal`);
    }
    entries.push({ ...source, inchiKey, molblock });
  } finally {
    mol.delete();
  }
}

if (failures.length > 0) {
  console.error(`Refusing to write ${path.relative(process.cwd(), outFile)}:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}

const literal = (value) => JSON.stringify(value);
const body = entries
  .map((e) =>
    [
      "  {",
      `    id: ${literal(e.id)},`,
      `    name: ${literal(e.name)},`,
      `    synonyms: ${literal(e.synonyms)},`,
      `    category: ${literal(e.category)},`,
      `    smiles: ${literal(e.smiles)},`,
      `    inchiKey: ${literal(e.inchiKey)},`,
      `    molblock: \`${e.molblock}\`,`,
      "  },",
    ].join("\n"),
  )
  .join("\n");

const file = `/**
 * GENERATED by packages/client/scripts/build-structure-dictionary.mjs.
 * Do not edit by hand: change the source table in that script and run
 *
 *   pnpm --filter @starter/client build:dictionary
 *
 * Every molblock is RDKit's 2D layout of the row's SMILES, with the entry name
 * on the title line. \`smiles\` and \`inchiKey\` are provenance: chem-core never
 * parses either, and the client's fidelity test checks that each molblock
 * still means its SMILES.
 */

import type { DictionaryEntry } from "./dictionary.js";

export const DICTIONARY_ENTRIES: readonly DictionaryEntry[] = [
${body}
];
`;

await writeFile(outFile, file);
console.log(`Wrote ${entries.length} entries to ${path.relative(process.cwd(), outFile)}`);

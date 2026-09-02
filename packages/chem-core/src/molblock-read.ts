/**
 * V2000 molfile (molblock) reader.
 *
 * TOLERANCE IS THE POINT. Molfiles arrive from thirty years of programs that
 * each read the spec slightly differently: CRLF line endings, lines truncated
 * at the last non-blank field, a duplicated bond row, an atom index pointing
 * past the end of the atom block, a query atom symbol that is not an element.
 * A structure editor that throws on any of those simply cannot open the user's
 * files. So a malformed ROW is skipped with a structured warning, and only a
 * file that has no readable counts line at all is refused outright.
 *
 * The warnings are returned rather than logged: the caller decides whether to
 * show a banner, a dialog, or nothing.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: multi-record SDF iteration (it stops at
 * the first `$$$$`), the SDF data block, V3000, and query features (atom
 * lists, R-groups, bond topology).
 */

import { elementBySymbol, normalizeElementInput, requireElement } from "./elements.js";
import { kekulizeWithReport, type KekulizeResult } from "./aromatic.js";
import { MoleculeBuilder } from "./builders.js";
import { bondsAt, cloneAtomWith, degree, requireAtom, requireBond } from "./molecule.js";
import { ringSize, ringsAtAtom } from "./rings.js";
import { MOLFILE_BOND_LENGTH } from "./molblock-write.js";
import type { Atom, AtomId, Bond, BondId, BondOrder, BondStereo, Molecule } from "./types.js";
import { bondOrderSum, implicitHydrogenCount } from "./valence.js";
import { vec } from "./vec.js";

export interface MolblockReadOptions {
  /**
   * Molfile units per model bond length. Defaults to `MOLFILE_BOND_LENGTH`;
   * coordinates are DIVIDED by it, inverting what the writer does.
   */
  readonly coordinateScale?: number | undefined;
}

/**
 * Something the file said that could not be honoured. Every variant carries a
 * `message` fit to show a user and enough structure to act on programmatically.
 *
 * `line` is 1-based into the input text, so it lines up with what an editor
 * shows.
 */
export type MolblockWarning =
  | {
      readonly kind: "truncated-block";
      readonly message: string;
      readonly block: "atom" | "bond";
      readonly expected: number;
      readonly found: number;
    }
  | {
      readonly kind: "unknown-element";
      readonly message: string;
      readonly line: number;
      readonly row: number;
      readonly symbol: string;
    }
  | {
      readonly kind: "bad-numeric-field";
      readonly message: string;
      readonly line: number;
      readonly field: string;
      readonly text: string;
    }
  | {
      readonly kind: "duplicate-bond";
      readonly message: string;
      readonly line: number;
      readonly row: number;
    }
  | {
      readonly kind: "self-bond";
      readonly message: string;
      readonly line: number;
      readonly row: number;
    }
  | {
      readonly kind: "bad-bond-endpoint";
      readonly message: string;
      readonly line: number;
      readonly row: number;
      readonly index: number;
    }
  | {
      readonly kind: "unsupported-bond-type";
      readonly message: string;
      readonly line: number;
      readonly row: number;
      readonly type: number;
    }
  | {
      readonly kind: "unsupported-bond-stereo";
      readonly message: string;
      readonly line: number;
      readonly row: number;
      readonly stereo: number;
    }
  | {
      readonly kind: "bad-property-line";
      readonly message: string;
      readonly line: number;
    }
  | {
      readonly kind: "property-index-out-of-range";
      readonly message: string;
      readonly line: number;
      readonly index: number;
    }
  | {
      readonly kind: "unkekulized";
      readonly message: string;
      readonly atomIds: readonly AtomId[];
    }
  | {
      /**
       * The record is a 3D conformer, so the coordinates kept are a flat
       * projection. PubChem's default SDF download is 3D, which makes this the
       * likeliest file a user drags in; the atoms land on overlapping points
       * and only the caller can decide whether to re-lay-out in 2D.
       */
      readonly kind: "three-dimensional";
      readonly message: string;
      /** 1-based atom ROWS off the plane. Rows, not ids: the file is the only
       *  thing that exists when this is detected, and a row is what the user
       *  can find in it. */
      readonly rows: readonly number[];
    }
  | {
      /**
       * The body holds MORE rows than the counts line declares, so the surplus
       * was skipped to keep the bond block aligned. Distinct from
       * `truncated-block`, which is the file running short.
       */
      readonly kind: "surplus-block";
      readonly message: string;
      readonly block: "atom";
      readonly expected: number;
      readonly found: number;
    };

export interface MolblockReadResult {
  readonly molecule: Molecule;
  /** Header line 1, trailing whitespace removed. */
  readonly title: string;
  /** Header line 3, trailing whitespace removed. */
  readonly comment: string;
  readonly warnings: readonly MolblockWarning[];
}

/**
 * Thrown only when the text is not a molblock at all — too short to hold a
 * header, or with no readable counts line. Everything recoverable is a
 * warning; see the note at the top of the file.
 */
export class MolblockParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MolblockParseError";
  }
}

/** A molblock is four header/counts lines before any content. */
const MIN_MOLBLOCK_LINES = 4;

/**
 * How many blank lines may precede the record before we give up looking for
 * it. Files pasted out of a text box pick up one or two; a hundred means the
 * text is not a molblock.
 */
const MAX_LEADING_BLANKS = 8;

/**
 * How far off the z=0 plane an atom has to be before the record counts as 3D.
 * A 2D writer emits an exact `0.0000`, so anything nonzero is deliberate; the
 * epsilon only absorbs a rounding artefact.
 */
const Z_EPSILON = 1e-6;

/** `vvv` of 15 means "valence zero", since 0 already means "unspecified". */
const VALENCE_ZERO_CODE = 15;

/**
 * Legacy `ccc` atom-block charge codes. The column is superseded wholesale by
 * any `M  CHG` line, and cannot express a charge beyond +-3 — which is why
 * the writer never uses it.
 *
 * Code 4 is not a charge at all: it is "doublet radical", i.e. one unpaired
 * electron and a formal charge of zero.
 */
const LEGACY_DOUBLET_RADICAL_CODE = 4;
const LEGACY_CHARGE_BY_CODE: ReadonlyMap<number, number> = new Map([
  [0, 0],
  [1, 3],
  [2, 2],
  [3, 1],
  [4, 0],
  [5, -1],
  [6, -2],
  [7, -3],
]);

/**
 * `M  RAD` spin multiplicity to unpaired electrons: 1 singlet, 2 doublet,
 * 3 triplet. A singlet carbene has two paired electrons in one orbital, which
 * the model still records as two non-bonding electrons, so 1 and 3 both map
 * to 2 and only a doublet maps to 1.
 */
const RADICAL_ELECTRONS_BY_CODE: ReadonlyMap<number, number> = new Map([
  [0, 0],
  [1, 2],
  [2, 1],
  [3, 2],
]);

function bondStereoFromCode(code: number): BondStereo | undefined {
  switch (code) {
    case 0:
      return "none";
    case 1:
      return "wedge";
    case 3:
      // Cis/trans unspecified on a double bond — the crossed double bond.
      return "either";
    case 4:
      // The wavy single bond: configuration unknown at this centre.
      return "wavy";
    case 6:
      return "hash";
    default:
      return undefined;
  }
}

/** Fixed-column slice that tolerates a line that stops early. */
function column(line: string, start: number, end: number): string {
  if (line.length <= start) return "";
  return line.slice(start, end);
}

interface NumericField {
  readonly value: number;
  /** The column held something, and it was not a number. */
  readonly bad: boolean;
  readonly text: string;
}

/**
 * An EMPTY column is not an error — a writer that trims trailing fields is
 * within its rights, and the spec's own default for every one of them is 0.
 * A column with garbage in it is worth telling the user about.
 */
function readInt(line: string, start: number, end: number): NumericField {
  const text = column(line, start, end).trim();
  if (text === "") return { value: 0, bad: false, text };
  if (!/^[+-]?\d+$/.test(text)) return { value: 0, bad: true, text };
  return { value: Number.parseInt(text, 10), bad: false, text };
}

function readFloat(line: string, start: number, end: number): NumericField {
  const text = column(line, start, end).trim();
  if (text === "") return { value: 0, bad: false, text };
  const value = Number(text);
  if (!Number.isFinite(value)) return { value: 0, bad: true, text };
  return { value, bad: false, text };
}

interface Counts {
  readonly atomCount: number;
  readonly bondCount: number;
  readonly isV3000: boolean;
}

/**
 * Recognise a counts line without trusting it.
 *
 * Used as a PROBE as well as a parser: the search for the start of the record
 * asks "is this a counts line?" of several candidates, so it must reject a
 * title or comment line rather than coerce one.
 */
function parseCounts(line: string): Counts | undefined {
  if (line.trim() === "") return undefined;
  if (column(line, 0, 3).trim() === "") return undefined;
  const atoms = readInt(line, 0, 3);
  const bonds = readInt(line, 3, 6);
  if (atoms.bad || bonds.bad) return undefined;
  if (atoms.value < 0 || bonds.value < 0) return undefined;
  return {
    atomCount: atoms.value,
    bondCount: bonds.value,
    isV3000: line.includes("V3000"),
  };
}

/**
 * Index of the title line.
 *
 * Offset 0 is tried FIRST and wins whenever it parses, so a record whose title
 * line is legitimately blank keeps its blank title. Only when that fails do we
 * start skipping leading blank lines, which is the shape text pasted out of a
 * web form arrives in.
 */
function findRecordStart(lines: readonly string[]): number | undefined {
  const limit = Math.min(lines.length, MAX_LEADING_BLANKS + 1);
  for (let offset = 0; offset < limit; offset++) {
    if (offset > 0 && (lines[offset - 1] ?? "").trim() !== "") break;
    const counts = lines[offset + 3];
    if (counts !== undefined && parseCounts(counts)) return offset;
  }
  return undefined;
}

/** A parsed atom row, before anything is decided about it. */
interface AtomRow {
  readonly row: number;
  readonly line: number;
  readonly symbol: string;
  readonly x: number;
  readonly y: number;
  /** Kept only to notice a 3D record; the model is 2D and drops it. */
  readonly z: number;
  readonly massDiff: number;
  readonly legacyCharge: number;
  readonly hydrogenField: number;
  readonly valenceField: number;
}

interface BondRow {
  readonly row: number;
  readonly line: number;
  readonly from: number;
  readonly to: number;
  readonly type: number;
  readonly stereo: number;
}

/**
 * The element symbol sits in columns 32-34. A few writers (and every
 * hand-edited file) put it somewhere else on an otherwise well-formed line,
 * so an empty slot falls back to the fourth whitespace-separated token, which
 * is where it lands once x/y/z are consumed.
 */
function readSymbol(line: string): string {
  const fixed = column(line, 31, 34).trim();
  if (fixed !== "") return fixed;
  const tokens = line.trim().split(/\s+/);
  return tokens[3] ?? "";
}

/**
 * Whether a line is plausibly an atom row rather than a bond row, a property
 * line, or a record separator.
 *
 * Needed because the counts line is not always honest, and reading the body
 * purely at the offsets it implies turns one miscount into a cascade: a bond
 * row read as an atom row yields no element, so `M  CHG` gets read as a bond
 * row and the charges are lost, and the caller sees nine warnings that all
 * describe symptoms rather than the cause.
 *
 * The test is deliberately generous in the direction that matters. An atom row
 * carries decimal coordinates in its first thirty columns; a bond row, an
 * `M  ` line and `$$$$` carry no decimal point at all. A sloppy writer that
 * emits integer coordinates is still recognised, because its symbol column
 * resolves to an element — which is also what keeps a query atom (`A`, `R#`,
 * `*`) from ending the block, since those must be skipped with a warning
 * rather than treated as the end of the atoms.
 */
function looksLikeAtomRow(line: string): boolean {
  if (line.trim() === "") return false;
  if (/\d\.\d/.test(line.slice(0, 31))) return true;
  return resolveElement(readSymbol(line)) !== undefined;
}

/**
 * Canonical symbol, or undefined.
 *
 * Case-sensitive first, because "CO" is cobalt and "Co" is cobalt but "C" plus
 * "O" is not; only when the exact form is unknown do we try the loose
 * normalisation that rescues an all-caps "CL".
 */
function resolveElement(symbol: string): string | undefined {
  if (symbol === "") return undefined;
  if (elementBySymbol(symbol)) return symbol;
  return normalizeElementInput(symbol);
}

/**
 * The separator is written as the ESCAPE `\u0000`, never as a literal NUL
 * byte. A control byte in the source makes every grep treat this file as
 * binary and skip it silently, so a repo-wide search for a symbol declared
 * here comes back empty — which is exactly how a stale reference survives a
 * refactor. Same reason the BOM strip below is an escape.
 */
function pairKey(a: AtomId, b: AtomId): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/**
 * Rewrite the molecule's `explicitHydrogenCount` pins to exactly `pins`.
 *
 * One pass over the atoms rather than repeated `updateAtom` calls, which are
 * O(n) each and would make an import of a large SDF record quadratic.
 * `cloneAtomWith` is what knows to DELETE the key for an atom not in the map
 * rather than store `undefined` — the difference matters, because
 * `Object.hasOwn` is how the rest of the package asks whether a count is
 * pinned.
 */
function setHydrogenPins(mol: Molecule, pins: ReadonlyMap<AtomId, number>): Molecule {
  let changed = false;
  const atoms: Record<AtomId, Atom> = {};
  for (const id of mol.atomIds) {
    const atom = requireAtom(mol, id);
    const wanted = pins.get(id);
    if (atom.explicitHydrogenCount === wanted) {
      atoms[id] = atom;
      continue;
    }
    atoms[id] = cloneAtomWith(atom, { explicitHydrogenCount: wanted });
    changed = true;
  }
  return changed ? { ...mol, atoms } : mol;
}

/**
 * Parse a `M  CHG` / `M  ISO` / `M  RAD` payload into (row, value) pairs.
 *
 * Reads whitespace-separated integers rather than the spec's fixed 4-column
 * fields: a 4-column field cannot hold a four-digit atom index, and writers
 * that produce large files run the columns together, so column slicing loses
 * data on exactly the files that are hardest to re-create. The declared count
 * still bounds the result, so trailing junk on the line cannot inject pairs.
 */
function parsePropertyPairs(line: string): [number, number][] | undefined {
  const tokens = line.slice(6).match(/-?\d+/g);
  if (!tokens || tokens.length === 0) return undefined;
  const declared = Number.parseInt(tokens[0] ?? "", 10);
  if (!Number.isFinite(declared) || declared < 0) return undefined;
  const available = Math.floor((tokens.length - 1) / 2);
  const count = Math.min(declared, available);
  const pairs: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const index = Number.parseInt(tokens[1 + 2 * i] ?? "", 10);
    const value = Number.parseInt(tokens[2 + 2 * i] ?? "", 10);
    if (!Number.isFinite(index) || !Number.isFinite(value)) continue;
    pairs.push([index, value]);
  }
  return pairs;
}

/**
 * Parse a V2000 molblock.
 *
 * @throws {MolblockParseError} only when the text is not a molblock.
 */
export function readMolblock(
  text: string,
  options: MolblockReadOptions = {},
): MolblockReadResult {
  const scale = options.coordinateScale ?? MOLFILE_BOND_LENGTH;
  const warnings: MolblockWarning[] = [];

  // A leading BOM survives copy-paste out of Windows tooling and would
  // otherwise become part of the title.
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r\n|\n|\r/).map((line) => line.replace(/\s+$/, ""));

  // Trailing blank lines are noise: the final newline of a well-formed file
  // produces one all by itself, and text pasted out of a form brings more.
  // Left in place they would be read as atom or bond rows and reported as
  // malformed, which is a warning about the user's newline key.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  if (lines.length < MIN_MOLBLOCK_LINES) {
    throw new MolblockParseError(
      `A molblock needs at least ${MIN_MOLBLOCK_LINES} lines (title, program, ` +
        `comment, counts); got ${lines.length}.`,
    );
  }

  const start = findRecordStart(lines);
  if (start === undefined) {
    throw new MolblockParseError(
      "No readable V2000 counts line found on the fourth line of the record. " +
        "This does not look like a molblock.",
    );
  }

  const countsLine = lines[start + 3] ?? "";
  const counts = parseCounts(countsLine);
  if (!counts) {
    throw new MolblockParseError(`Unreadable counts line: "${countsLine}"`);
  }
  if (counts.isV3000) {
    throw new MolblockParseError(
      "This is a V3000 molfile. Only V2000 is supported here; V3000 has an " +
        "entirely different, tag-based body.",
    );
  }

  const title = lines[start] ?? "";
  const comment = lines[start + 2] ?? "";

  // -------------------------------------------------------------------------
  // Atom block
  // -------------------------------------------------------------------------
  const atomBlockStart = start + 4;
  const atomRows: AtomRow[] = [];
  // Row index -> atom id, in an ARRAY on purpose. An object keyed by a number
  // parsed out of the file would resolve "constructor" and "__proto__" to
  // inherited members; an array index cannot.
  const rowToAtomId: (AtomId | undefined)[] = [];

  let readAtomLines = 0;
  for (let i = 0; i < counts.atomCount; i++) {
    const lineIndex = atomBlockStart + i;
    const line = lines[lineIndex];
    if (line === undefined) break;
    // A counts line that over-declares its atoms would otherwise eat the bond
    // and property blocks one row at a time. Stopping at the first line that
    // is not an atom row costs nothing on a well-formed file and recovers the
    // bonds and charges on a malformed one.
    if (!looksLikeAtomRow(line)) break;
    readAtomLines++;
    const row = i + 1;
    const lineNumber = lineIndex + 1;

    const x = readFloat(line, 0, 10);
    const y = readFloat(line, 10, 20);
    const z = readFloat(line, 20, 30);
    const massDiff = readInt(line, 34, 36);
    const legacyCharge = readInt(line, 36, 39);
    const hydrogenField = readInt(line, 42, 45);
    const valenceField = readInt(line, 48, 51);

    for (const [field, parsed] of [
      ["x", x],
      ["y", y],
      ["z", z],
      ["mass difference", massDiff],
      ["charge", legacyCharge],
      ["hydrogen count", hydrogenField],
      ["valence", valenceField],
    ] as const) {
      if (parsed.bad) {
        warnings.push({
          kind: "bad-numeric-field",
          message: `Atom ${row}: unreadable ${field} field "${parsed.text}"; using 0.`,
          line: lineNumber,
          field,
          text: parsed.text,
        });
      }
    }

    atomRows.push({
      row,
      line: lineNumber,
      symbol: readSymbol(line),
      x: x.value,
      y: y.value,
      z: z.value,
      massDiff: massDiff.value,
      legacyCharge: legacyCharge.value,
      hydrogenField: hydrogenField.value,
      valenceField: valenceField.value,
    });
  }

  if (readAtomLines < counts.atomCount) {
    warnings.push({
      kind: "truncated-block",
      message:
        `The counts line declares ${counts.atomCount} atoms but the atom block ` +
        `ends after ${readAtomLines}.`,
      block: "atom",
      expected: counts.atomCount,
      found: readAtomLines,
    });
  }

  // A 3D conformer is the shape PubChem hands out by default, and flattening
  // it is not something the caller can notice after the fact: the atoms arrive
  // at projected, frequently coincident points with correct connectivity, so
  // the structure looks merely badly laid out. Reported so the UI can offer a
  // 2D re-layout. Header line 2 carries the dimensional code in columns 21-22;
  // a nonzero z settles it for the writers that leave the code blank.
  const spatialAtomIds = atomRows
    .filter((atom) => Math.abs(atom.z) > Z_EPSILON)
    .map((atom) => atom.row);
  const declared3D = column(lines[start + 1] ?? "", 20, 22).trim().toUpperCase() === "3D";
  if (spatialAtomIds.length > 0 || (declared3D && atomRows.length > 0)) {
    warnings.push({
      kind: "three-dimensional",
      message:
        `This is a 3D record${
          spatialAtomIds.length > 0 ? ` (${spatialAtomIds.length} atom(s) off the z=0 plane)` : ""
        }; the z coordinate was dropped and the atoms kept their flat ` +
        `projection, which may overlap. A 2D layout pass is likely wanted.`,
      rows: spatialAtomIds,
    });
  }

  // -------------------------------------------------------------------------
  // Bond block
  //
  // Read from where the ATOM BLOCK actually stopped. For a well-formed file
  // that is exactly the offset the counts line implies; for a file whose
  // counts line disagrees with its body it is the difference between one
  // accurate warning and a cascade of misleading ones.
  //
  // The surplus case is the more dangerous of the two, because it is silent:
  // a counts line whose atom field overflowed to `1000` reads as 100 atoms and
  // 0 bonds, and the 900 remaining rows land in the property scan, which
  // ignores anything not starting with "M  ". Ninety per cent of the structure
  // then disappears with an empty warnings array. So the surplus rows are
  // counted and reported, and skipped so the bond block still lines up.
  // -------------------------------------------------------------------------
  let bondBlockStart = atomBlockStart + readAtomLines;
  let surplusAtomRows = 0;
  while (looksLikeAtomRow(lines[bondBlockStart + surplusAtomRows] ?? "")) {
    surplusAtomRows++;
  }
  if (surplusAtomRows > 0) {
    const found = readAtomLines + surplusAtomRows;
    warnings.push({
      kind: "surplus-block",
      message:
        `The counts line declares ${counts.atomCount} atoms but the atom block ` +
        `runs to ${found} rows; the ${surplusAtomRows} extra row(s) were skipped.`,
      block: "atom",
      expected: counts.atomCount,
      found,
    });
    bondBlockStart += surplusAtomRows;
  }
  const bondRows: BondRow[] = [];
  let readBondLines = 0;
  for (let i = 0; i < counts.bondCount; i++) {
    const lineIndex = bondBlockStart + i;
    const line = lines[lineIndex];
    if (line === undefined) break;
    // The properties block, a record separator or the end of the structure —
    // reachable when the atom block stopped short, and reading `M  END` as a
    // bond row helps nobody.
    const ahead = line.trim();
    if (line.startsWith("M  ") || ahead === "M END" || ahead === "$$$$") break;
    readBondLines++;
    const row = i + 1;
    const lineNumber = lineIndex + 1;

    const from = readInt(line, 0, 3);
    const to = readInt(line, 3, 6);
    const type = readInt(line, 6, 9);
    const stereo = readInt(line, 9, 12);

    for (const [field, parsed] of [
      ["first atom", from],
      ["second atom", to],
      ["type", type],
      ["stereo", stereo],
    ] as const) {
      if (parsed.bad) {
        warnings.push({
          kind: "bad-numeric-field",
          message: `Bond ${row}: unreadable ${field} field "${parsed.text}"; using 0.`,
          line: lineNumber,
          field,
          text: parsed.text,
        });
      }
    }

    bondRows.push({
      row,
      line: lineNumber,
      from: from.value,
      to: to.value,
      type: type.value,
      stereo: stereo.value,
    });
  }

  if (readBondLines < counts.bondCount) {
    warnings.push({
      kind: "truncated-block",
      message:
        `The counts line declares ${counts.bondCount} bonds but the bond block ` +
        `ends after ${readBondLines}.`,
      block: "bond",
      expected: counts.bondCount,
      found: readBondLines,
    });
  }

  // -------------------------------------------------------------------------
  // Properties block
  // -------------------------------------------------------------------------
  const chargeByRow = new Map<number, number>();
  const isotopeByRow = new Map<number, number>();
  const radicalByRow = new Map<number, number>();
  let sawChargeProperty = false;
  let sawIsotopeProperty = false;
  let sawRadicalProperty = false;

  for (let i = bondBlockStart + readBondLines; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed === "M  END" || trimmed === "M END") break;
    // A `$$$$` separator means an SDF; stop before the next record's data
    // leaks into this one. Multi-record iteration is a separate job.
    if (trimmed === "$$$$") break;
    if (!line.startsWith("M  ")) continue;

    const tag = line.slice(3, 6);
    if (tag !== "CHG" && tag !== "ISO" && tag !== "RAD") continue;

    const pairs = parsePropertyPairs(line);
    if (!pairs) {
      warnings.push({
        kind: "bad-property-line",
        message: `Unreadable "M  ${tag}" property line; ignored.`,
        line: i + 1,
      });
      continue;
    }

    // Presence, not content, is what supersedes the legacy columns — an
    // `M  CHG  0` line is a writer saying "there are no charges", and the
    // spec makes that override any leftover ccc digits.
    if (tag === "CHG") sawChargeProperty = true;
    if (tag === "ISO") sawIsotopeProperty = true;
    if (tag === "RAD") sawRadicalProperty = true;

    for (const [index, value] of pairs) {
      if (index < 1 || index > atomRows.length) {
        warnings.push({
          kind: "property-index-out-of-range",
          message: `"M  ${tag}" names atom ${index}, which does not exist; ignored.`,
          line: i + 1,
          index,
        });
        continue;
      }
      if (tag === "CHG") chargeByRow.set(index, value);
      else if (tag === "ISO") isotopeByRow.set(index, value);
      else radicalByRow.set(index, value);
    }
  }

  // -------------------------------------------------------------------------
  // Build
  //
  // Through MoleculeBuilder: `addAtom`/`addBond` copy the whole record on
  // every call, so a loop over them is quadratic.
  // -------------------------------------------------------------------------
  const builder = new MoleculeBuilder();
  // Parallel to the atom ids: what the file asserted about each atom's
  // hydrogens, resolved once the molecule exists.
  const assertionByAtomId = new Map<AtomId, { hydrogenField: number; valenceField: number }>();

  for (const atom of atomRows) {
    const element = resolveElement(atom.symbol);
    if (element === undefined) {
      warnings.push({
        kind: "unknown-element",
        message:
          `Atom ${atom.row} has symbol "${atom.symbol}", which is not an element ` +
          `(query atoms and R-groups are not supported); the atom was skipped.`,
        line: atom.line,
        row: atom.row,
        symbol: atom.symbol,
      });
      rowToAtomId[atom.row] = undefined;
      continue;
    }

    // `M  CHG` supersedes the ccc column wholesale — not per atom. A file that
    // carries both and disagrees is a file whose ccc digits are stale.
    const charge = sawChargeProperty
      ? (chargeByRow.get(atom.row) ?? 0)
      : (LEGACY_CHARGE_BY_CODE.get(atom.legacyCharge) ?? 0);

    let radicalElectrons = 0;
    if (sawRadicalProperty) {
      radicalElectrons = RADICAL_ELECTRONS_BY_CODE.get(radicalByRow.get(atom.row) ?? 0) ?? 0;
    } else if (atom.legacyCharge === LEGACY_DOUBLET_RADICAL_CODE) {
      radicalElectrons = 1;
    }

    let isotope: number | undefined;
    if (sawIsotopeProperty) {
      // `M  ISO` is ABSOLUTE: it carries the mass number itself. A value of 0
      // is the spec's way of saying "natural abundance", i.e. CLEAR any
      // isotope — not "a nuclide of mass number zero", which is what taking
      // the field at face value stored, and which then round-tripped forever
      // and drew as a literal superscript 0.
      const declared = isotopeByRow.get(atom.row);
      isotope = declared === undefined || declared <= 0 ? undefined : declared;
    } else if (atom.massDiff !== 0) {
      // `dd` is RELATIVE, to the element's MOST ABUNDANT isotope — which is
      // what MDL means and what RDKit's parser uses. Rounding the standard
      // atomic weight instead is a near-miss that gets bromine and selenium
      // wrong: round(79.904) is 80, but bromine's reference mass number is 79,
      // so `dd` of 2 would read 81-Br as 82-Br, a nuclide that does not exist.
      // Selenium, nickel, copper and zinc go the same way. `monoisotopic` is
      // exactly that number and is already in the table; `weight` is the
      // fallback for the handful of elements where it is not populated.
      const info = requireElement(element);
      const reference = Math.round(info.monoisotopic ?? info.weight);
      isotope = reference + atom.massDiff;
    }

    const id = builder.atom(element, vec(atom.x / scale, atom.y / scale), {
      charge,
      radicalElectrons,
      isotope,
    });
    rowToAtomId[atom.row] = id;
    assertionByAtomId.set(id, {
      hydrogenField: atom.hydrogenField,
      valenceField: atom.valenceField,
    });
  }

  // Bond rows accepted so far, so a duplicate can be spotted BEFORE
  // `builder.bond` throws on it — the builder treats a duplicate as a
  // programming error, which is right for the editor and wrong for an import.
  const seenPairs = new Set<string>();
  const aromaticBondIds: BondId[] = [];

  for (const bond of bondRows) {
    const endpointFor = (index: number): AtomId | undefined =>
      index >= 1 && index <= atomRows.length ? rowToAtomId[index] : undefined;

    const from = endpointFor(bond.from);
    const to = endpointFor(bond.to);
    if (from === undefined || to === undefined) {
      const missing = from === undefined ? bond.from : bond.to;
      warnings.push({
        kind: "bad-bond-endpoint",
        message:
          `Bond ${bond.row} names atom ${missing}, which is not in the file ` +
          `(or was itself skipped); the bond was dropped.`,
        line: bond.line,
        row: bond.row,
        index: missing,
      });
      continue;
    }
    if (from === to) {
      warnings.push({
        kind: "self-bond",
        message: `Bond ${bond.row} joins atom ${bond.from} to itself; dropped.`,
        line: bond.line,
        row: bond.row,
      });
      continue;
    }
    const key = pairKey(from, to);
    if (seenPairs.has(key)) {
      warnings.push({
        kind: "duplicate-bond",
        message:
          `Bond ${bond.row} repeats the bond between atoms ${bond.from} and ` +
          `${bond.to}; the later row was dropped.`,
        line: bond.line,
        row: bond.row,
      });
      continue;
    }

    let order: BondOrder = 1;
    let aromatic = false;
    if (bond.type === 1 || bond.type === 2 || bond.type === 3) {
      order = bond.type;
    } else if (bond.type === 4) {
      aromatic = true;
    } else {
      warnings.push({
        kind: "unsupported-bond-type",
        message:
          `Bond ${bond.row} has type ${bond.type} (a query bond type); read as ` +
          `a single bond.`,
        line: bond.line,
        row: bond.row,
        type: bond.type,
      });
    }

    let stereo = bondStereoFromCode(bond.stereo);
    if (stereo === undefined) {
      warnings.push({
        kind: "unsupported-bond-stereo",
        message: `Bond ${bond.row} has stereo code ${bond.stereo}; read as plain.`,
        line: bond.line,
        row: bond.row,
        stereo: bond.stereo,
      });
      stereo = "none";
    }

    seenPairs.add(key);
    // `from` first, matching the row order: the narrow end of a wedge is at
    // the file's first atom, and swapping the endpoints here would invert
    // every stereocentre in the structure.
    const bondId = builder.bond(from, to, order, stereo);
    if (aromatic) aromaticBondIds.push(bondId);
  }

  let molecule = builder.build();

  // Aromatic flags in one post-pass: `MoleculeBuilder.bond` has no aromatic
  // parameter, and setting them through `updateBond` would be O(n) per bond.
  if (aromaticBondIds.length > 0) {
    const bonds: Record<BondId, Bond> = { ...molecule.bonds };
    const atoms: Record<AtomId, Atom> = { ...molecule.atoms };
    for (const bondId of aromaticBondIds) {
      const bond = requireBond(molecule, bondId);
      bonds[bondId] = { ...bond, aromatic: true };
      for (const end of [bond.from, bond.to]) {
        atoms[end] = cloneAtomWith(requireAtom(molecule, end), { aromatic: true });
      }
    }
    molecule = { ...molecule, atoms, bonds };
  }

  // -------------------------------------------------------------------------
  // Hydrogens, then kekulisation, then hydrogens again.
  //
  // The order looks redundant and is not. `kekulize` decides which ring atoms
  // need a double bond by asking how many hydrogens they have, so pyrrole's
  // aromatic form only resolves if the file's N-H assertion is in place first
  // — without it the nitrogen is told it needs a ring double bond, the count
  // of needy atoms comes out odd, and the whole ring is left un-Kekulised.
  //
  // But a pin that was only needed to work around the flagged form must not
  // survive into the result. Pinning an atom freezes its hydrogen count, so
  // later edits stop adjusting it; a molecule imported with a pin on every
  // atom stops behaving like a drawing. So the pins are recomputed against the
  // KEKULISED structure and kept only where the file and the model still
  // disagree — which is the case pinning exists for.
  // -------------------------------------------------------------------------
  const filePins = hydrogenPins(molecule, assertionByAtomId);
  molecule = setHydrogenPins(molecule, filePins);

  const kekulized = kekulizeAromatic(molecule, filePins, assertionByAtomId);
  molecule = kekulized.molecule;
  if (kekulized.unkekulizedAtomIds.length > 0) {
    warnings.push({
      kind: "unkekulized",
      message:
        `${kekulized.unkekulizedAtomIds.length} atom(s) in an aromatic ring ` +
        `could not be given a Kekule structure; those rings keep their ` +
        `aromatic flags.`,
      atomIds: kekulized.unkekulizedAtomIds,
    });
  }

  molecule = setHydrogenPins(molecule, new Map());
  molecule = setHydrogenPins(molecule, hydrogenPins(molecule, assertionByAtomId));

  return { molecule, title, comment, warnings };
}

/**
 * Elements that can play pyrrole's nitrogen: a ring atom that carries a
 * hydrogen and donates its lone pair, instead of taking a ring double bond.
 *
 * Restricted to the two that actually occur. Oxygen and sulfur are excluded
 * because their neutral aromatic form has no hydrogen at all (furan,
 * thiophene) and `needsRingDouble` already gets them right; carbon is excluded
 * because a neutral aromatic carbon always takes a double bond.
 */
const PYRROLE_TYPE_ELEMENTS: ReadonlySet<string> = new Set(["N", "P"]);

/**
 * How many rounds of "give one more ring a hydrogen" the retry may run.
 *
 * Each round costs one kekulisation pass, and a round pins one candidate in
 * EVERY still-failing component at once, so a whole SDF page of pyrroles is
 * resolved in the first round and porphyrin's two N-H in the second. A system
 * still unresolved after eight is one whose `unkekulized` warning is the
 * honest answer.
 */
const MAX_KEKULIZE_ROUNDS = 8;

/**
 * Kekulise, retrying the case a molfile cannot state.
 *
 * WHY A RETRY IS NEEDED. An aromatic-form record from Marvin or ChemDraw
 * leaves `hhh` at 0 on every atom, so nothing tells the reader that pyrrole's
 * nitrogen carries a hydrogen. Without it the nitrogen looks like one that
 * needs a ring double bond, all five ring atoms do, the count is odd, and
 * `matchNeeding` bails — leaving a molecule that is still flagged aromatic,
 * still has every ring bond at order 1, and reports C4H4N. Re-exporting that
 * asserts `hhh = 1`, positively claiming pyrrole's nitrogen has no hydrogen.
 * Pyrrole, imidazole, pyrazole, indole and the purine cores are the whole N-H
 * heterocycle family, so this is not an edge case.
 *
 * WHAT THE RETRY DOES. What RDKit's kekuliser does when it lets an aromatic
 * nitrogen choose between a lone pair and a double bond: pin a candidate to
 * one hydrogen and try again. Each pin flips the parity of its component's
 * "needs a double bond" count, so a system wanting two N-H (porphyrin) is
 * reached on the second round.
 *
 * PER COMPONENT, NOT PER MOLECULE. Kekulisation already treats each aromatic
 * component independently, and so must this: pinning one candidate at a time
 * across the whole molecule needs one round per ring, so an SDF record holding
 * a hundred pyrroles would exhaust any sane budget and resolve none of them.
 * A round pins one candidate in every still-failing component simultaneously.
 *
 * CANDIDATE ORDER decides which tautomer a file that did not say gets. Smaller
 * ring first, because the pyrrole-type nitrogen is the one in the five-ring
 * and the pyridine-type nitrogen is the one in the six-ring — so 7-azaindole
 * comes back as the 1H tautomer rather than an invented one. Ties break on
 * `atomIds` order, which makes the choice deterministic. A file that states an
 * atom's hydrogens is never affected: an atom with an assertion is not a
 * candidate at all.
 *
 * THE PINS ARE SCAFFOLDING. `readMolblock` clears every pin after this and
 * re-derives them from the file's assertions against the kekulised structure,
 * so a hydrogen invented here shows up as a bond order, never as a stored
 * count that later edits stop adjusting.
 */
function kekulizeAromatic(
  mol: Molecule,
  filePins: ReadonlyMap<AtomId, number>,
  assertions: ReadonlyMap<AtomId, { hydrogenField: number; valenceField: number }>,
): KekulizeResult {
  let best = kekulizeWithReport(mol);
  if (best.unkekulizedAtomIds.length === 0) return best;

  const order = new Map<AtomId, number>();
  mol.atomIds.forEach((id, i) => order.set(id, i));
  const pins = new Map(filePins);
  const spent = new Set<AtomId>();

  for (let round = 0; round < MAX_KEKULIZE_ROUNDS; round++) {
    let pinnedThisRound = false;
    for (const component of failedComponents(mol, best.unkekulizedAtomIds)) {
      const candidate = component
        .filter((id) => !spent.has(id) && isPyrroleTypeCandidate(mol, id, assertions))
        .sort((a, b) => {
          const sizeDiff = smallestRingSize(mol, a) - smallestRingSize(mol, b);
          if (sizeDiff !== 0) return sizeDiff;
          return (order.get(a) ?? 0) - (order.get(b) ?? 0);
        })[0];
      if (candidate === undefined) continue;
      spent.add(candidate);
      pins.set(candidate, 1);
      pinnedThisRound = true;
    }
    if (!pinnedThisRound) return best;

    const retry = kekulizeWithReport(setHydrogenPins(mol, pins));
    // Strictly fewer failures, or nothing changed and we stop: a round that
    // made things worse (possible, since a pin can strand a neighbour) is
    // discarded rather than returned.
    if (retry.unkekulizedAtomIds.length < best.unkekulizedAtomIds.length) {
      best = retry;
      if (best.unkekulizedAtomIds.length === 0) return best;
    }
  }
  return best;
}

/** Whether an atom could be the N-H a molfile in aromatic form cannot state. */
function isPyrroleTypeCandidate(
  mol: Molecule,
  atomId: AtomId,
  assertions: ReadonlyMap<AtomId, { hydrogenField: number; valenceField: number }>,
): boolean {
  const atom = requireAtom(mol, atomId);
  if (!PYRROLE_TYPE_ELEMENTS.has(atom.element)) return false;
  if (atom.charge !== 0 || atom.radicalElectrons !== 0) return false;
  // A file that stated this atom's hydrogens has already been believed;
  // overriding it here would be the reader inventing chemistry.
  const stated = assertedHydrogenCount(mol, atomId, assertions.get(atomId) ?? EMPTY_ASSERTION);
  if (stated !== undefined) return false;
  // Two ring neighbours and nothing else. An N-methylpyrrole nitrogen has
  // three and wants no hydrogen.
  return degree(mol, atomId) === 2;
}

const EMPTY_ASSERTION = { hydrogenField: 0, valenceField: 0 };

/**
 * The un-Kekulised atoms grouped into the aromatic components they came from.
 *
 * `kekulizeWithReport` reports the atoms flat, but it decides per component,
 * and so does the retry: one ring failing must not cost another ring its
 * hydrogen. Rebuilt here by walking the still-aromatic bonds rather than
 * exported from aromatic.ts, which keeps the retry — a molfile concern about
 * a field molfiles do not have — out of the chemistry module.
 */
function failedComponents(mol: Molecule, failed: readonly AtomId[]): AtomId[][] {
  const remaining = new Set(failed);
  const components: AtomId[][] = [];
  for (const start of failed) {
    if (!remaining.has(start)) continue;
    remaining.delete(start);
    const component = [start];
    for (let head = 0; head < component.length; head++) {
      for (const bond of bondsAt(mol, component[head] ?? "")) {
        if (!bond.aromatic) continue;
        const next = bond.from === component[head] ? bond.to : bond.from;
        if (!remaining.has(next)) continue;
        remaining.delete(next);
        component.push(next);
      }
    }
    components.push(component);
  }
  return components;
}

/** Smallest ring containing `atomId`, or `Infinity` for an acyclic atom. */
function smallestRingSize(mol: Molecule, atomId: AtomId): number {
  let smallest = Infinity;
  for (const index of ringsAtAtom(mol, atomId)) {
    smallest = Math.min(smallest, ringSize(mol, index));
  }
  return smallest;
}

/**
 * Which atoms need their hydrogen count pinned, given a molecule carrying NO
 * pins at all.
 *
 * The file asserts a count; the model derives one. They agree for almost every
 * atom, and pinning those would be actively harmful — a pinned count no longer
 * responds to edits, so an imported ethanol would keep three hydrogens on a
 * carbon after the user bonded something else to it. Pinning none of them
 * loses the cases valence cannot recover, pyrrole's N-H first among them. So:
 * pin exactly the disagreements.
 */
function hydrogenPins(
  mol: Molecule,
  assertions: ReadonlyMap<AtomId, { hydrogenField: number; valenceField: number }>,
): Map<AtomId, number> {
  const pins = new Map<AtomId, number>();
  for (const id of mol.atomIds) {
    const assertion = assertions.get(id);
    if (!assertion) continue;
    const asserted = assertedHydrogenCount(mol, id, assertion);
    if (asserted === undefined) continue;
    if (asserted !== implicitHydrogenCount(mol, id)) pins.set(id, asserted);
  }
  return pins;
}

/**
 * The hydrogen count the FILE claims, or undefined if it claims nothing.
 *
 * `hhh` is the count plus one, so 0 means unspecified. When it is unspecified
 * the `vvv` valence field is the fallback, because that is what RDKit writes
 * for an atom whose valence it wants to pin: the hydrogens are whatever is
 * left after the drawn bonds are subtracted from it. `vvv` of 15 is the
 * spec's way of saying "valence zero", since 0 is already taken.
 */
function assertedHydrogenCount(
  mol: Molecule,
  atomId: AtomId,
  assertion: { hydrogenField: number; valenceField: number },
): number | undefined {
  if (assertion.hydrogenField > 0) return assertion.hydrogenField - 1;
  if (assertion.valenceField === 0) return undefined;
  const valence =
    assertion.valenceField === VALENCE_ZERO_CODE ? 0 : assertion.valenceField;
  // An aromatic-flagged bond contributes 1.5, so the difference can be a half
  // integer while the flags are still on; rounding keeps it a count.
  return Math.max(0, Math.round(valence - bondOrderSum(mol, atomId)));
}

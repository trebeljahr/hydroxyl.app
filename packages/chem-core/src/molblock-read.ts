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
 * BOTH GENERATIONS, dispatched from the counts line (decision 90). V3000 is not
 * an exotic case to punt on: RDKit answers in V3000 unprompted for a structure
 * past 999 atoms or with coordinates too wide for the V2000 fields, so refusing
 * it made the client's RDKit bridge mark every such answer's verification
 * "unavailable" — an unchecked round trip on a file that was perfectly readable.
 * Enhanced stereochemistry has no V2000 spelling at all, which makes V3000 the
 * only way an ABS/AND/OR collection arrives.
 *
 * The V3000 body gets the SAME tolerance rule: a malformed row, an unsupported
 * block and an unsupported collection are each a structured warning and are
 * skipped. Only text that is not a molblock at all throws.
 *
 * QUERY FEATURES ARE READ (decision 238): `R#` with `M  RGP`, `R`, `A`, `*`,
 * `L` with `M  ALS`, V3000's bracketed and `NOT` lists and `RGROUPS=`, the MDL
 * generic symbols (`Q`, `X`, `M`, `AH`…), an `A  ` alias on a pseudo atom, and
 * query bond types 5-8. They arrive as atoms and bonds carrying a `query`, so
 * a Markush core no longer loses its R-groups on the way in. A symbol that is
 * neither an element nor one of those is a pseudo atom ("Pol", "D") and is
 * kept as a generic atom bearing that label, with a `pseudo-atom` note.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: multi-record SDF iteration (it stops at
 * the first `$$$$`), the SDF data block, R-group DEFINITIONS (`$RGP` blocks;
 * the legend is a later item), bond topology, Sgroups and templates.
 */

import type { StatedAtomParity } from "./atom-parity.js";
import {
  elementBySymbol,
  normalizeElementInput,
  QUERY_ELEMENT,
  requireElement,
} from "./elements.js";
import { BOND_QUERY_ORDER, normalizeAtomQuery } from "./query.js";
import { kekulizeWithReport, type KekulizeResult } from "./aromatic.js";
import { MoleculeBuilder } from "./builders.js";
import { bondsAt, cloneAtomWith, degree, requireAtom, requireBond } from "./molecule.js";
import { ringSize, ringsAtAtom } from "./rings.js";
import { MOLFILE_BOND_LENGTH } from "./molblock-write.js";
import { withStereoGroups } from "./stereo-groups.js";
import type {
  Atom,
  AtomId,
  AtomQuery,
  Bond,
  BondId,
  BondOrder,
  BondQuery,
  BondStereo,
  Molecule,
  StereoGroup,
  StereoGroupKind,
} from "./types.js";
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
      /**
       * A symbol that is neither an element nor an MDL query symbol — "Pol",
       * "D", a vendor's placeholder — read as a generic atom bearing it as
       * its label (decision 238). Nothing was dropped; the note says the atom
       * is a placeholder and not an element the reader failed to recognise.
       */
      readonly kind: "pseudo-atom";
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
    }
  | {
      /**
       * A V3000 `M  V30 BEGIN <key>` block this reader does not model — an
       * Sgroup, a template, a 3D-constraint block, an Rgroup. Skipped WHOLE, up
       * to its matching `END`, so its rows cannot be mistaken for atoms or
       * bonds. (These are variants on the existing union rather than a second
       * error channel: a caller already has one place to look.)
       */
      readonly kind: "unsupported-v3000-block";
      readonly message: string;
      readonly line: number;
      readonly block: string;
    }
  | {
      /**
       * A collection entry that is not one of the three stereo ones. `HILITE` is
       * a rendering hint and a user collection carries no chemistry, so both are
       * dropped — which is what the spec says a registration does by default.
       */
      readonly kind: "unsupported-collection";
      readonly message: string;
      readonly line: number;
      readonly name: string;
    }
  | {
      /** A V3000 row inside a block that could not be read at all. The V2000
       *  equivalent is `bad-numeric-field` per column; a V3000 row is
       *  keyword-based, so there is no column to name.
       *
       *  KEPT FOR THE ROWS THAT STILL LAND SOMETHING: a stray CTAB line, an
       *  atom row read generously with a missing coordinate defaulted to 0, a
       *  collection dropped whole. The molecule is still the file's graph. The
       *  rows where an ATOM or a BOND actually disappears are
       *  `dropped-v3000-row` instead — see there for why the split exists. */
      readonly kind: "bad-v3000-row";
      readonly message: string;
      readonly line: number;
      readonly block: string;
      readonly text: string;
    }
  | {
      /**
       * A V3000 ATOM or BOND row unreadable enough to be skipped, so the atom
       * or bond it declared is NOT in the molecule that comes back.
       *
       * SPLIT OUT OF `bad-v3000-row` because that kind is too coarse to act
       * on. Its other arms keep the graph the file describes — a missing
       * coordinate is read as 0 and the atom survives — while these two lose a
       * node or an edge, which is the same failure V2000 reports as
       * `unknown-element` or `bad-bond-endpoint`. An importer classifying by
       * kind has to be able to tell "the molecule is not the file" from "the
       * molecule is the file, read generously", and it was classifying the
       * V3000 loss two tiers below its V2000 twin.
       *
       * Decision 90's tolerance rule is unchanged: still a warning, still
       * skipped, never a thrown file. What it costs the caller is the caller's
       * to decide.
       */
      readonly kind: "dropped-v3000-row";
      readonly message: string;
      readonly line: number;
      readonly block: "ATOM" | "BOND";
      readonly text: string;
    }
  | {
      /**
       * A collection entry whose `ATOMS=(n ...)` list declares `n` members and
       * carries fewer. The values present are KEPT (decision 90's tolerance
       * rule: dropping them would lose the group rather than repair it), so
       * this warning is the whole of the report — and it has to exist, because
       * the declared count is the one cross-check the format offers and a
       * collection that comes back smaller leaves a molecule that still looks
       * fine. Measured: an 18-centre racemate whose continuation dash was
       * trimmed away — what any re-wrap, whitespace trim or paste through a
       * text field does — came back as a 17-atom partial group and its coverage
       * fell from `rac-` to per-centre tags, silently. RDKit refuses the same
       * bytes outright; this reader keeps them and says so.
       */
      readonly kind: "collection-count-mismatch";
      readonly message: string;
      readonly line: number;
      /** The collection name as the file spells it, e.g. `MDLV30/STERAC1`. */
      readonly name: string;
      readonly declared: number;
      readonly found: number;
    }
  | {
      /**
       * The file put one atom in two stereo collections. An atom belongs to at
       * most one — that is MDL semantics, and it is what makes a figure's
       * per-centre tag single-valued — so the LATER mention is dropped, the way
       * a repeated bond row is.
       */
      readonly kind: "stereo-group-conflict";
      readonly message: string;
      readonly line: number;
      readonly atomIds: readonly AtomId[];
    };

export interface MolblockReadResult {
  readonly molecule: Molecule;
  /** Header line 1, trailing whitespace removed. */
  readonly title: string;
  /** Header line 3, trailing whitespace removed. */
  readonly comment: string;
  readonly warnings: readonly MolblockWarning[];
  /**
   * The V2000 atom parity column (`sss`), by atom id, for every atom whose
   * value is 1 (odd), 2 (even) or 3 (either); empty when the file states
   * none, and for V3000, whose `CFG=` keyword is not read yet. Returned
   * BESIDE the molecule and never applied to it: the wedges stay the model's
   * statement of configuration (decision 24), and
   * `stereoConfigFromAtomParities` reads this for a caller that wants the
   * file's other one (decision 207). Read with `Object.hasOwn`.
   */
  readonly atomParities: Readonly<Record<AtomId, StatedAtomParity>>;
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

/**
 * The molfile "coordination" bond type, read as a dative bond with the row's
 * first atom the donor (decision 226). V3000 is where it is specified and
 * where RDKit writes it; a V2000 row carrying it is read the same way rather
 * than demoted to a single bond, which would move the donor's hydrogens.
 */
const DATIVE_BOND_TYPE = 9;

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
  /** `sss`, the atom stereo parity: 0 none, 1 odd, 2 even, 3 either. */
  readonly parity: number;
  readonly hydrogenField: number;
  readonly valenceField: number;
}

/**
 * An atom after each generation's own columns and keywords have been RESOLVED —
 * legacy charge codes applied or superseded, a mass difference turned into a mass
 * number, a spin multiplicity turned into an electron count.
 *
 * The two generations disagree about almost every encoding and agree about every
 * meaning: V2000 charge is a legacy code plus an `M  CHG` override, V3000 charge
 * is `CHG=` and absolute; V2000 isotope is a difference from the most abundant
 * nuclide, V3000's `MASS=` is the mass number itself. So the resolution is
 * per-generation and everything AFTER it — element lookup, the builder, aromatic
 * flags, the kekulise-and-pin dance — is shared. That dance is the subtle part of
 * this file, and two copies of it would drift.
 */
interface ParsedAtom {
  readonly row: number;
  readonly line: number;
  readonly symbol: string;
  readonly x: number;
  readonly y: number;
  readonly charge: number;
  readonly radicalElectrons: number;
  readonly isotope: number | undefined;
  /**
   * The file's hydrogen assertion, in V2000's OWN two fields, because that is
   * what `assertedHydrogenCount` speaks and there is no reason for a second
   * dialect. `hydrogenField` is a count plus one (0 = unspecified);
   * `valenceField` is a total valence with `VALENCE_ZERO_CODE` meaning zero. The
   * V3000 reader TRANSLATES into these — its own zero sentinel is `VAL=-1` — and
   * the translation happens once, at the edge, rather than by sharing a constant
   * that means different things in the two formats.
   */
  readonly hydrogenField: number;
  readonly valenceField: number;
  /** The stated atom parity (decision 207), or 0; never applied to the atom. */
  readonly parity: number;
  /**
   * What a query or generic atom stands for, resolved per generation from
   * the symbol and the generation's own query fields (decision 238), or
   * undefined for an element.
   */
  readonly query: AtomQuery | undefined;
  /** True when the symbol was neither an element nor a query spelling, so
   *  the generic atom deserves a `pseudo-atom` note. */
  readonly pseudo: boolean;
}

/**
 * A bond after its stereo has been resolved to the MODEL's value.
 *
 * Resolved per generation, because the two numberings agree on nothing but `1`:
 * V2000 spends 1/3/4/6 on wedge, either-on-a-double, wavy and hash; V3000 spends
 * `CFG=` 1/2/3 on up, either and down, and leans on the bond ORDER to say which
 * kind of "either" it means. A field holding a raw code would be a number whose
 * meaning depended on where it came from, which is how a V3000 wedge gets read as
 * a V2000 crossed double bond.
 */
interface ParsedBond {
  readonly row: number;
  readonly line: number;
  readonly from: number;
  readonly to: number;
  readonly type: number;
  readonly stereo: BondStereo;
}

/** A stereo collection as the file stated it: rows, not ids, because the ids do
 *  not exist until the atoms are built. */
interface StereoCollectionRow {
  readonly kind: StereoGroupKind;
  readonly index: number;
  readonly rows: readonly number[];
  readonly line: number;
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
 * resolves to an element or an MDL query symbol — which is also what keeps a
 * query atom (`A`, `R#`, `*`) from ending the block (decision 238).
 */
function looksLikeAtomRow(line: string): boolean {
  if (line.trim() === "") return false;
  if (/\d\.\d/.test(line.slice(0, 31))) return true;
  const symbol = readSymbol(line);
  return resolveElement(symbol) !== undefined || MDL_QUERY_SYMBOLS.has(symbol);
}

/**
 * The MDL symbols that name a query rather than an element, and what each one
 * becomes (decision 238). `R#` is an R-group whose number comes from
 * `M  RGP` / `RGROUPS=`; `L` is an atom list whose members come from
 * `M  ALS`. The generic letters stay labels: X is "a halogen" to MDL and
 * whatever the figure's legend says to the author, and the label carries
 * both readings without this reader choosing one.
 */
const MDL_GENERIC_SYMBOLS: ReadonlySet<string> = new Set([
  "Q", "QH", "X", "XH", "M", "MH", "AH",
]);
const MDL_QUERY_SYMBOLS: ReadonlySet<string> = new Set([
  "R#", "R", "A", "*", "L", ...MDL_GENERIC_SYMBOLS,
]);

/**
 * The query a symbol states on its own, before any `M  RGP`, `M  ALS` or alias
 * refines it, or undefined for an element. A non-empty symbol that is neither
 * comes back as a generic atom labelled with it, flagged `pseudo`.
 */
function symbolQuery(symbol: string): { readonly query: AtomQuery; readonly pseudo: boolean } | undefined {
  if (symbol === "R#" || symbol === "R") return { query: { kind: "rgroup" }, pseudo: false };
  if (symbol === "A" || symbol === "*") return { query: { kind: "any", symbol }, pseudo: false };
  // `L` with no `M  ALS` behind it is a list nobody filled in. A generic "L"
  // keeps the atom and draws what the file wrote.
  if (symbol === "L" || MDL_GENERIC_SYMBOLS.has(symbol)) {
    return { query: { kind: "generic", label: symbol }, pseudo: false };
  }
  if (symbol === "" || resolveElement(symbol) !== undefined) return undefined;
  return { query: { kind: "generic", label: symbol }, pseudo: true };
}

/** The element list behind an `M  ALS` line or a V3000 bracket, normalised;
 *  undefined when no member is an element. */
function listQuery(symbols: readonly string[], negated: boolean): AtomQuery | undefined {
  const elements = symbols
    .map((symbol) => resolveElement(symbol))
    .filter((symbol): symbol is string => symbol !== undefined);
  const query = normalizeAtomQuery({ kind: "list", elements, negated });
  return query instanceof Error ? undefined : query;
}

/**
 * The query a V2000 atom row states once its property lines are in: the
 * symbol's own reading, then the R-group number, the element list or the
 * alias the properties block attached to that row.
 *
 * An ALIAS only relabels a pseudo or generic atom. On a real element it is
 * ChemDraw's abbreviation ("Ph" on a carbon) and the reader has always kept
 * the element, so it still does; on an R-group the number is the statement.
 */
function v2000Query(
  symbol: string,
  rgroup: number | undefined,
  list: AtomQuery | undefined,
  alias: string | undefined,
): AtomQuery | undefined {
  const own = symbolQuery(symbol);
  if (own === undefined) return undefined;
  if (own.query.kind === "rgroup") {
    return symbol === "R#" && rgroup !== undefined && rgroup >= 1
      ? { kind: "rgroup", index: rgroup }
      : own.query;
  }
  if (symbol === "L" && list !== undefined) return list;
  if (alias !== undefined && alias.trim() !== "") return { kind: "generic", label: alias.trim() };
  return own.query;
}

/** V2000 bond types 5-8, the query bonds (decision 238). */
const BOND_QUERY_BY_TYPE: ReadonlyMap<number, BondQuery> = new Map([
  [5, "single-or-double"],
  [6, "single-or-aromatic"],
  [7, "double-or-aromatic"],
  [8, "any"],
]);


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
      "No readable counts line found on the fourth line of the record. " +
        "This does not look like a molblock.",
    );
  }

  const countsLine = lines[start + 3] ?? "";
  const counts = parseCounts(countsLine);
  if (!counts) {
    throw new MolblockParseError(`Unreadable counts line: "${countsLine}"`);
  }
  const title = lines[start] ?? "";
  const comment = lines[start + 2] ?? "";

  // AUTO-DISPATCH (decision 90). The version stamp on the counts line is the
  // only thing that distinguishes the two bodies, and a V3000 file's leading
  // counts fields are all zeros by convention — so reading on regardless would
  // produce an empty molecule with an empty warnings array, which is the worst
  // of the available failures.
  if (counts.isV3000) {
    const body = readV3000Body(v30Entries(lines, start + 4), warnings);
    const { molecule, atomParities } = assembleMolecule(
      body.atoms,
      body.bonds,
      body.collections,
      scale,
      warnings,
    );
    return { molecule, title, comment, warnings, atomParities };
  }

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
    const parity = readInt(line, 39, 42);
    const hydrogenField = readInt(line, 42, 45);
    const valenceField = readInt(line, 48, 51);
    // Anything but 0-3 is not a parity; read as "none" and said so, reusing
    // the unreadable-field warning rather than adding a kind the client's
    // warning table would have to grow.
    const parityOutOfRange = !parity.bad && (parity.value < 0 || parity.value > 3);

    for (const [field, parsed] of [
      ["x", x],
      ["y", y],
      ["z", z],
      ["mass difference", massDiff],
      ["charge", legacyCharge],
      ["stereo parity", parityOutOfRange ? { ...parity, bad: true } : parity],
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
      parity: parity.bad || parityOutOfRange ? 0 : parity.value,
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
  const bondRows: ParsedBond[] = [];
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

    let resolved = bondStereoFromCode(stereo.value);
    if (resolved === undefined) {
      warnings.push({
        kind: "unsupported-bond-stereo",
        message: `Bond ${row} has stereo code ${stereo.value}; read as plain.`,
        line: lineNumber,
        row,
        stereo: stereo.value,
      });
      resolved = "none";
    }

    bondRows.push({
      row,
      line: lineNumber,
      from: from.value,
      to: to.value,
      type: type.value,
      stereo: resolved,
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
  // Decision 238's query properties: an R-group number per `R#` row, an
  // element list per `L` row, an alias label per pseudo-atom row.
  const rgroupByRow = new Map<number, number>();
  const listByRow = new Map<number, AtomQuery>();
  const aliasByRow = new Map<number, string>();

  for (let i = bondBlockStart + readBondLines; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed === "M  END" || trimmed === "M END") break;
    // A `$$$$` separator means an SDF; stop before the next record's data
    // leaks into this one. Multi-record iteration is a separate job.
    if (trimmed === "$$$$") break;

    // `A  aaa` then the alias text on the NEXT line: the one V2000 property
    // that is not an `M  ` line and spans two.
    if (line.startsWith("A  ")) {
      const index = Number.parseInt(line.slice(3).trim(), 10);
      const text = lines[i + 1];
      if (Number.isFinite(index) && index >= 1 && index <= atomRows.length && text !== undefined) {
        aliasByRow.set(index, text);
      }
      i++;
      continue;
    }
    if (!line.startsWith("M  ")) continue;

    const tag = line.slice(3, 6);
    if (tag === "ALS") {
      // `M  ALS aaannn e 11112222…`: the atom, the member count, T for a
      // NOT-list, then four-column element symbols. Read by whitespace like
      // the pair properties, with the count bounding the members.
      const tokens = line.slice(6).trim().split(/\s+/);
      const index = Number.parseInt(tokens[0] ?? "", 10);
      const declared = Number.parseInt(tokens[1] ?? "", 10);
      const exclusion = tokens[2];
      const list =
        Number.isFinite(declared) && (exclusion === "T" || exclusion === "F")
          ? listQuery(tokens.slice(3, 3 + Math.max(0, declared)), exclusion === "T")
          : undefined;
      if (!Number.isFinite(index) || list === undefined) {
        warnings.push({
          kind: "bad-property-line",
          message: `Unreadable "M  ALS" atom list; the atom keeps its own symbol.`,
          line: i + 1,
        });
      } else if (index < 1 || index > atomRows.length) {
        warnings.push({
          kind: "property-index-out-of-range",
          message: `"M  ALS" names atom ${index}, which does not exist; ignored.`,
          line: i + 1,
          index,
        });
      } else {
        listByRow.set(index, list);
      }
      continue;
    }
    if (tag !== "CHG" && tag !== "ISO" && tag !== "RAD" && tag !== "RGP") continue;

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
      else if (tag === "RGP") rgroupByRow.set(index, value);
      else radicalByRow.set(index, value);
    }
  }

  // -------------------------------------------------------------------------
  // Resolve V2000's own encodings into the shared `ParsedAtom` form.
  //
  // Everything from here on is generation-independent, which is why it lives in
  // `assembleMolecule` below rather than inline: the kekulise-then-repin dance at
  // the end of it is the subtle part of this file and must not exist twice.
  // -------------------------------------------------------------------------
  const parsed: ParsedAtom[] = atomRows.map((atom) => {
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
      const element = resolveElement(atom.symbol);
      const info = element === undefined ? undefined : requireElement(element);
      const reference = info === undefined ? 0 : Math.round(info.monoisotopic ?? info.weight);
      isotope = reference + atom.massDiff;
    }

    return {
      row: atom.row,
      line: atom.line,
      symbol: atom.symbol,
      x: atom.x,
      y: atom.y,
      charge,
      radicalElectrons,
      isotope,
      hydrogenField: atom.hydrogenField,
      valenceField: atom.valenceField,
      parity: atom.parity,
      query: v2000Query(
        atom.symbol,
        rgroupByRow.get(atom.row),
        listByRow.get(atom.row),
        aliasByRow.get(atom.row),
      ),
      pseudo: symbolQuery(atom.symbol)?.pseudo === true,
    };
  });

  const { molecule, atomParities } = assembleMolecule(parsed, bondRows, [], scale, warnings);
  return { molecule, title, comment, warnings, atomParities };
}

/**
 * Build the molecule from resolved rows, and settle its hydrogens.
 *
 * Shared by both generations. `collections` is empty for V2000, which has no way
 * to express one.
 */
function assembleMolecule(
  atomRows: readonly ParsedAtom[],
  bondRows: readonly ParsedBond[],
  collections: readonly StereoCollectionRow[],
  scale: number,
  warnings: MolblockWarning[],
): { readonly molecule: Molecule; readonly atomParities: Readonly<Record<AtomId, StatedAtomParity>> } {

  // Through MoleculeBuilder: `addAtom`/`addBond` copy the whole record on every
  // call, so a loop over them is quadratic.
  const builder = new MoleculeBuilder();
  // Row index -> atom id, in an ARRAY on purpose. An object keyed by a number
  // parsed out of the file would resolve "constructor" and "__proto__" to
  // inherited members; an array index cannot.
  const rowToAtomId: (AtomId | undefined)[] = [];
  // Parallel to the atom ids: what the file asserted about each atom's
  // hydrogens, resolved once the molecule exists.
  const assertionByAtomId = new Map<AtomId, { hydrogenField: number; valenceField: number }>();

  for (const atom of atomRows) {
    if (atom.query !== undefined) {
      // A query or generic atom (decision 238). No hydrogen assertion is
      // recorded: a placeholder carries no hydrogens to pin, and the file's
      // valence field on one says nothing about the atoms around it.
      const query = normalizeAtomQuery(atom.query);
      const id = builder.atom(QUERY_ELEMENT, vec(atom.x / scale, atom.y / scale), {
        charge: atom.charge,
        radicalElectrons: atom.radicalElectrons,
        query: query instanceof Error ? { kind: "generic", label: "*" } : query,
      });
      rowToAtomId[atom.row] = id;
      if (atom.pseudo) {
        warnings.push({
          kind: "pseudo-atom",
          message:
            `Atom ${atom.row} has symbol "${atom.symbol}", which is not an element; ` +
            `it was read as a generic atom labelled "${atom.symbol}".`,
          line: atom.line,
          row: atom.row,
          symbol: atom.symbol,
        });
      }
      continue;
    }
    const element = resolveElement(atom.symbol);
    if (element === undefined) {
      warnings.push({
        kind: "unknown-element",
        message: `Atom ${atom.row} has no element symbol; the atom was skipped.`,
        line: atom.line,
        row: atom.row,
        symbol: atom.symbol,
      });
      rowToAtomId[atom.row] = undefined;
      continue;
    }

    const id = builder.atom(element, vec(atom.x / scale, atom.y / scale), {
      charge: atom.charge,
      radicalElectrons: atom.radicalElectrons,
      isotope: atom.isotope,
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
  const dativeBondIds: BondId[] = [];

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
    let dative = false;
    const query = BOND_QUERY_BY_TYPE.get(bond.type);
    if (bond.type === 1 || bond.type === 2 || bond.type === 3) {
      order = bond.type;
    } else if (bond.type === 4) {
      aromatic = true;
    } else if (bond.type === DATIVE_BOND_TYPE) {
      dative = true;
    } else if (query !== undefined) {
      // Types 5-8 are query bonds (decision 238), stored at the lowest order
      // the query admits.
      order = BOND_QUERY_ORDER[query];
    } else {
      warnings.push({
        kind: "unsupported-bond-type",
        message:
          `Bond ${bond.row} has type ${bond.type}, which this reader does not ` +
          `model; read as a single bond.`,
        line: bond.line,
        row: bond.row,
        type: bond.type,
      });
    }

    seenPairs.add(key);
    // `from` first, matching the row order: the narrow end of a wedge is at
    // the file's first atom, and swapping the endpoints here would invert
    // every stereocentre in the structure.
    const bondId = builder.bond(from, to, order, bond.stereo, query);
    if (aromatic) aromaticBondIds.push(bondId);
    if (dative) dativeBondIds.push(bondId);
  }

  let molecule = builder.build();

  // Dative flags the same way, one post-pass (decision 226). Before the
  // hydrogen pass below, because a dative bond gives its donor no valence.
  if (dativeBondIds.length > 0) {
    const bonds: Record<BondId, Bond> = { ...molecule.bonds };
    for (const bondId of dativeBondIds) {
      bonds[bondId] = { ...requireBond(molecule, bondId), dative: true };
    }
    molecule = { ...molecule, bonds };
  }

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

  // -------------------------------------------------------------------------
  // Stereo collections, LAST: they name atom rows, and the rows only became ids
  // just now. A collection whose atoms were all skipped disappears rather than
  // becoming an empty group, because an empty group is a second spelling of
  // "nothing was said about configuration" (decision 91).
  // -------------------------------------------------------------------------
  if (collections.length > 0) {
    const groups: StereoGroup[] = [];
    const owner = new Map<AtomId, string>();
    for (const collection of collections) {
      const key = `${collection.kind}\u0000${collection.index}`;
      const atomIds: AtomId[] = [];
      const conflicting: AtomId[] = [];
      for (const row of collection.rows) {
        const id = row >= 1 && row <= atomRows.length ? rowToAtomId[row] : undefined;
        if (id === undefined) {
          warnings.push({
            kind: "property-index-out-of-range",
            message:
              `A stereo collection names atom ${row}, which is not in the file ` +
              `(or was itself skipped); it was left out of the group.`,
            line: collection.line,
            index: row,
          });
          continue;
        }
        const held = owner.get(id);
        if (held !== undefined && held !== key) {
          conflicting.push(id);
          continue;
        }
        owner.set(id, key);
        atomIds.push(id);
      }
      if (conflicting.length > 0) {
        warnings.push({
          kind: "stereo-group-conflict",
          message:
            `${conflicting.length} atom(s) named by this stereo collection are ` +
            `already in another one; an atom belongs to at most one, so the ` +
            `later mention was dropped.`,
          line: collection.line,
          atomIds: conflicting,
        });
      }
      if (atomIds.length === 0) continue;
      groups.push({ kind: collection.kind, index: collection.index, atomIds });
    }
    // `withStereoGroups` is the one place a group list is validated and put in
    // canonical order, and it UNIONS entries sharing a kind and an index — which
    // is what lets the loop above hand over one entry per file line without
    // coalescing several `STEABS` lines first. Every conflict it would throw on
    // has already been turned into a warning above, so it cannot throw here.
    molecule = withStereoGroups(molecule, groups);
  }

  // The parity column, by the id each row became (decision 207). Keyed on
  // ids the builder minted, so no row number from the file is ever a key.
  const atomParities: Record<AtomId, StatedAtomParity> = {};
  for (const atom of atomRows) {
    const id = rowToAtomId[atom.row];
    if (id !== undefined && (atom.parity === 1 || atom.parity === 2 || atom.parity === 3)) {
      atomParities[id] = atom.parity;
    }
  }

  return { molecule, atomParities: Object.freeze(atomParities) };
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

// ---------------------------------------------------------------------------
// V3000
//
// A different body entirely: no fixed columns, `M  V30 ` on every line, and
// tag-based blocks. The tolerance rule is the same one the top of this file
// states — a malformed row is a warning and is skipped — so nothing below
// throws.
// ---------------------------------------------------------------------------

/** `M  V30 ` — seven characters, on every body line including a continuation. */
const V30_PREFIX = "M  V30 ";

/**
 * `M  V30` with no trailing space, which is what the spec says a reader strips
 * from a continuation line. A file whose continuation carries no space after the
 * tag is within its rights, and one that carries two (RDKit reads both) must not
 * lose a digit to an over-eager slice.
 */
const V30_TAG = "M  V30";

/** A V3000 stereo collection name to the kind it means, per the spec's
 *  internal-collection table. Matched case-INSENSITIVELY, because the spec says
 *  collection names are not case sensitive. */
const STEREO_COLLECTION_KINDS: ReadonlyArray<readonly [string, StereoGroupKind]> = [
  ["MDLV30/STEABS", "abs"],
  ["MDLV30/STERAC", "and"],
  ["MDLV30/STEREL", "or"],
];

/**
 * V3000's `VAL=` sentinel for zero valence.
 *
 * NOT 15, which is V2000's. The spec's atom table reads "Integer > 0 or 0 = none
 * (default), -1 = zero", and RDKit turns a V3000 `VAL=-1` into a V2000 `vvv` of
 * 15 — measured. Translated into `VALENCE_ZERO_CODE` at the point of reading, so
 * `assertedHydrogenCount` keeps speaking one dialect and the two constants never
 * get shared.
 */
const V3000_VALENCE_ZERO = -1;

/**
 * Bond `CFG=` to the model's `BondStereo`.
 *
 * The V3000 numbering is 0 none, 1 up, 2 either, 3 down — three values where
 * V2000 spends four, and only `1` agrees between them. Verified against the
 * CTfile spec's bond-block table and against RDKit, which turns `CFG=1` into
 * CXSMILES `wU`, `CFG=3` into `wD`, and `CFG=2` into `w`.
 *
 * `CFG=2` IS AMBIGUOUS BY DESIGN and the bond ORDER resolves it: on a single
 * bond it is the squiggly "configuration unknown at this centre" (`wavy`), on a
 * double bond the crossed "cis or trans unknown" (`either`). Measured: RDKit
 * writes V2000 stereo 3 for a `CFG=2` double bond and reads a `CFG=2` single
 * bond as an unknown wedge. So this table cannot be a plain `Record<number,
 * BondStereo>`; see `bondStereoFromCfg`.
 */
function bondStereoFromCfg(cfg: number, order: number): BondStereo | undefined {
  switch (cfg) {
    case 0:
      return "none";
    case 1:
      return "wedge";
    case 2:
      return order === 2 ? "either" : "wavy";
    case 3:
      return "hash";
    default:
      return undefined;
  }
}

/** One logical V3000 entry: its content with the prefix and every continuation
 *  joined, and the 1-based number of the physical line it started on. */
interface V30Entry {
  readonly content: string;
  readonly line: number;
}

/**
 * Split the body into logical entries, joining continuations.
 *
 * THE MOST LIKELY DEFECT IN THIS WHOLE CODEC is getting this wrong, because
 * failing to join is SILENT: a COLLECTION entry listing a dozen atoms exceeds 80
 * characters, so the tail lands on its own line, and a reader that skipped it
 * would hand back a group that is merely SMALLER. The molecule still looks fine
 * and the racemate has quietly become a partial one.
 *
 * The rule, quoted from the spec: "use a dash (-) as the last character. When
 * read, the line is concatenated with the next line by removing the dash and
 * stripping the initial 'M  V30' from the following line."
 *
 * THE SINGLE SPACE AFTER THE TAG GOES TOO. The spec's own worked example makes
 * that explicit: `M  V30 10 20 30 "abc-` followed by `M  V30 def"` reads as
 * `"abcdef"`, not `"abc def"` — so a break inside a token has to rejoin the token.
 * Keeping the space instead turned `MDLV30/STERA-` plus `M  V30 C1` into
 * `MDLV30/STERA C1`, a collection name this reader does not recognise, and the
 * group vanished with a warning about an unsupported collection. Any FURTHER
 * spaces are left alone: RDKit's writer breaks between fields, so its
 * continuation legitimately starts with the next field.
 *
 * A line that is not a `M  V30` line at all ends the body: that is `M  END`, a
 * `$$$$` separator, or a V2000-style property line in a mixed-up file.
 */
/** A body line's content: the tag, and the ONE space the spec's example shows is
 *  part of it, removed. */
function v30Content(raw: string): string {
  return raw.startsWith(V30_PREFIX) ? raw.slice(V30_PREFIX.length) : raw.slice(V30_TAG.length);
}

function v30Entries(lines: readonly string[], from: number): V30Entry[] {
  const entries: V30Entry[] = [];
  let i = from;
  while (i < lines.length) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (trimmed === "M  END" || trimmed === "M END" || trimmed === "$$$$") break;
    if (!raw.startsWith(V30_TAG)) {
      // Not ours. A blank line inside the body is noise from a text box; a
      // property line means the file mixes generations. Either way, skip it
      // rather than ending the CTAB, so a stray line cannot hide the collection
      // block that follows.
      i++;
      continue;
    }
    const line = i + 1;
    let content = v30Content(raw);
    while (content.endsWith("-")) {
      const next = lines[i + 1];
      if (next === undefined || !next.startsWith(V30_TAG)) break;
      i++;
      content = content.slice(0, -1) + v30Content(next);
    }
    entries.push({ content, line });
    i++;
  }
  return entries;
}

/**
 * Split an entry into fields, keeping `(...)` lists and `"..."` strings whole.
 *
 * A naive whitespace split would turn `ATOMS=(2 2 4)` into three fields and lose
 * the association between the keyword and its values — and then a keyword scan
 * would find `4)` and read it as a nameless field. The spec's own grammar is
 * `KEYWORD=(N val1 ... valN)` with quoted strings allowed inside, so both have
 * to be respected here rather than patched up downstream.
 */
function v30Fields(content: string): string[] {
  const fields: string[] = [];
  let current = "";
  let depth = 0;
  let quoted = false;
  for (const ch of content) {
    if (quoted) {
      current += ch;
      if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      current += ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && /\s/.test(ch)) {
      if (current !== "") fields.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current !== "") fields.push(current);
  return fields;
}

/** The `KEY=value` fields of an entry, upper-cased keys. A repeated key keeps
 *  the LAST occurrence, which is the only reading that lets a later block
 *  override an earlier one. */
function v30Keywords(fields: readonly string[]): Map<string, string> {
  const keywords = new Map<string, string>();
  for (const field of fields) {
    const eq = field.indexOf("=");
    if (eq <= 0) continue;
    keywords.set(field.slice(0, eq).toUpperCase(), field.slice(eq + 1));
  }
  return keywords;
}

/** A keyword's value as an integer, or `undefined` when it is absent or not a
 *  number. Absent and unreadable are deliberately the same answer: the spec's
 *  default for every one of these keywords is "not specified". */
function keywordInt(keywords: ReadonlyMap<string, string>, key: string): number | undefined {
  const text = keywords.get(key);
  if (text === undefined) return undefined;
  if (!/^[+-]?\d+$/.test(text.trim())) return undefined;
  return Number.parseInt(text.trim(), 10);
}

/**
 * The values inside a `KEYWORD=(N v1 v2 ... vN)` list, WITH the count the list
 * declared.
 *
 * `N` BOUNDS the result, exactly as it does for a V2000 `M  CHG` payload, so
 * trailing junk inside the parentheses cannot inject members. A list with fewer
 * values than it declares yields what is there — the surplus declaration is the
 * file's error, and dropping the values present would lose the group rather than
 * repair it.
 *
 * `declared` COMES BACK with the values rather than being checked here: this
 * function knows nothing about what the list is for, and the caller is the one
 * that can name the collection in a warning. Discarding it was the defect — a
 * short list then read as a smaller group with nothing said about it.
 */
function keywordList(
  keywords: ReadonlyMap<string, string>,
  key: string,
): { readonly declared: number; readonly values: number[] } | undefined {
  const text = keywords.get(key);
  if (text === undefined) return undefined;
  const numbers = text.match(/-?\d+/g);
  if (!numbers || numbers.length === 0) return undefined;
  const declared = Number.parseInt(numbers[0] ?? "", 10);
  if (!Number.isFinite(declared) || declared < 0) return undefined;
  const values: number[] = [];
  for (const raw of numbers.slice(1, 1 + declared)) {
    const value = Number.parseInt(raw, 10);
    if (Number.isFinite(value)) values.push(value);
  }
  return { declared, values };
}

/** `BEGIN <KEY>` / `END <KEY>`, or undefined. */
function blockBoundary(content: string): { readonly open: boolean; readonly key: string } | undefined {
  const match = /^(BEGIN|END)\s+(\S+)/i.exec(content.trim());
  if (!match) return undefined;
  return { open: match[1]!.toUpperCase() === "BEGIN", key: match[2]!.toUpperCase() };
}

interface V3000Body {
  readonly atoms: ParsedAtom[];
  readonly bonds: ParsedBond[];
  readonly collections: StereoCollectionRow[];
}

/**
 * Parse the V3000 body.
 *
 * ONE PASS OVER THE ENTRIES, driven by the block keys rather than by the counts
 * line. The counts line is read for the 3D flag and is otherwise ignored: a
 * V3000 file's leading V2000-shaped counts are all zeros by convention, and
 * `M  V30 COUNTS` can disagree with the body just as a V2000 counts line can. The
 * blocks say where they end, so there is no cascade to protect against here and
 * no reason to trust a number over the structure.
 *
 * An unmodelled block — Sgroup, template, 3D constraints, Rgroup — is skipped
 * WHOLE, to its matching `END`. Skipping it row by row would let its rows be read
 * as atoms.
 */
function readV3000Body(entries: readonly V30Entry[], warnings: MolblockWarning[]): V3000Body {
  const atoms: ParsedAtom[] = [];
  const bonds: ParsedBond[] = [];
  const collections: StereoCollectionRow[] = [];
  /** Nonzero z coordinates, by atom row — a 3D conformer, reported once. */
  const spatialRows: number[] = [];

  /** The block keys we are currently inside, innermost last. `CTAB` is the outer
   *  one; the rest are its children. */
  const open: string[] = [];
  /** When set, everything up to the matching `END` is being discarded. */
  let skipping: string | undefined;

  for (const entry of entries) {
    const boundary = blockBoundary(entry.content);
    if (boundary) {
      if (skipping !== undefined) {
        if (!boundary.open && boundary.key === skipping) skipping = undefined;
        else if (boundary.open) open.push(boundary.key);
        continue;
      }
      if (boundary.open) {
        if (boundary.key === "CTAB" || boundary.key === "ATOM" || boundary.key === "BOND" || boundary.key === "COLLECTION") {
          open.push(boundary.key);
        } else {
          warnings.push({
            kind: "unsupported-v3000-block",
            message:
              `The "${boundary.key}" block is not supported and was skipped ` +
              `whole; the structure itself was read.`,
            line: entry.line,
            block: boundary.key,
          });
          skipping = boundary.key;
        }
        continue;
      }
      // An `END` for a block we never opened is a file error, not a reason to
      // stop: the following blocks may still be readable.
      const last = open[open.length - 1];
      if (last === boundary.key) open.pop();
      continue;
    }
    if (skipping !== undefined) continue;

    const block = open[open.length - 1];
    const fields = v30Fields(entry.content);
    const keyword = fields[0]?.toUpperCase() ?? "";

    if (keyword === "COUNTS") {
      // na nb nsg n3d chiral. Read only to notice the dimensional claim; the
      // blocks themselves say how many rows there are.
      continue;
    }

    if (block === "ATOM") {
      const atom = readV3000Atom(entry, fields, atoms.length + 1, warnings);
      if (atom) {
        if (Math.abs(atom.z) > Z_EPSILON) spatialRows.push(atom.parsed.row);
        atoms.push(atom.parsed);
      }
      continue;
    }

    if (block === "BOND") {
      const bond = readV3000Bond(entry, fields, bonds.length + 1, warnings);
      if (bond) bonds.push(bond);
      continue;
    }

    if (block === "COLLECTION") {
      const collection = readV3000Collection(entry, fields, warnings);
      if (collection) collections.push(collection);
      continue;
    }

    // A row directly inside the CTAB that is not a counts line and not a block
    // boundary: a link line, or something this reader has never seen.
    if (block === "CTAB") {
      warnings.push({
        kind: "bad-v3000-row",
        message: `Unrecognised V3000 line in the CTAB; ignored.`,
        line: entry.line,
        block: "CTAB",
        text: entry.content,
      });
    }
  }

  if (spatialRows.length > 0) {
    warnings.push({
      kind: "three-dimensional",
      message:
        `This is a 3D record (${spatialRows.length} atom(s) off the z=0 plane); ` +
        `the z coordinate was dropped and the atoms kept their flat projection, ` +
        `which may overlap. A 2D layout pass is likely wanted.`,
      rows: spatialRows,
    });
  }

  return { atoms, bonds, collections };
}

/**
 * One `index type x y z aamap [KEY=val ...]` row.
 *
 * THE ROW NUMBER IS THE POSITION IN THE BLOCK, not the index the file wrote. The
 * spec says only that indices are unique, not that they are 1..n in order, and
 * the bond block references them — so the file's own index is kept for the
 * lookup and the position is what the shared builder counts by. Handling those as
 * one number is how a file with a gap in its numbering loses its bonds.
 */
function readV3000Atom(
  entry: V30Entry,
  fields: readonly string[],
  position: number,
  warnings: MolblockWarning[],
): { readonly parsed: ParsedAtom; readonly z: number } | undefined {
  const index = Number.parseInt(fields[0] ?? "", 10);
  const symbol = fields[1] ?? "";
  if (!Number.isFinite(index) || index < 1 || symbol === "") {
    warnings.push({
      kind: "dropped-v3000-row",
      message: `Atom row ${position} has no readable index or symbol; skipped.`,
      line: entry.line,
      block: "ATOM",
      text: entry.content,
    });
    return undefined;
  }

  const coords: number[] = [];
  for (const raw of fields.slice(2, 5)) {
    const value = Number(raw);
    coords.push(Number.isFinite(value) ? value : 0);
  }
  if (coords.length < 3) {
    // A row that stops before z. The spec requires all three, but a writer that
    // trims is the sort of thing this reader exists to tolerate; a missing
    // coordinate is 0, which is the spec's own default everywhere else.
    while (coords.length < 3) coords.push(0);
    warnings.push({
      kind: "bad-v3000-row",
      message: `Atom ${index} is missing a coordinate; the missing one was read as 0.`,
      line: entry.line,
      block: "ATOM",
      text: entry.content,
    });
  }

  const keywords = v30Keywords(fields.slice(5));
  // `CHG=` is ABSOLUTE and there is no legacy column to supersede, so unlike
  // V2000 there is nothing to decide here.
  const charge = keywordInt(keywords, "CHG") ?? 0;
  // `RAD=` is a spin MULTIPLICITY — 1 singlet, 2 doublet, 3 triplet — the same
  // encoding as V2000's `M  RAD`, so the same table reads it.
  const radicalElectrons =
    RADICAL_ELECTRONS_BY_CODE.get(keywordInt(keywords, "RAD") ?? 0) ?? 0;
  // `MASS=` is the mass number ITSELF, not a difference from a reference nuclide
  // — that is V2000's `dd`. So there is no element table to consult and no
  // most-abundant-isotope question to get wrong. Confirmed against the spec ("the
  // absolute atomic weight of the designated atom") and against RDKit's `MASS=13`
  // for 13-C.
  const mass = keywordInt(keywords, "MASS");
  const isotope = mass === undefined || mass <= 0 ? undefined : mass;

  // `VAL=-1` means valence zero here; V2000 spells that 15. Translated rather
  // than shared, so neither constant can drift into the other's format.
  const val = keywordInt(keywords, "VAL");
  const valenceField =
    val === undefined || val === 0
      ? 0
      : val === V3000_VALENCE_ZERO
        ? VALENCE_ZERO_CODE
        : val;

  // The atom type names a query in V3000's own spelling (decision 238):
  // `R#` takes its number from `RGROUPS=(1 n)`, and a list is the type itself,
  // `[Cl,Br,I]` or — quoted, because of the space — `"NOT [N,O]"`.
  const type = symbol.startsWith('"') && symbol.endsWith('"') ? symbol.slice(1, -1) : symbol;
  const bracket = /^(NOT\s+)?\[([^\]]*)\]$/.exec(type);
  let query: AtomQuery | undefined;
  let pseudo = false;
  if (bracket !== null) {
    query = listQuery((bracket[2] ?? "").split(","), bracket[1] !== undefined) ?? {
      kind: "generic",
      label: type,
    };
  } else if (type === "R#") {
    const first = keywordList(keywords, "RGROUPS")?.values[0];
    query = first !== undefined && first >= 1 ? { kind: "rgroup", index: first } : { kind: "rgroup" };
  } else {
    const own = symbolQuery(type);
    query = own?.query;
    pseudo = own?.pseudo === true;
  }

  return {
    z: coords[2] ?? 0,
    parsed: {
      row: index,
      line: entry.line,
      symbol,
      x: coords[0] ?? 0,
      y: coords[1] ?? 0,
      charge,
      radicalElectrons,
      isotope,
      // `HCOUNT` is deliberately NOT read as an assertion. The spec's own atom
      // table calls it "Query hydrogen count", and RDKit treats a query field as
      // one — the same trap that made a molblock written with V2000's `hhh`
      // arrive as benzene-minus-its-hydrogens. The total valence says the same
      // thing without being a query.
      hydrogenField: 0,
      valenceField,
      // `CFG=` on an atom is V3000's parity; not read yet (decision 207).
      parity: 0,
      query,
      pseudo,
    },
  };
}

/** One `index type atom1 atom2 [CFG=n ...]` row. */
function readV3000Bond(
  entry: V30Entry,
  fields: readonly string[],
  position: number,
  warnings: MolblockWarning[],
): ParsedBond | undefined {
  const type = Number.parseInt(fields[1] ?? "", 10);
  const from = Number.parseInt(fields[2] ?? "", 10);
  const to = Number.parseInt(fields[3] ?? "", 10);
  if (!Number.isFinite(type) || !Number.isFinite(from) || !Number.isFinite(to)) {
    warnings.push({
      kind: "dropped-v3000-row",
      message: `Bond row ${position} is missing its type or an endpoint; skipped.`,
      line: entry.line,
      block: "BOND",
      text: entry.content,
    });
    return undefined;
  }

  const keywords = v30Keywords(fields.slice(4));
  const cfg = keywordInt(keywords, "CFG") ?? 0;
  const stereo = bondStereoFromCfg(cfg, type);
  if (stereo === undefined) {
    warnings.push({
      kind: "unsupported-bond-stereo",
      message: `Bond ${position} has CFG=${cfg}; read as plain.`,
      line: entry.line,
      row: position,
      stereo: cfg,
    });
  }

  return {
    row: position,
    line: entry.line,
    from,
    to,
    type,
    stereo: stereo ?? "none",
  };
}

/** One `name/subname ATOMS=(n ...)` collection entry. */
function readV3000Collection(
  entry: V30Entry,
  fields: readonly string[],
  warnings: MolblockWarning[],
): StereoCollectionRow | undefined {
  const name = (fields[0] ?? "").toUpperCase();
  if (name === "DEFAULT") return undefined;

  const matched = STEREO_COLLECTION_KINDS.find(([prefix]) => name.startsWith(prefix));
  if (!matched) {
    warnings.push({
      kind: "unsupported-collection",
      message:
        `The collection "${fields[0] ?? ""}" is not a stereochemistry collection ` +
        `and was dropped. Highlighting and user collections carry no chemistry.`,
      line: entry.line,
      name: fields[0] ?? "",
    });
    return undefined;
  }
  const [prefix, kind] = matched;

  // `STEABS` is unnumbered and `STERACn` / `STERELn` carry `n > 0`. An absolute
  // collection always gets index 1, so several `STEABS` lines UNION — which is
  // what the spec asks for: collections sharing a name are pieces of one
  // collection.
  const suffix = name.slice(prefix.length);
  const index = kind === "abs" ? 1 : Number.parseInt(suffix, 10);
  if (kind !== "abs" && (!Number.isFinite(index) || index < 1)) {
    warnings.push({
      kind: "bad-v3000-row",
      message:
        `The collection "${fields[0] ?? ""}" carries no group number; ` +
        `${prefix} needs one, so the collection was dropped.`,
      line: entry.line,
      block: "COLLECTION",
      text: entry.content,
    });
    return undefined;
  }

  const list = keywordList(v30Keywords(fields.slice(1)), "ATOMS");
  if (list === undefined || list.values.length === 0) {
    warnings.push({
      kind: "bad-v3000-row",
      message:
        `The collection "${fields[0] ?? ""}" lists no atoms; dropped. (A group ` +
        `with no centres says nothing, and an empty one would read as "this ` +
        `molecule is achiral".)`,
      line: entry.line,
      block: "COLLECTION",
      text: entry.content,
    });
    return undefined;
  }

  // The one cross-check `ATOMS=(n ...)` offers. A short list is what a lost
  // continuation dash looks like from here (T7 inbound), and the group it
  // yields is a DIFFERENT chemical statement — smaller, possibly no longer
  // covering every centre — so the values are kept and the shortfall is
  // reported rather than inferred by whoever notices the figure changed.
  if (list.values.length < list.declared) {
    warnings.push({
      kind: "collection-count-mismatch",
      message:
        `The collection "${fields[0] ?? ""}" says it holds ${list.declared} ` +
        `atoms and lists ${list.values.length}; the ${list.values.length} ` +
        `present were kept. A V3000 line past 80 characters continues with a ` +
        `trailing hyphen, so a list this short is usually a continuation that ` +
        `was trimmed away — the group now says less than the file meant.`,
      line: entry.line,
      name: fields[0] ?? "",
      declared: list.declared,
      found: list.values.length,
    });
  }

  return { kind, index, rows: list.values, line: entry.line };
}

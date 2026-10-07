/**
 * V2000 molfile (molblock) writer.
 *
 * The molblock is the lingua franca of chemical drawing: RDKit, Open Babel,
 * ChemDraw, PubChem and every SDF on earth read it. It is a fixed-column
 * format from 1980, so almost every rule below is a column count rather than
 * a design decision, and the comments say which is which.
 *
 * ALSO WRITES V3000, since enhanced stereochemistry has no V2000 spelling at
 * all: RDKit MinimalLib emits `MDLV30/STERAC1` in a COLLECTION block and never
 * a V2000 equivalent (measured — see `writeV3000`). The version is an EXPLICIT
 * option defaulting to V2000 and there is no "auto": decision 49 says the APP
 * chooses and says so in its export dialog, so the policy lives where the
 * dialog can report it and this codec stays free of it.
 *
 * QUERY FEATURES ARE WRITTEN (decision 238): an R-group as `R#` with `M  RGP`
 * (`RGROUPS=` in V3000), an atom list as `L` with `M  ALS` (a bracketed type in
 * V3000), "any atom" as `A` or `*`, a generic label as its MDL letter or as `*`
 * with an `A  ` alias, and query bonds as types 5-8 — the spellings RDKit reads
 * and writes back unchanged, measured against the pinned wasm.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: multi-record SDF (`$$$$` and the tagged
 * data block) and R-group definitions (`$RGP` blocks). Those belong in their
 * own modules.
 *
 * SUPERATOM S-GROUPS ARE WRITTEN (decision 225). A contracted abbreviation is
 * a `SUP` group over real atoms — V2000 `M  STY`/`SAL`/`SBL`/`SMT`/`SAP`,
 * V3000 an `SGROUP` block — so the file carries the full structure AND the
 * label, and a reader that ignores S-groups still gets the right molecule.
 * Only groups that are contracted right now are written (decision 240).
 *
 * `doubleBondSide` and `bold` are dropped, and come back from the reader as
 * `auto` and absent. Neither format has a field for them and never will: one
 * says which side of the bond axis a double bond's second line sits on, the
 * other draws a bond wide (decision 226), so unlike `label` —
 * the other purely cosmetic field, which changes WHICH MOLECULE the file
 * describes and therefore refuses to export — losing it changes only how the
 * same molecule is drawn. Silently dropping it is right; leaving it
 * undocumented was not.
 *
 * DETERMINISM. Two writes of the same molecule are byte-identical. The header
 * carries no timestamp, and nothing here consults a clock, a random source or
 * object-key order. That is what makes a molblock usable as a test fixture
 * and as the payload of a content hash.
 */

import { molfileAtomParity, type MolfileAtomParity } from "./atom-parity.js";
import { hasAromaticFlags, kekulize } from "./aromatic.js";
import { contractedAbbreviations } from "./abbreviations.js";
import type { ContractedAbbreviation } from "./abbreviations.js";
import { requireAtom, requireBond } from "./molecule.js";
import type { StereoConfig } from "./stereo-config.js";
import { stereoGroupTag, stereoGroupsOf } from "./stereo-groups.js";
import type { Atom, AtomId, AtomQuery, Bond, BondId, BondQuery, BondStereo, Molecule, StereoGroup } from "./types.js";
import { bondOrderSum, implicitHydrogenCount } from "./valence.js";

/**
 * Model bond-length units per molfile unit.
 *
 * The model draws with a default bond length of 1 (see `DEFAULT_BOND_LENGTH`
 * in sprout.ts); molfiles conventionally use 1.5, which is roughly the C-C
 * distance in Angstroms and is what every other program assumes when it
 * decides how big to draw an imported structure. Named and exported rather
 * than inlined so the writer's multiply and the reader's divide can never
 * drift apart, and so a caller with an unusual file can override it.
 */
export const MOLFILE_BOND_LENGTH = 1.5;

/**
 * Line 2 of the header, whose real layout is
 * `II PPPPPPPP MMDDYYHHmm dd SS ss EE RR` — user initials, program name, a
 * timestamp, and the dimensional code.
 *
 * The timestamp columns are left blank ON PURPOSE. A date here would make two
 * writes of the same molecule differ, which breaks byte-comparison in tests,
 * content-addressed caching, and any "has this changed?" check. Readers treat
 * the whole field as decorative; only the `2D` matters.
 */
const PROGRAM_LINE = "  chemcore          2D";

/** V2000 counts fields are three characters wide, so 999 is the ceiling. */
const MAX_V2000_COUNT = 999;

/**
 * A molfile line is 80 characters. Titles are the one field a user types
 * freely, so they get clipped rather than allowed to push the file out of
 * spec.
 */
const MAX_HEADER_LINE = 80;

/** At most eight (index, value) pairs fit on one property line. */
const PROPERTY_PAIRS_PER_LINE = 8;

/**
 * The V2000 hydrogen-count field `hhh` encodes H0..H4 as 1..5 and has no room
 * for more. A count above that is not clamped — clamping exported a different
 * molecule than the one in hand and said nothing about it — but expressed
 * through the `vvv` valence field instead, which holds 1..14 and which the
 * reader already inverts. Only a total valence past that is genuinely
 * unrepresentable, and that throws.
 */
const MAX_ENCODABLE_HYDROGENS = 4;

/** `vvv` holds 1..14, with 15 meaning "valence zero" (0 means unspecified). */
const MAX_ENCODABLE_VALENCE = 14;

/** `vvv` of 15 means "valence zero", since 0 already means "unspecified". */
const VALENCE_ZERO_CODE = 15;

/** Every coordinate field is `%10.4f`: ten columns, no separator. */
const COORD_WIDTH = 10;

/**
 * Which molfile field carries the hydrogen count.
 *
 * `hhh` is what the CTfile spec calls a QUERY field, and readers are entitled
 * to treat it that way. RDKit does: a nonzero `hhh` turns the atom into a
 * query atom with `setNoImplicit(true)` and an implicit-H-count QUERY, and
 * never sets a real hydrogen count — so a molblock written with `hhh` reaches
 * RDKit as a molecule with NO hydrogens at all, silently and with nothing
 * logged. Measured: chem-core benzene arrives as `[c]1[c][c][c][c][c]1`, C6
 * rather than C6H6, and ethanol as C2O.
 *
 * `"hhh"` is what this writer originally emitted and what its own reader
 * inverts, so it remains the right choice for a file this package will read
 * back and for readers that treat `hhh` as an assertion. It is NOT the
 * default any more — the signature below says `"valence"`, and this paragraph
 * went on claiming the opposite two lines above it. Anyone who trusted the
 * prose would have concluded that `moleculeToMolblock` in the client's RDKit
 * bridge sets the option redundantly, and deleted the one line standing
 * between chem-core benzene and RDKit reading it as C6.
 *
 * `"valence"` says nothing at all about an atom whose hydrogens the reader can
 * derive, and states `vvv` (the TOTAL valence, which is not a query field) for
 * an atom whose count is PINNED — the one case no valence table can recover,
 * pyrrole's N-H and stannabenzene's being the standing examples. Silence is
 * the higher-fidelity choice for a reader with its own valence table, because
 * this package's table is calibrated to RDKit's on purpose; an assertion can
 * only ever disagree with it.
 */
export type HydrogenAssertion = "hhh" | "valence";

/**
 * Which molfile generation to write.
 *
 * THE CALLER PICKS; there is no `"auto"`. Decision 49 puts the choice in the
 * app, which switches to V3000 whenever the molecule has stereo groups and says
 * so in the export dialog. A codec that guessed would make the dialog's claim
 * and the file's contents two separate things that could drift, and it would
 * take the refusal below — the one thing that tells a direct API caller its
 * request cannot be honoured — away from it.
 */
export type MolblockVersion = "V2000" | "V3000";

export interface MolblockWriteOptions {
  /** Line 1 of the header. Newlines are stripped; clipped to 80 characters. */
  readonly title?: string | undefined;
  /** Line 3 of the header. Same treatment as the title. */
  readonly comment?: string | undefined;
  /** Overrides `MOLFILE_BOND_LENGTH`. Model coordinates are multiplied by it. */
  readonly coordinateScale?: number | undefined;
  /** See `HydrogenAssertion`. Defaults to `"valence"`. */
  readonly hydrogenAssertion?: HydrogenAssertion | undefined;
  /** See `MolblockVersion`. Defaults to `"V2000"`, which is what every reader
   *  takes and what a molecule with no stereo groups should still be. */
  readonly version?: MolblockVersion | undefined;
  /**
   * Write each stereocentre's V2000 atom parity (`sss`) from this
   * configuration of `mol` (decision 207; atom-parity.ts has the rule).
   * Omitted, the column is 0 and the wedges alone carry configuration, as
   * they always have. For a drawing with no mark to carry its configuration
   * (a Fischer), this is the only statement the file makes. V2000 only: a
   * V3000 request with it refuses rather than drop it.
   */
  readonly atomParity?: StereoConfig | undefined;
}

/**
 * Thrown when a molecule carries a display label and so cannot be written.
 *
 * A `label` is cosmetic — "Ph", "Boc", "R" drawn in place of the element
 * symbol — while valence, formula and every export path use `element`. Writing
 * the underlying element would turn a phenyl abbreviation into a methyl in the
 * exported file, and the file would look perfectly valid. Refusing is the only
 * honest option: the caller (the UI) knows whether to expand the abbreviation
 * into real atoms or strip it, and this error hands it the atom ids it needs
 * to ask about.
 *
 * Emitting an R-group atom instead was considered and rejected: an R-group is
 * a query feature with its own meaning, and silently converting "Boc" into
 * "R1" is the same lie in a different costume.
 */
export class MolblockLabelError extends Error {
  readonly atomIds: readonly AtomId[];
  constructor(message: string, atomIds: readonly AtomId[]) {
    super(message);
    this.name = "MolblockLabelError";
    this.atomIds = atomIds;
  }
}

/**
 * Thrown when V2000 was asked for and the molecule carries stereo groups.
 *
 * The same reasoning as `MolblockLabelError` above, one field further on. V2000
 * has NO spelling for an ABS/AND/OR collection — verified 2026-09-14: RDKit
 * MinimalLib writes enhanced stereo only as V3000, and `get_molblock()` on
 * `C[C@H](O)[C@@H](C)Cl |&1:1,3|` emits `MDLV30/STERAC1` inside a V3000
 * COLLECTION block with nothing in the V2000 rendering standing in for it. So
 * writing V2000 anyway would export a single enantiomer where the drawing says
 * racemate: a file that looks perfectly valid and names a different compound,
 * which is exactly what a display label would have done.
 *
 * Refusing is the only honest option, and as with a label the caller is the one
 * that knows what to do about it — decision 49 has the export dialog switch to
 * V3000 and say so — so this error hands over the groups it needs to explain
 * itself rather than just a sentence.
 */
export class MolblockStereoGroupError extends Error {
  readonly stereoGroups: readonly StereoGroup[];
  constructor(message: string, stereoGroups: readonly StereoGroup[]) {
    super(message);
    this.name = "MolblockStereoGroupError";
    this.stereoGroups = stereoGroups;
  }
}

/**
 * Thrown when V2000 was asked for and the molecule carries a dative bond.
 *
 * V2000 has no bond type for a coordinate bond; V3000's type 9 is the one
 * spelling, and RDKit writes a DATIVE bond only that way (measured: `N->B`
 * comes out of `get_molblock()` as a V3000 file). Writing it as a single bond
 * would move a hydrogen — the donor's — onto the file's reading of the
 * structure, so as with stereo groups the app picks V3000 (decision 49) and a
 * direct V2000 request refuses, handing over the bond ids.
 */
export class MolblockDativeBondError extends Error {
  readonly bondIds: readonly BondId[];
  constructor(message: string, bondIds: readonly BondId[]) {
    super(message);
    this.name = "MolblockDativeBondError";
    this.bondIds = bondIds;
  }
}

/** V3000's "coordination" bond type, RDKit's DATIVE (decision 226). */
const V3000_DATIVE_BOND_TYPE = 9;

/**
 * Bond stereo as V2000 codes.
 *
 * Written as a total `Record` so that adding a member to `BondStereo` is a
 * compile error here rather than a bond quietly exported as "no stereo".
 *
 * 1 and 6 are wedge and hash on a single bond. 4 is "either" on a SINGLE bond
 * — the wavy line meaning "configuration unknown at this centre". 3 is
 * "cis or trans either" on a DOUBLE bond, which is a different statement about
 * a different kind of uncertainty, which is why the model keeps `wavy` and
 * `either` apart instead of folding them together.
 */
const STEREO_TO_CODE: Record<BondStereo, number> = {
  none: 0,
  wedge: 1,
  either: 3,
  wavy: 4,
  hash: 6,
};

/**
 * Bond stereo as V3000 `CFG=` values, which are NOT the V2000 codes.
 *
 * V2000 spends four numbers on this (1 wedge, 6 hash, 4 either-on-a-single-bond,
 * 3 either-on-a-double-bond); V3000 spends three, and only `1` means the same
 * thing in both. Verified twice over, because reusing the V2000 table here would
 * mangle every wedge in the file and the file would still parse:
 *
 *   - the CTfile specification's bond-block table reads "0 = none (default),
 *     1 = up, 2 = either, 3 = down";
 *   - RDKit MinimalLib agrees in the round trip. Feeding it a V3000 bond with
 *     `CFG=1` yields `wU` in CXSMILES and V2000 stereo 1; `CFG=3` yields `wD`
 *     and V2000 stereo 6; `CFG=2` yields `w` (the unknown wedge) on a single
 *     bond and V2000 stereo 3 on a double bond.
 *
 * THE MODEL'S TWO KINDS OF "EITHER" COLLAPSE INTO `CFG=2`, AND TWO CELLS OF THE
 * MATRIX COME BACK AS THE OTHER ONE. `wavy` is a squiggly single bond meaning
 * "configuration unknown at this centre"; `either` is a crossed double bond
 * meaning "cis or trans unknown". V3000 writes both as `CFG=2` and has nothing
 * else to say which was meant, so the reader infers it from the bond ORDER —
 * single reads back `wavy`, double reads back `either`. That is exact for the
 * two combinations chemistry uses, and SILENTLY WRONG for the two it does not:
 *
 *   - `either` on a SINGLE bond, written `CFG=2`, reads back as `wavy`;
 *   - `wavy` on a DOUBLE bond, written `CFG=2`, reads back as `either`.
 *
 * Fourteen of the sixteen stereo x order cells round-trip exactly; those two do
 * not, with no warning, because from the reader's side there is nothing to
 * warn about. Both are reachable: the bond-stereo commands apply either mark to
 * any selected bond, and decision 49 picks V3000 as soon as the document states
 * a stereo group. `molblock.test.ts` pins the whole matrix so the two cells are
 * visible rather than folklore.
 *
 * NOT NORMALISED AT WRITE TIME (decision 100). Collapsing `either` to `wavy` on
 * a single bond in BOTH generations would make the two formats agree by
 * DEGRADING V2000, which keeps all sixteen — destroying information one file
 * can hold to make the other's limit uniform. Whether `either` should be
 * offerable on a single bond at all is a separate question, not this codec's.
 * That is also why `STEREO_TO_CODE` above must keep its four distinct numbers:
 * the model's distinction is real, and only this one format merges it.
 *
 * A total `Record`, so a new `BondStereo` member is a compile error in BOTH
 * writers rather than a bond quietly exported as plain.
 */
const STEREO_TO_CFG: Record<BondStereo, number> = {
  none: 0,
  wedge: 1,
  either: 2,
  wavy: 2,
  hash: 3,
};

/** `MDLV30/` collection names, per the CTfile spec's internal-collection table
 *  and confirmed against RDKit's output. `STEABS` is UNNUMBERED — there is one
 *  absolute collection per structure — while the other two take the group's
 *  stored index. */
const COLLECTION_NAME: Record<StereoGroup["kind"], string> = {
  abs: "MDLV30/STEABS",
  and: "MDLV30/STERAC",
  or: "MDLV30/STEREL",
};

/** Every V3000 body line starts with this, continuations included. */
const V30 = "M  V30 ";

/**
 * A V3000 line is 80 characters at most, continued with a trailing dash.
 *
 * The spec: "Each entry is one line of no more than 80 characters. To allow
 * continuation when the 80-character line is too short, use a dash (-) as the
 * last character. When read, the line is concatenated with the next line by
 * removing the dash and stripping the initial 'M  V30' from the following line."
 *
 * The break happens at 78 so that the content plus the space plus the dash still
 * fit — which is also where RDKit breaks: measured, its longest written line is
 * 77 characters including the dash.
 */
const MAX_V30_CONTENT = 80;
const V30_BREAK = 78;

/**
 * V3000's "valence zero" sentinel, which is NOT V2000's 15.
 *
 * V2000 uses `vvv` = 15 because 0 already means "unspecified"; V3000 uses
 * `VAL=-1` and keeps 1..14 for a real valence. Verified against the spec's atom
 * keyword table ("Integer > 0 or 0 = none (default), -1 = zero") and against
 * RDKit, which turns a V3000 `VAL=-1` into a V2000 `vvv` of 15 and back. Sharing
 * `VALENCE_ZERO_CODE` between the two writers would write a valence of fifteen
 * into a file that means something else by it.
 */
const V3000_VALENCE_ZERO = -1;

/** Right-justify an integer in a fixed-width column. */
function int(value: number, width: number): string {
  return String(Math.trunc(value)).padStart(width, " ");
}

/**
 * `%10.4f`, or `undefined` when ten columns cannot hold the number.
 *
 * NEGATIVE ZERO is normalised away: `(-0.00001).toFixed(4)` is `"-0.0000"`,
 * which is a different byte string for the same coordinate depending on which
 * side of zero a rounding error landed — exactly the kind of thing that makes
 * "identical molecule, different file" happen.
 *
 * WIDTH IS NOT NEGOTIABLE. `padStart` cannot truncate, so an eleven-character
 * number does not overflow its own field, it shifts every field after it: the
 * element symbol lands in the mass-difference column and a fixed-column reader
 * — including this package's own — reads a different molecule, or drops the
 * atom entirely. So decimals are traded for integer digits first (a coordinate
 * that big has no meaningful fraction anyway), and a number that will not fit
 * even at zero decimals is refused by the caller rather than written. Values
 * at or above 1e21 are refused outright: `toFixed` switches to exponent
 * notation there, which is short enough to pad but is not a legal molfile
 * real.
 */
function coord(value: number): string | undefined {
  const safe = Number.isFinite(value) ? value : 0;
  if (Math.abs(safe) >= 1e21) return undefined;
  for (let digits = 4; digits >= 0; digits--) {
    let text = safe.toFixed(digits);
    if (digits === 4 && Number.parseFloat(text) === 0) text = (0).toFixed(4);
    if (text.length <= COORD_WIDTH) return text.padStart(COORD_WIDTH, " ");
  }
  return undefined;
}

/** The z column of a 2D model: a constant, and always representable. */
const ZERO_COORD = coord(0) ?? "";

/** Header lines are free text; a newline in one would corrupt the record. */
function headerLine(text: string | undefined): string {
  if (text === undefined) return "";
  return text.replace(/[\r\n]+/g, " ").slice(0, MAX_HEADER_LINE);
}

/**
 * One `M  XXX` property block, split across as many lines as the eight-pair
 * limit requires. Returns nothing when there is nothing to say — an empty
 * property line is legal but meaningless, and omitting it keeps the common
 * case (a neutral, unlabelled molecule) byte-for-byte minimal.
 */
function propertyLines(tag: string, pairs: readonly (readonly [number, number])[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < pairs.length; i += PROPERTY_PAIRS_PER_LINE) {
    const chunk = pairs.slice(i, i + PROPERTY_PAIRS_PER_LINE);
    let line = `M  ${tag}${int(chunk.length, 3)}`;
    for (const [index, value] of chunk) {
      line += `${int(index, 4)}${int(value, 4)}`;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * The MDL letters a generic label can be written as directly (decision 238).
 * Every other label — "Ar", "Hal", "Pol" — goes out as `*` with an alias,
 * because written as its own symbol "Ar" is argon.
 */
const MDL_GENERIC_LABELS: ReadonlySet<string> = new Set([
  "Q", "QH", "X", "XH", "M", "MH", "AH", "L",
]);

/** Query bonds as molfile bond types, the same in both generations. */
const BOND_TYPE_BY_QUERY: Readonly<Record<BondQuery, number>> = {
  "single-or-double": 5,
  "single-or-aromatic": 6,
  "double-or-aromatic": 7,
  any: 8,
};

/** The molfile bond type: a query's own type, else 4 for a flagged aromatic
 *  bond, else the order. */
function bondType(bond: Bond): number {
  if (bond.query !== undefined) return BOND_TYPE_BY_QUERY[bond.query];
  // Type 4 is "aromatic". Emitted only for a bond the model has actually
  // flagged; a Kekule structure stays Kekule, which is what most journals
  // print and what every reader agrees about.
  return bond.aromatic ? 4 : bond.order;
}

/** The V2000 atom symbol for a query atom, and what else it needs. */
function v2000QuerySymbol(query: AtomQuery): {
  readonly symbol: string;
  readonly alias?: string;
} {
  switch (query.kind) {
    case "rgroup":
      return { symbol: query.index === undefined ? "R" : "R#" };
    case "any":
      return { symbol: query.symbol };
    case "list":
      return { symbol: "L" };
    case "generic":
      return MDL_GENERIC_LABELS.has(query.label)
        ? { symbol: query.label }
        : { symbol: "*", alias: query.label };
  }
}

/**
 * `M  ALS aaannn e 11112222…`, column for column as RDKit writes it: the
 * atom in four columns, the count in three, T for a NOT-list, then each
 * member left-justified in four.
 */
function atomListLine(row: number, query: Extract<AtomQuery, { kind: "list" }>): string {
  const members = query.elements.map((symbol) => symbol.padEnd(4, " ")).join("");
  return `M  ALS${int(row, 4)}${int(query.elements.length, 3)} ${query.negated ? "T" : "F"} ${members}`;
}

/**
 * The V3000 atom type for a query atom, plus any keyword it needs. A generic
 * label with no MDL letter has no V3000 spelling at all — V3000 has no alias
 * line — so it comes back undefined and `writeMolblock` refuses.
 */
function v3000QueryType(query: AtomQuery): { readonly type: string; readonly keyword?: string } | undefined {
  switch (query.kind) {
    case "rgroup":
      return query.index === undefined
        ? { type: "R" }
        : { type: "R#", keyword: `RGROUPS=(1 ${query.index})` };
    case "any":
      return { type: query.symbol };
    case "list": {
      const bracket = `[${query.elements.join(",")}]`;
      return { type: query.negated ? `"NOT ${bracket}"` : bracket };
    }
    case "generic":
      return MDL_GENERIC_LABELS.has(query.label) && query.label !== "L"
        ? { type: query.label }
        : undefined;
  }
}

/** Generic atoms a V3000 file cannot carry. */
function v3000Unwritable(mol: Molecule): Atom[] {
  return mol.atomIds
    .map((id) => requireAtom(mol, id))
    .filter((atom) => atom.query !== undefined && v3000QueryType(atom.query) === undefined);
}

/**
 * Model radical electrons as an `M  RAD` spin-multiplicity code.
 *
 * The file field is a multiplicity, not a count: 1 singlet, 2 doublet,
 * 3 triplet. One unpaired electron is a doublet, two is a triplet. A carbene
 * drawn as a singlet is indistinguishable from a triplet in the model (both
 * are `radicalElectrons: 2`), and triplet is the code RDKit writes for it, so
 * that is what goes out.
 */
function radicalCode(electrons: number): number {
  return electrons >= 2 ? 3 : 2;
}
/**
 * Everything both writers need to know about one atom, decided once.
 *
 * The hydrogen decision in particular: a count that has to be ASSERTED, and the
 * total valence that expresses it. Shared because the DECISION is the same in
 * both generations and only the ENCODING differs — V2000 spends `vvv` with 15
 * for zero, V3000 spends `VAL=` with -1 for zero — and a second copy of the
 * reasoning is a second place for the two to drift.
 */
interface AtomFacts {
  readonly hydrogens: number;
  /**
   * The TOTAL valence to state, or `undefined` for "say nothing and let the
   * reader derive".
   *
   * Never a hydrogen COUNT. Both formats' hydrogen-count fields are QUERY fields
   * — V2000's `hhh`, and V3000's `HCOUNT`, which the CTfile spec's atom table
   * literally names "Query hydrogen count" — and RDKit treats a query field as
   * one: benzene written with `hhh` arrives as C6 rather than C6H6, silently.
   * The total valence is not a query field, and this package's reader already
   * subtracts the drawn bonds back off it.
   */
  readonly totalValence: number | undefined;
}

/**
 * Whether this atom's hydrogen count has to be stated, and as what valence.
 *
 * In `"valence"` mode only a PIN is worth a field: it is the model saying "do not
 * derive", and it is the one thing a valence table cannot recover (pyrrole's N-H
 * is the standing casualty). Silence is the higher-fidelity choice for a reader
 * with its own table, because this package's table is calibrated to RDKit's on
 * purpose, so an assertion can only ever disagree with it.
 */
function atomFacts(
  hSource: Molecule,
  atomId: AtomId,
  pinned: boolean,
  assertion: HydrogenAssertion,
): AtomFacts {
  const hydrogens = Math.max(implicitHydrogenCount(hSource, atomId), 0);
  if (assertion !== "hhh" && !pinned) return { hydrogens, totalValence: undefined };
  // Rounded because an aromatic bond that kekulisation could not resolve still
  // weighs 1.5, and a fractional valence is not a legal field.
  return {
    hydrogens,
    totalValence: Math.round(bondOrderSum(hSource, atomId) + hydrogens),
  };
}

/** Both writers refuse the same unrepresentable valence, with the same message
 *  naming the bound that was exceeded. */
function checkValence(atomId: AtomId, hydrogens: number, total: number): void {
  if (total <= MAX_ENCODABLE_VALENCE) return;
  throw new Error(
    `Atom ${atomId} carries ${hydrogens} hydrogens, and its total valence of ` +
      `${total} exceeds the ${MAX_ENCODABLE_VALENCE} a molfile valence field ` +
      `can express. Reduce the hydrogen count.`,
  );
}

/**
 * Serialise `mol` as a molblock.
 *
 * V2000 by default (`options.version`), because it is what every reader takes
 * and what thirty years of tooling expects. V3000 is the caller's explicit
 * choice — see `MolblockVersion` for why there is no "auto".
 *
 * @throws {MolblockLabelError} if any atom carries a display `label`.
 * @throws {MolblockStereoGroupError} if V2000 was asked for and the molecule
 *   carries stereo groups, which V2000 cannot express at all.
 * @throws {Error} if the structure is too large for V2000's three-column counts
 *   fields, if a coordinate does not fit its ten-column field, or if an atom's
 *   valence exceeds what a valence field holds. All of them are cases where the
 *   only alternative is a file that describes a different molecule.
 */
export function writeMolblock(mol: Molecule, options: MolblockWriteOptions = {}): string {
  const scale = options.coordinateScale ?? MOLFILE_BOND_LENGTH;
  const assertion = options.hydrogenAssertion ?? "valence";
  const version = options.version ?? "V2000";

  // Collected across the whole molecule and reported in one go: a user who
  // abbreviated six groups wants one dialog listing six, not six dialogs.
  const labelled = mol.atomIds.filter((id) => requireAtom(mol, id).label !== undefined);
  if (labelled.length > 0) {
    const described = labelled
      .map((id) => `${id} ("${requireAtom(mol, id).label ?? ""}")`)
      .join(", ");
    throw new MolblockLabelError(
      `Cannot write a molblock for atoms carrying display labels: ${described}. ` +
        `A label replaces the element symbol only when drawing, so writing the ` +
        `underlying element would export a different molecule than the one on ` +
        `screen. Draw the atoms and contract them to an abbreviation instead ` +
        `(decision 225), or clear the label.`,
      labelled,
    );
  }

  if (version === "V3000") {
    const unwritable = v3000Unwritable(mol);
    if (unwritable.length > 0) {
      const described = unwritable
        .map((atom) => `${atom.id} ("${atom.query?.kind === "generic" ? atom.query.label : ""}")`)
        .join(", ");
      throw new MolblockLabelError(
        `Cannot write a V3000 molblock for generic atoms labelled ${described}. ` +
          `V3000 has no alias field, and written as its own symbol a label such ` +
          `as "Ar" names an element. Use an R-group or an MDL generic letter ` +
          `(Q, X, M), or write V2000.`,
        unwritable.map((atom) => atom.id),
      );
    }
  }

  const groups = stereoGroupsOf(mol);
  if (version === "V2000" && groups.length > 0) {
    const described = groups
      .map((group) => `${stereoGroupTag(group)} (${group.atomIds.join(", ")})`)
      .join(", ");
    throw new MolblockStereoGroupError(
      `Cannot write a V2000 molblock for a molecule carrying stereo groups: ` +
        `${described}. V2000 has no field for an ABS/AND/OR collection, so the ` +
        `file would claim a single enantiomer where the drawing says a racemate ` +
        `— a different compound, in a file that looks perfectly valid. Write ` +
        `V3000 instead, or clear the groups first.`,
      groups,
    );
  }

  const dative = mol.bondIds.filter((id) => requireBond(mol, id).dative === true);
  if (version === "V2000" && dative.length > 0) {
    throw new MolblockDativeBondError(
      `Cannot write a V2000 molblock for a molecule carrying dative bonds: ` +
        `${dative.join(", ")}. V2000 has no coordinate bond type, and writing a ` +
        `single bond would give the donor a hydrogen it does not have. Write ` +
        `V3000 instead, where a dative bond is type 9.`,
      dative,
    );
  }

  // WHERE THE HYDROGEN ASSERTION COMES FROM. Not from `mol`, if `mol` carries
  // aromatic flags: valence.ts weighs an aromatic bond 1.5, so a flagged
  // thiophene's sulfur sums to 3, lands between its valences of 2 and 4, and
  // is credited with a hydrogen it does not have. Writing that into `hhh`
  // exports an S-H to every other program, and — worse — the reader kekulises
  // on import, correctly derives zero, sees the file disagree, and PINS the
  // phantom hydrogen, turning a transient valence bug into a stored one that
  // outlives the fix. Kekulising here makes the asserted count the one the
  // reader will derive, so the two agree and no pin is invented. Bond type 4
  // still comes from `mol`'s own flags, so the aromatic form round-trips.
  // `kekulize` preserves atom ids and returns `mol` itself when unflagged.
  const hSource = hasAromaticFlags(mol) ? kekulize(mol) : mol;

  // Ids are opaque. `a1`, `b2`, `a3` is a perfectly ordinary sequence because
  // atoms and bonds share one counter, so the row number MUST come from this
  // map and never from digits scraped out of an id.
  const rowOf = new Map<AtomId, number>();
  mol.atomIds.forEach((id, index) => rowOf.set(id, index + 1));

  // Decision 207: the parity column, only when asked for, and never silently
  // dropped by a generation that does not write it yet.
  const parities = new Map<AtomId, MolfileAtomParity>();
  if (options.atomParity !== undefined) {
    if (version === "V3000") {
      throw new Error(
        "Atom parity is written in the V2000 sss column only; V3000's CFG= atom keyword is not written yet, " +
          "so a V3000 file would silently drop the configuration the caller asked to state.",
      );
    }
    for (const centre of options.atomParity.centres) {
      if (!rowOf.has(centre.atomId)) {
        throw new Error(`The atom-parity configuration names ${centre.atomId}, which is not in the molecule.`);
      }
      const code = molfileAtomParity(mol, centre, (id) => rowOf.get(id) ?? Number.MAX_SAFE_INTEGER);
      if (code !== 0) parities.set(centre.atomId, code);
    }
  }

  // The counts-line chiral flag: 1 when the drawing states a configuration at
  // all, which for this model means a wedge or a hash somewhere.
  //
  // DELIBERATELY NOT REVISITED FOR STEREO GROUPS, although the model can now
  // say "racemate" and this flag reads as "not a racemate". A wedged molecule
  // carrying an AND collection therefore writes `chiral=1` beside
  // `MDLV30/STERAC1`, which looks like a contradiction and is not worth
  // resolving here, for three reasons:
  //
  //   - There is ONE flag for the whole file and collections are per atom. A
  //     structure with an ABS collection on one centre and an AND collection on
  //     another is a perfectly ordinary scheme drawing, and no single bit is
  //     right about it. A bit that is right only for the uniform cases is worse
  //     than a bit that means one fixed, documented thing.
  //   - A grouped molecule only ever reaches V3000 (decision 25 refuses V2000
  //     for it by name), and in a V3000 file the COLLECTION block is the
  //     statement. A reader that understands collections has no reason to
  //     consult a one-bit summary; a reader that does not cannot be rescued by
  //     the bit either, since it will take the wedges as absolute regardless.
  //   - The flag carries no information in practice. The spec says only "1 if
  //     the molecule is chiral, 0 if not"; RDKit writes 0 even for a pure
  //     single enantiomer, so its value distinguishes nothing there; and
  //     chem-core's own reader ignores the field entirely, so nothing about the
  //     self round-trip depends on it.
  const chiral = mol.bondIds.some((id) => {
    const stereo = requireBond(mol, id).stereo;
    return stereo === "wedge" || stereo === "hash";
  })
    ? 1
    : 0;

  const header = [
    headerLine(options.title),
    PROGRAM_LINE,
    headerLine(options.comment),
  ];

  const superatoms = superatomRows(mol, rowOf);
  const body =
    version === "V3000"
      ? writeV3000(mol, hSource, rowOf, chiral, scale, assertion, groups, superatoms)
      : writeV2000(mol, hSource, rowOf, chiral, scale, assertion, parities, superatoms);

  return `${[...header, ...body].join("\n")}\n`;
}

/** The V2000 body: counts line, fixed-column atom and bond blocks, `M  XXX`
 *  property lines, `M  END`. */
function writeV2000(
  mol: Molecule,
  hSource: Molecule,
  rowOf: ReadonlyMap<AtomId, number>,
  chiral: number,
  scale: number,
  assertion: HydrogenAssertion,
  parities: ReadonlyMap<AtomId, MolfileAtomParity>,
  superatoms: readonly SuperatomRow[],
): string[] {
  if (mol.atomIds.length > MAX_V2000_COUNT || mol.bondIds.length > MAX_V2000_COUNT) {
    throw new Error(
      `V2000 counts fields are three characters wide, so it cannot express ` +
        `${mol.atomIds.length} atoms / ${mol.bondIds.length} bonds. Use V3000 ` +
        `for structures this large.`,
    );
  }

  const charges: [number, number][] = [];
  const isotopes: [number, number][] = [];
  const radicals: [number, number][] = [];
  const rgroups: [number, number][] = [];
  const atomLists: string[] = [];
  const aliases: string[] = [];
  const lines: string[] = [];

  lines.push(
    `${int(mol.atomIds.length, 3)}${int(mol.bondIds.length, 3)}` +
      // Atom-list and obsolete "fff" counts, both dead in V2000.
      `  0  0` +
      `${int(chiral, 3)}` +
      // stext, then four obsolete counts, then the properties count (always
      // 999 by convention) and the version stamp.
      `  0  0  0  0  0999 V2000`,
  );

  for (const atomId of mol.atomIds) {
    const atom = requireAtom(mol, atomId);
    const row = rowOf.get(atomId) ?? 0;

    // Truncate FIRST, then decide whether there is anything to say. The fields
    // are typed `number` with nothing enforcing integrality, and a charge of
    // 0.5 passes a `!== 0` test but writes as 0 — an `M  CHG` line declaring a
    // charge of zero, which per the spec also zeroes every legacy ccc column,
    // for no gain. Only what will actually be written counts.
    const charge = Math.trunc(atom.charge);
    if (charge !== 0) charges.push([row, charge]);
    // `M  ISO` of 0 means "natural abundance", i.e. no isotope at all, so a
    // zero or negative mass number is silence rather than a nuclide.
    const isotope = atom.isotope === undefined ? 0 : Math.trunc(atom.isotope);
    if (isotope > 0) isotopes.push([row, isotope]);
    const radicalElectrons = Math.trunc(atom.radicalElectrons);
    if (radicalElectrons > 0) {
      radicals.push([row, radicalCode(radicalElectrons)]);
    }

    // NO Y-FLIP. Model coordinates are y-up and so are molfile coordinates;
    // only the SVG renderer flips. Every past import bug in this area came
    // from someone "fixing" a mirror image at the wrong layer.
    const x = coord(atom.pos.x * scale);
    const y = coord(atom.pos.y * scale);
    if (x === undefined || y === undefined) {
      throw coordinateError(atomId, atom.pos.x, atom.pos.y, scale);
    }

    const facts = atomFacts(hSource, atomId, atom.explicitHydrogenCount !== undefined, assertion);
    let hydrogenField = 0;
    let valenceField = 0;
    if (facts.totalValence === undefined) {
      // nothing to say
    } else if (assertion !== "hhh") {
      // `vvv` is the total valence, not a query field, and the reader already
      // subtracts the drawn bonds back off it. 15 is the spec's "valence
      // zero", since 0 already means "unspecified".
      checkValence(atomId, facts.hydrogens, facts.totalValence);
      valenceField = facts.totalValence === 0 ? VALENCE_ZERO_CODE : facts.totalValence;
    } else if (facts.hydrogens <= MAX_ENCODABLE_HYDROGENS) {
      // `hhh` is "count plus one" because 0 is reserved for "not specified".
      hydrogenField = facts.hydrogens + 1;
    } else {
      // Past H4 the `hhh` field is out of room, so the count goes out as a
      // total valence instead and the reader subtracts the drawn bonds back
      // off it — which it already does, because that is what RDKit writes.
      // Only reachable through an extreme formal charge or a deliberate pin,
      // but clamping to H4 quietly deleted hydrogens from the exported
      // molecule, and this module's whole position (see `MolblockLabelError`)
      // is that a plausible wrong file is worse than a refusal.
      checkValence(atomId, facts.hydrogens, facts.totalValence);
      valenceField = facts.totalValence;
    }

    // A query atom's symbol is its MDL spelling, and the rest of the query
    // goes out in the properties block (decision 238).
    let symbol = atom.element;
    if (atom.query !== undefined) {
      const written = v2000QuerySymbol(atom.query);
      symbol = written.symbol;
      if (atom.query.kind === "rgroup" && atom.query.index !== undefined) {
        rgroups.push([row, atom.query.index]);
      }
      if (atom.query.kind === "list") atomLists.push(atomListLine(row, atom.query));
      if (written.alias !== undefined) aliases.push(`A  ${int(row, 3)}`, written.alias);
    }

    lines.push(
      `${x}${y}${ZERO_COORD} ` +
        // Symbol left-justified in three columns, unlike every numeric field.
        `${symbol.slice(0, 3).padEnd(3, " ")}` +
        // dd, the RELATIVE mass difference. Always 0: isotopes go out as
        // `M  ISO`, which carries the absolute mass number and needs no
        // agreement about which isotope counts as the reference.
        ` 0` +
        // ccc, the legacy charge column. Always 0: it cannot express a charge
        // beyond +-3, and the spec says an `M  CHG` line supersedes it
        // wholesale anyway.
        `  0` +
        // sss atom stereo parity: 0 unless the caller passed `atomParity`
        // (decision 207). The reader still derives configuration from the
        // wedges; this column is for a drawing that has none to carry it.
        `${int(parities.get(atomId) ?? 0, 3)}` +
        `${int(hydrogenField, 3)}` +
        // bbb stereo care box (a query feature), then vvv valence. vvv is 0 —
        // "use the element's default" — for every atom whose hydrogens fit in
        // hhh above, which under the default assertion is all of them bar the
        // extreme cases handled there, and under "valence" is every atom that
        // is not pinned.
        `  0${int(valenceField, 3)}` +
        // HHH rrr iii mmm nnn eee — obsolete or reaction-only.
        `  0  0  0  0  0  0`,
    );
  }

  for (const bondId of mol.bondIds) {
    const bond = requireBond(mol, bondId);
    const from = rowOf.get(bond.from);
    const to = rowOf.get(bond.to);
    if (from === undefined || to === undefined) {
      throw new Error(`Bond ${bondId} references an atom that is not in the molecule`);
    }
    const type = bondType(bond);
    // `from` FIRST, always. The narrow end of a wedge is at the first atom of
    // the row, so writing `to` first would silently invert every stereocentre
    // in the file — and the file would still be perfectly valid.
    lines.push(
      `${int(from, 3)}${int(to, 3)}${int(type, 3)}${int(STEREO_TO_CODE[bond.stereo], 3)}` +
        // xxx bond topology (query), rrr reacting centre, ccc unused.
        `  0  0  0`,
    );
  }

  lines.push(...propertyLines("CHG", charges));
  lines.push(...propertyLines("ISO", isotopes));
  lines.push(...propertyLines("RAD", radicals));
  lines.push(...propertyLines("RGP", rgroups));
  lines.push(...atomLists);
  lines.push(...aliases);
  lines.push(...superatomLinesV2000(superatoms));
  lines.push("M  END");
  return lines;
}

/** The one refusal both writers make about a coordinate, so the message cannot
 *  drift between them. */
function coordinateError(atomId: AtomId, x: number, y: number, scale: number): Error {
  return new Error(
    `Atom ${atomId} sits at (${x}, ${y}), which at a coordinate scale of ` +
      `${scale} does not fit the ${COORD_WIDTH}-column fixed-width coordinate ` +
      `field. Writing it anyway would shift every later column on the line and ` +
      `produce a file no reader can parse. Move the structure back towards the ` +
      `origin, or lower \`coordinateScale\`.`,
  );
}

/**
 * Break one V3000 entry into as many physical lines as the 80-character limit
 * needs.
 *
 * `content` is the entry WITHOUT its `M  V30 ` prefix. Every line gets the
 * prefix; every line but the last gets a trailing dash. The reader rejoins by
 * dropping the dash and the next line's prefix, so a break may fall anywhere —
 * verified against RDKit, which reads a COLLECTION entry split mid-list, split
 * mid-number and split immediately after `ATOMS=(`.
 *
 * A WRITER THAT NEVER CONTINUES emits a file no reader can parse, and a reader
 * that never joins loses the tail of a group SILENTLY: the group comes back
 * smaller and the molecule still looks fine. A COLLECTION block listing many
 * atoms will exceed 80 characters at around a dozen of them, so this is not a
 * theoretical path.
 *
 * Breaking is done on the CONTENT, never on the assembled line, so the prefix is
 * never itself split.
 */
function v30Lines(content: string): string[] {
  if (V30.length + content.length <= MAX_V30_CONTENT) return [`${V30}${content}`];

  const lines: string[] = [];
  let rest = content;
  // One character of the break budget goes to the dash itself.
  const chunk = V30_BREAK - V30.length - 1;
  while (V30.length + rest.length > MAX_V30_CONTENT) {
    lines.push(`${V30}${rest.slice(0, chunk)}-`);
    rest = rest.slice(chunk);
  }
  lines.push(`${V30}${rest}`);
  return lines;
}

/**
 * The V3000 body: a V2000-shaped counts line carrying the version stamp and
 * nothing else, then the tag-based CTAB.
 *
 * The all-zero counts line is not a placeholder this writer invented — RDKit
 * emits exactly `  0  0  0  0  0  0  0  0  0  0999 V3000` and puts the real
 * numbers in `M  V30 COUNTS`. A V2000-only reader that trusted the leading
 * counts would read an empty molecule rather than a corrupt one, which is the
 * kinder of the two failures.
 *
 * DETERMINISM. Nothing here consults a clock, a random source or object-key
 * order: the atom and bond blocks follow `atomIds` / `bondIds`, the groups come
 * out in `stereoGroupsOf`'s canonical order (kind, then stored index) and the
 * atom indices inside a group come out SORTED BY ROW, not in whatever order
 * built the group.
 */
function writeV3000(
  mol: Molecule,
  hSource: Molecule,
  rowOf: ReadonlyMap<AtomId, number>,
  chiral: number,
  scale: number,
  assertion: HydrogenAssertion,
  groups: readonly StereoGroup[],
  superatoms: readonly SuperatomRow[],
): string[] {
  const lines: string[] = [
    `  0  0  0  0  0  0  0  0  0  0999 V3000`,
    `${V30}BEGIN CTAB`,
    // na nb nsg n3d chiral: the S-groups are the contracted abbreviations
    // (decision 225); no 3D constraints are ever written.
    `${V30}COUNTS ${mol.atomIds.length} ${mol.bondIds.length} ${superatoms.length} 0 ${chiral}`,
    `${V30}BEGIN ATOM`,
  ];

  for (const atomId of mol.atomIds) {
    const atom = requireAtom(mol, atomId);
    const row = rowOf.get(atomId) ?? 0;

    // Same coordinates, same absence of a y-flip, and the same ten-column
    // budget: V3000 fields are free-form, but a number that needs more than ten
    // characters is a structure nobody can draw and the V2000 path would refuse.
    const x = coord(atom.pos.x * scale);
    const y = coord(atom.pos.y * scale);
    if (x === undefined || y === undefined) {
      throw coordinateError(atomId, atom.pos.x, atom.pos.y, scale);
    }

    // index type x y z aamap, then keywords. `aamap` is a reaction atom-atom
    // mapping and is 0 for a plain structure.
    // `v3000Unwritable` has already refused a query with no V3000 spelling.
    const queryType = atom.query === undefined ? undefined : v3000QueryType(atom.query);
    let content = `${row} ${queryType?.type ?? atom.element} ${x.trim()} ${y.trim()} ${ZERO_COORD.trim()} 0`;
    if (queryType?.keyword !== undefined) content += ` ${queryType.keyword}`;

    const charge = Math.trunc(atom.charge);
    // `CHG=` is the ABSOLUTE charge, so there is no legacy column to supersede
    // and no `M  CHG` line to write.
    //
    // NOT CLAMPED to the spec's stated range (the CTfile atom-block table gives
    // `CHG  Atom charge  Integer  0 = none (default)  -15 to +15`), and that is
    // a decision rather than an oversight. The V2000 `M  CHG` path has always
    // written whatever the model holds, so clamping only here would make the two
    // generations disagree about the same molecule; nothing is lost either way —
    // RDKit reads `CHG=20` back as `[S+20]` and chem-core rereads 20 — and a
    // charge that far out is a modelling mistake upstream, which a silent clamp
    // would hide instead of surface. If a charge bound is ever wanted it belongs
    // in the model, once, not in each writer.
    if (charge !== 0) content += ` CHG=${charge}`;

    const radicalElectrons = Math.trunc(atom.radicalElectrons);
    // `RAD=` is a spin MULTIPLICITY, not a count — 1 singlet, 2 doublet,
    // 3 triplet — the same encoding as V2000's `M  RAD`, so `radicalCode` is
    // shared rather than re-derived.
    if (radicalElectrons > 0) content += ` RAD=${radicalCode(radicalElectrons)}`;

    const isotope = atom.isotope === undefined ? 0 : Math.trunc(atom.isotope);
    // `MASS=` is the ABSOLUTE mass number, unlike V2000's `dd` column, which is
    // a difference from the element's most abundant isotope. Confirmed against
    // the spec ("the absolute atomic weight of the designated atom") and against
    // RDKit, which writes `MASS=13` for 13-C. A reader that took this as a
    // difference would import 13-C as mass number 25.
    if (isotope > 0) content += ` MASS=${isotope}`;

    const facts = atomFacts(hSource, atomId, atom.explicitHydrogenCount !== undefined, assertion);
    if (facts.totalValence !== undefined) {
      checkValence(atomId, facts.hydrogens, facts.totalValence);
      // `VAL=-1` is V3000's "valence zero"; `VAL=0` would mean "unspecified".
      // NOT 15, which is V2000's sentinel and would be read here as a valence
      // of fifteen. `HCOUNT` is not used at all: the spec's own atom table
      // calls it "Query hydrogen count", which is the `hhh` trap over again.
      content += ` VAL=${facts.totalValence === 0 ? V3000_VALENCE_ZERO : facts.totalValence}`;
    }

    // The atom block also has a `CFG=` keyword, and it is a stereo PARITY
    // (1 odd, 2 even, 3 either) — a different field from the bond block's
    // `CFG=` (1 up, 2 either, 3 down) despite the shared name. It is never
    // written: parity is derived from the bond wedges, exactly as the V2000
    // `sss` column is left at 0.
    lines.push(...v30Lines(content));
  }
  lines.push(`${V30}END ATOM`);

  if (mol.bondIds.length > 0) {
    lines.push(`${V30}BEGIN BOND`);
    mol.bondIds.forEach((bondId, index) => {
      const bond = requireBond(mol, bondId);
      const from = rowOf.get(bond.from);
      const to = rowOf.get(bond.to);
      if (from === undefined || to === undefined) {
        throw new Error(`Bond ${bondId} references an atom that is not in the molecule`);
      }
      // Type 9 is "coordination" (decision 226), and RDKit reads it as DATIVE
      // with the first atom the donor — which is why `from` is the donor.
      const type = bond.dative ? V3000_DATIVE_BOND_TYPE : bondType(bond);
      // index type atom1 atom2. `from` FIRST, for the same reason as V2000: the
      // narrow end of a wedge is at the first atom, so swapping the endpoints
      // would invert every stereocentre in the file.
      let content = `${index + 1} ${type} ${from} ${to}`;
      const cfg = STEREO_TO_CFG[bond.stereo];
      if (cfg !== 0) content += ` CFG=${cfg}`;
      lines.push(...v30Lines(content));
    });
    lines.push(`${V30}END BOND`);
  }

  if (groups.length > 0) {
    lines.push(`${V30}BEGIN COLLECTION`);
    for (const group of groups) {
      // STEABS is unnumbered; STERAC and STEREL take the group's STORED index
      // (decision 92), never its position in the array — the `&1` a figure tag
      // prints and the `n` a file states are the same number, and deriving it
      // from a position would renumber a group on any unrelated edit.
      const name =
        group.kind === "abs"
          ? COLLECTION_NAME.abs
          : `${COLLECTION_NAME[group.kind]}${group.index}`;
      // Sorted by ROW, so the list reads in the same order as the atom block and
      // two writes of one molecule agree. An id ordering would disagree with the
      // row ordering the moment the ids were not minted in drawing order, which
      // is every imported file.
      const rows = group.atomIds
        .map((id) => rowOf.get(id))
        .filter((row): row is number => row !== undefined)
        .sort((a, b) => a - b);
      // A group whose every atom left the molecule writes nothing rather than
      // `ATOMS=(0)`, which a reader would take as an empty collection.
      if (rows.length === 0) continue;
      lines.push(...v30Lines(`${name} ATOMS=(${rows.length} ${rows.join(" ")})`));
    }
    lines.push(`${V30}END COLLECTION`);
  }

  if (superatoms.length > 0) {
    lines.push(`${V30}BEGIN SGROUP`);
    superatoms.forEach((sup, index) => {
      // index type extindex, then keywords. The external index is 0, as
      // RDKit writes it; nothing refers to a superatom from outside.
      let content = `${index + 1} SUP 0 ATOMS=(${sup.atomRows.length} ${sup.atomRows.join(" ")})`;
      if (sup.bondRow !== undefined) content += ` XBONDS=(1 ${sup.bondRow})`;
      content += ` LABEL=${v30String(sup.label)}`;
      if (sup.hostRow !== undefined && sup.outsideRow !== undefined) {
        content += ` SAP=(3 ${sup.hostRow} ${sup.outsideRow} 1)`;
      }
      lines.push(...v30Lines(content));
    });
    lines.push(`${V30}END SGROUP`);
  }

  lines.push(`${V30}END CTAB`);
  lines.push("M  END");
  return lines;
}

/** One contracted abbreviation in file terms: rows, not ids. */
interface SuperatomRow {
  readonly label: string;
  /** Ascending. */
  readonly atomRows: readonly number[];
  readonly bondRow?: number;
  readonly hostRow?: number;
  readonly outsideRow?: number;
}

/**
 * Unicode subscript digits as ASCII. A molfile is ASCII, and "CO₂Me" is
 * what the stamp table spells; every other program writes "CO2Me". The
 * reader sets digits after a letter back as subscripts.
 */
function asciiLabel(label: string): string {
  return label.replace(/[\u2080-\u2089]/g, (d) => String(d.charCodeAt(0) - 0x2080));
}

/** The contracted abbreviations as rows, in `contractedAbbreviations` order. */
function superatomRows(mol: Molecule, rowOf: ReadonlyMap<AtomId, number>): SuperatomRow[] {
  const bondRowOf = new Map<string, number>();
  mol.bondIds.forEach((id, index) => bondRowOf.set(id, index + 1));
  return contractedAbbreviations(mol).map((c: ContractedAbbreviation) => {
    const atomRows = c.abbreviation.atomIds
      .map((id) => rowOf.get(id) ?? 0)
      .sort((a, b) => a - b);
    const row: {
      label: string;
      atomRows: number[];
      bondRow?: number;
      hostRow?: number;
      outsideRow?: number;
    } = { label: asciiLabel(c.abbreviation.label), atomRows };
    if (c.bondId !== undefined && c.outsideAtomId !== undefined) {
      row.bondRow = bondRowOf.get(c.bondId) ?? 0;
      row.hostRow = rowOf.get(c.hostAtomId) ?? 0;
      row.outsideRow = rowOf.get(c.outsideAtomId) ?? 0;
    }
    return row;
  });
}

/** Most entries a V2000 `M  SAL`/`M  SBL` line holds. */
const SGROUP_LIST_PER_LINE = 15;
/** Most entries a V2000 `M  STY` line holds. */
const SGROUP_TYPES_PER_LINE = 8;

/**
 * The V2000 superatom property lines, in the order and widths RDKit 2025.03
 * writes them (measured): `STY`, then per group `SAL`, `SBL`, `SMT`, `SAP`.
 * No `M  SDS EXP`: every group written is contracted.
 */
function superatomLinesV2000(superatoms: readonly SuperatomRow[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < superatoms.length; i += SGROUP_TYPES_PER_LINE) {
    const chunk = superatoms.slice(i, i + SGROUP_TYPES_PER_LINE);
    lines.push(`M  STY${int(chunk.length, 3)}${chunk.map((_, j) => `${int(i + j + 1, 4)} SUP`).join("")}`);
  }
  superatoms.forEach((sup, index) => {
    const n = index + 1;
    for (let i = 0; i < sup.atomRows.length; i += SGROUP_LIST_PER_LINE) {
      const chunk = sup.atomRows.slice(i, i + SGROUP_LIST_PER_LINE);
      lines.push(`M  SAL${int(n, 4)}${int(chunk.length, 3)}${chunk.map((row) => int(row, 4)).join("")}`);
    }
    if (sup.bondRow !== undefined) lines.push(`M  SBL${int(n, 4)}${int(1, 3)}${int(sup.bondRow, 4)}`);
    lines.push(`M  SMT${int(n, 4)} ${sup.label.replace(/[\r\n]+/g, " ")}`);
    if (sup.hostRow !== undefined && sup.outsideRow !== undefined) {
      lines.push(`M  SAP${int(n, 4)}${int(1, 3)}${int(sup.hostRow, 4)}${int(sup.outsideRow, 4)}  1`);
    }
  });
  return lines;
}

/** A V3000 keyword value: bare when it has no space or quote, else quoted
 *  with embedded quotes doubled, as the spec says. */
function v30String(text: string): string {
  const flat = text.replace(/[\r\n]+/g, " ");
  return /[\s"]/.test(flat) || flat === "" ? `"${flat.replace(/"/g, '""')}"` : flat;
}

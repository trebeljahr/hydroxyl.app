/**
 * V2000 molfile (molblock) writer.
 *
 * The molblock is the lingua franca of chemical drawing: RDKit, Open Babel,
 * ChemDraw, PubChem and every SDF on earth read it. It is a fixed-column
 * format from 1980, so almost every rule below is a column count rather than
 * a design decision, and the comments say which is which.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: multi-record SDF (`$$$$` and the tagged
 * data block), V3000, and query features. Those belong in their own modules.
 *
 * `doubleBondSide` is dropped, and comes back from the reader as `auto`. V2000
 * has no field for it and never will: it is a rendering hint saying which side
 * of the bond axis a double bond's second line sits on, so unlike `label` —
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

import { hasAromaticFlags, kekulize } from "./aromatic.js";
import { requireAtom, requireBond } from "./molecule.js";
import type { AtomId, BondStereo, Molecule } from "./types.js";
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

export interface MolblockWriteOptions {
  /** Line 1 of the header. Newlines are stripped; clipped to 80 characters. */
  readonly title?: string | undefined;
  /** Line 3 of the header. Same treatment as the title. */
  readonly comment?: string | undefined;
  /** Overrides `MOLFILE_BOND_LENGTH`. Model coordinates are multiplied by it. */
  readonly coordinateScale?: number | undefined;
  /** See `HydrogenAssertion`. Defaults to `"valence"`. */
  readonly hydrogenAssertion?: HydrogenAssertion | undefined;
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
 * Serialise `mol` as a V2000 molblock.
 *
 * @throws {MolblockLabelError} if any atom carries a display `label`.
 * @throws {Error} if the structure is too large for the three-column counts
 *   fields, if a coordinate does not fit its ten-column field, or if an atom's
 *   hydrogen count fits neither `hhh` nor `vvv`. All three are cases where the
 *   only alternative is a file that describes a different molecule.
 */
export function writeMolblock(mol: Molecule, options: MolblockWriteOptions = {}): string {
  const scale = options.coordinateScale ?? MOLFILE_BOND_LENGTH;
  const assertion = options.hydrogenAssertion ?? "valence";

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
        `screen. Expand the abbreviation into atoms or clear the label first.`,
      labelled,
    );
  }

  if (mol.atomIds.length > MAX_V2000_COUNT || mol.bondIds.length > MAX_V2000_COUNT) {
    throw new Error(
      `V2000 counts fields are three characters wide, so it cannot express ` +
        `${mol.atomIds.length} atoms / ${mol.bondIds.length} bonds. Use V3000 ` +
        `for structures this large.`,
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

  const charges: [number, number][] = [];
  const isotopes: [number, number][] = [];
  const radicals: [number, number][] = [];

  const lines: string[] = [];
  lines.push(headerLine(options.title));
  lines.push(PROGRAM_LINE);
  lines.push(headerLine(options.comment));

  // The chiral flag says "the drawn stereochemistry is absolute, not a
  // racemate". Wedges and hashes are the only way this model states
  // configuration, so their presence is exactly the condition.
  const chiral = mol.bondIds.some((id) => {
    const stereo = requireBond(mol, id).stereo;
    return stereo === "wedge" || stereo === "hash";
  })
    ? 1
    : 0;

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
      throw new Error(
        `Atom ${atomId} sits at (${atom.pos.x}, ${atom.pos.y}), which at a ` +
          `coordinate scale of ${scale} does not fit the ${COORD_WIDTH}-column ` +
          `fixed-width coordinate field. Writing it anyway would shift every ` +
          `later column on the line and produce a file no reader can parse. ` +
          `Move the structure back towards the origin, or lower ` +
          `\`coordinateScale\`.`,
      );
    }

    // Hydrogens are implicit in the model, so the count has to be asserted
    // here or a reader will re-derive it with its own valence table and
    // disagree (pyrrole's N-H is the classic casualty). `hhh` is "count plus
    // one" because 0 is reserved for "not specified".
    const hydrogens = Math.max(implicitHydrogenCount(hSource, atomId), 0);
    let hydrogenField = 0;
    let valenceField = 0;
    // In "valence" mode an unpinned atom is left unstated, so the reader
    // derives with its own table. Only a PIN is worth a field: it is the
    // model saying "do not derive", and it is the one thing a valence table
    // cannot recover.
    const stateIt = assertion === "hhh" || atom.explicitHydrogenCount !== undefined;
    if (!stateIt) {
      // nothing to say
    } else if (assertion !== "hhh") {
      // `vvv` is the total valence, not a query field, and the reader already
      // subtracts the drawn bonds back off it. 15 is the spec's "valence
      // zero", since 0 already means "unspecified".
      const total = Math.round(bondOrderSum(hSource, atomId) + hydrogens);
      if (total > MAX_ENCODABLE_VALENCE) {
        throw new Error(
          `Atom ${atomId} carries ${hydrogens} hydrogens, and its total ` +
            `valence of ${total} exceeds the ${MAX_ENCODABLE_VALENCE} the ` +
            `V2000 valence field can express. Reduce the hydrogen count or ` +
            `use V3000.`,
        );
      }
      valenceField = total === 0 ? VALENCE_ZERO_CODE : total;
    } else if (hydrogens <= MAX_ENCODABLE_HYDROGENS) {
      hydrogenField = hydrogens + 1;
    } else {
      // Past H4 the `hhh` field is out of room, so the count goes out as a
      // total valence instead and the reader subtracts the drawn bonds back
      // off it — which it already does, because that is what RDKit writes.
      // Only reachable through an extreme formal charge or a deliberate pin,
      // but clamping to H4 quietly deleted hydrogens from the exported
      // molecule, and this module's whole position (see `MolblockLabelError`)
      // is that a plausible wrong file is worse than a refusal.
      // Rounded because an aromatic bond that kekulisation could not resolve
      // still weighs 1.5, and a fractional valence is not a legal field.
      const total = Math.round(bondOrderSum(hSource, atomId) + hydrogens);
      if (total > MAX_ENCODABLE_VALENCE) {
        throw new Error(
          `Atom ${atomId} carries ${hydrogens} hydrogens, and its total ` +
            `valence of ${total} exceeds the ${MAX_ENCODABLE_VALENCE} the ` +
            `V2000 valence field can express. Reduce the hydrogen count or ` +
            `use V3000.`,
        );
      }
      valenceField = total;
    }

    lines.push(
      `${x}${y}${ZERO_COORD} ` +
        // Symbol left-justified in three columns, unlike every numeric field.
        `${atom.element.slice(0, 3).padEnd(3, " ")}` +
        // dd, the RELATIVE mass difference. Always 0: isotopes go out as
        // `M  ISO`, which carries the absolute mass number and needs no
        // agreement about which isotope counts as the reference.
        ` 0` +
        // ccc, the legacy charge column. Always 0: it cannot express a charge
        // beyond +-3, and the spec says an `M  CHG` line supersedes it
        // wholesale anyway.
        `  0` +
        // sss atom stereo parity: derived from the bond wedges by the reader,
        // never stored here.
        `  0` +
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
    // Type 4 is "aromatic". Emitted only for a bond the model has actually
    // flagged; a Kekule structure stays Kekule, which is what most journals
    // print and what every reader agrees about.
    const type = bond.aromatic ? 4 : bond.order;
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
  lines.push("M  END");

  return `${lines.join("\n")}\n`;
}

/**
 * What is this text? Decided from the CONTENT, never from the extension.
 *
 * Extensions lie constantly in chemistry. PubChem serves an SDF as `.txt`, a
 * ChemDraw export lands as `.mol` with a `$$$$` at the end, a chemist saves a
 * SMILES into `structure.mol` because that is the folder they were in, and a
 * drag from a web page has no filename at all. Sniffing is therefore the
 * primary route and the extension is not consulted at any point in this file.
 *
 * ── THE ORDER OF THE TESTS IS THE DESIGN ───────────────────────────────────
 *
 * 1. JSON first, and only when it PARSES. A native document starts `{`, and
 *    an object that fails to parse is not a document however much it looks
 *    like one.
 * 2. SDF before molblock, because every SDF record IS a molblock: a `$$$$`
 *    line is the only thing that distinguishes a multi-record file, and
 *    decision 7 makes that difference N documents rather than one.
 * 3. Molblock by a counts line AND `M  END`, not by either alone. chem-core's
 *    own `parseCounts` accepts a bare `999`, so the counts probe on its own
 *    would claim any line of digits; `M  END` on its own would claim a plain
 *    text file that happened to contain it.
 * 4. InChI by its prefix, which the format mandates.
 * 5. SMILES LAST, as the residue, because it has no syntax that identifies it
 *    — `C` is a valid SMILES and so is most of a chemist's shorthand.
 *
 * ── SQUARE BRACKETS ARE ORDINARY SMILES ────────────────────────────────────
 *
 * The rule for the SMILES residue is often stated as "short and
 * bracket-free", and taken literally that rejects `[O-]`, `[N+]`, `[nH]`,
 * `[13CH4]` and every charged or isotopically-labelled structure — most of
 * what anyone actually pastes. The characters that genuinely disqualify a
 * string are the ones that belong to the OTHER formats: `{}` (JSON) and `<>`
 * (XML, SVG, CML). Square brackets stay allowed.
 *
 * Pure: no I/O, no DOM, no chem-core. Everything here is a decision about a
 * string, which is what makes the whole table unit-testable.
 */

export type SniffedFormat =
  | { readonly kind: "json" }
  | { readonly kind: "molblock" }
  /** `records` is how many `$$$$`-terminated records were found, which is how
   *  many documents decision 7 says the drop produces. */
  | { readonly kind: "sdf"; readonly records: number }
  | { readonly kind: "inchi" }
  | { readonly kind: "smiles" }
  | { readonly kind: "unknown" };

/** Anything longer than this is not a SMILES someone pasted; it is a file. */
export const MAX_SMILES_LENGTH = 4096;

/** How far in the record may start. Mirrors chem-core's `MAX_LEADING_BLANKS`
 *  reading: text pasted out of a web form arrives with blank lines on top. */
const MAX_LEADING_BLANKS = 3;

const SDF_DELIMITER = "$$$$";

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/**
 * Is this a V2000/V3000 counts line?
 *
 * A local reimplementation, because chem-core does not export `parseCounts`
 * — and should not: it is a parser detail. Two three-wide integers in the
 * first six columns is the whole of the recognisable part.
 */
function looksLikeCountsLine(line: string): boolean {
  if (line.trim() === "") return false;
  const atoms = line.slice(0, 3).trim();
  const bonds = line.slice(3, 6).trim();
  if (atoms === "") return false;
  if (!/^\d{1,3}$/.test(atoms)) return false;
  // A counts line with an omitted bond count is legal; a non-numeric one is
  // not.
  if (bonds !== "" && !/^\d{1,3}$/.test(bonds)) return false;
  return true;
}

/** Mirrors chem-core's `findRecordStart`: the counts line is the fourth line
 *  of the record, so the record starts three lines above whichever candidate
 *  parses. */
function hasMolblockHeader(lines: readonly string[]): boolean {
  const limit = Math.min(lines.length, MAX_LEADING_BLANKS + 1);
  for (let offset = 0; offset < limit; offset++) {
    if (offset > 0 && (lines[offset - 1] ?? "").trim() !== "") break;
    const counts = lines[offset + 3];
    if (counts !== undefined && looksLikeCountsLine(counts)) return true;
  }
  return false;
}

function hasEndTag(lines: readonly string[]): boolean {
  return lines.some((line) => line.trimEnd() === "M  END");
}

export function countSdfRecords(text: string): number {
  return splitLines(text).filter((line) => line.trim() === SDF_DELIMITER).length;
}

/**
 * Split an SDF into its records, `$$$$` lines removed.
 *
 * chem-core's reader deliberately stops at the first `$$$$` — its header says
 * so — so multi-record iteration is the client's job and this is where it
 * happens. A trailing fragment after the last delimiter that contains no
 * structure is dropped; some writers end with a newline and some do not.
 */
export function splitSdfRecords(text: string): string[] {
  const records: string[] = [];
  let current: string[] = [];
  for (const line of splitLines(text)) {
    if (line.trim() === SDF_DELIMITER) {
      records.push(current.join("\n"));
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.some((line) => line.trim() !== "")) records.push(current.join("\n"));
  return records.filter((record) => record.trim() !== "");
}

export function sniffFormat(text: string): SniffedFormat {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "unknown" };

  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null) return { kind: "json" };
    } catch {
      // Not JSON after all. Fall through — a molblock never starts with `{`,
      // but saying so here would be a guess where the tests below are facts.
    }
  }

  const lines = splitLines(text);

  const records = countSdfRecords(text);
  if (records > 0) return { kind: "sdf", records: splitSdfRecords(text).length };

  if (hasMolblockHeader(lines) && hasEndTag(lines)) return { kind: "molblock" };

  if (trimmed.startsWith("InChI=")) return { kind: "inchi" };

  // The residue. One line, no JSON or markup punctuation, short enough to be
  // something a person pasted rather than something a program wrote.
  if (
    trimmed.length <= MAX_SMILES_LENGTH &&
    !/[\s{}<>]/.test(trimmed) &&
    /^[A-Za-z0-9@+\-[\]()\\/=#$%.*:~]+$/.test(trimmed)
  ) {
    return { kind: "smiles" };
  }

  return { kind: "unknown" };
}

/** Whether reading this format needs the RDKit worker — i.e. whether a drop
 *  of it will fetch 6.9 MB of wasm. JSON, MOL and SDF are all native. */
export function needsRdkit(format: SniffedFormat): boolean {
  return format.kind === "smiles" || format.kind === "inchi";
}

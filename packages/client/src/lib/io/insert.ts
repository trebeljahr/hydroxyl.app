/**
 * Text -> a structure to ADD to the open sketch. The insert box's reading.
 *
 * ── NOT THE IMPORT PATH, ON PURPOSE ────────────────────────────────────────
 *
 * `open.ts` answers "here is a file": decision 7 makes a dropped or opened
 * structure a NEW document, so a mis-drop never lands on unsaved work. The
 * insert box answers a different question — "put caffeine next to what I am
 * drawing" — and so adds a fragment to the current molecule instead. The two
 * share their readers (`sniffFormat`, chem-core's molfile codec through
 * `translate.ts`, and the RDKit bridge for SMILES) and nothing else.
 *
 * ── FOUR KINDS OF TEXT, AND WHICH WINS ─────────────────────────────────────
 *
 * 1. A molfile (or a one-record SDF) is recognised by its structure and read
 *    by chem-core. Nothing else is offered for it.
 * 2. A name that is EXACTLY a dictionary name or synonym ("glucose", "DMSO",
 *    "Ala") comes first.
 * 3. A sum formula comes next, but only as a filter over the dictionary: every
 *    listed compound with that composition is offered, and a formula that
 *    matches none is refused with the reason. A formula alone names no
 *    structure — C6H12O6 is seven entries in this list and hundreds outside it.
 * 4. A SMILES comes after those, when the text is SMILES-shaped (see
 *    `looksLikeSmiles`), and is read by RDKit only when chosen.
 *
 * Partial names ("gluc") are offered as SUGGESTIONS after all of that, and only
 * for text that is not SMILES-shaped: "CO" is methanol, and listing every name
 * that contains the letters c-o ("alcohol", "glucose", "cocaine") beneath it
 * would bury the one reading that was meant.
 *
 * ── NOTHING LEAVES THE BROWSER ─────────────────────────────────────────────
 *
 * A name outside the list is refused with a sentence saying so. Resolving
 * arbitrary names needs a server (OPSIN) or a third party (PubChem); that was
 * put to the product owner and deferred, and this file is where it would plug
 * in.
 *
 * `interpretInsertText` is synchronous and pure, so the box can re-run it on
 * every keystroke. `resolveInsertCandidate` does the reading, and is the only
 * async part.
 */

import { normalizeBondLength, type Molecule } from "@starter/chem-core";
import type * as Dictionary from "@starter/chem-core/dictionary";
import type { DictionaryEntry } from "@starter/chem-core/dictionary";

import { molblockToMolecule } from "@/lib/rdkit/translate";

import { INCHI_UNSUPPORTED, type LoadRdkit } from "./open";
import { sniffFormat, splitSdfRecords } from "./sniff";

/** The dictionary module, passed in rather than imported: the app loads it on
 *  demand (it is ~80 kB of molblocks), and a test hands in the real one. */
export type DictionaryModule = typeof Dictionary;

export const loadDictionary = (): Promise<DictionaryModule> =>
  import("@starter/chem-core/dictionary");

export type InsertCandidate =
  | {
      readonly kind: "entry";
      readonly entry: DictionaryEntry;
      /** Why it is offered: the text IS its name, the text is its formula, or
       *  the text is part of its name. */
      readonly via: "name" | "formula" | "suggestion";
    }
  | { readonly kind: "molblock" }
  | { readonly kind: "smiles" };

export interface InsertInterpretation {
  /** Best first. The box highlights the first and Enter takes it. */
  readonly candidates: readonly InsertCandidate[];
  /** A sentence about how the text was read, shown under the box, or null. */
  readonly notice: string | null;
  /** Why nothing can be inserted, or null. Set only when `candidates` is empty. */
  readonly refusal: string | null;
}

const EMPTY: InsertInterpretation = Object.freeze({
  candidates: Object.freeze([]),
  notice: null,
  refusal: null,
});

/**
 * Could this be a SMILES, judged by its alphabet alone?
 *
 * Outside square brackets, SMILES spells atoms only with the organic subset —
 * B C N O P S F Cl Br I, their aromatic lower case b c n o p s, and `*` — so
 * any other letter there rules it out. "glucose" has a g, a u and an e;
 * "Ph", "DMSO" and "NEt3" have an h, a D and a t; "C2H6O" has an unbracketed H.
 * Inside brackets anything goes, which is what keeps `[Na+].[Cl-]`, `[nH]` and
 * `[13CH4]` in. This is a shape test, not a parse: `C1CC` passes and RDKit
 * then refuses the unclosed ring with its own message.
 */
export function looksLikeSmiles(text: string): boolean {
  if (sniffFormat(text).kind !== "smiles") return false;
  const unbracketed = text.trim().replace(/\[[^\]]*\]/g, "");
  if (unbracketed.includes("[") || unbracketed.includes("]")) return false;
  const letters = unbracketed.replace(/[^A-Za-z]/g, "");
  return /^(?:Cl|Br|[BCNOPSFIbcnops])*$/.test(letters);
}

function sameEntry(a: InsertCandidate, b: DictionaryEntry): boolean {
  return a.kind === "entry" && a.entry.id === b.id;
}

/** "C6H12O6" as the user typed it but with the counts subscripted, for a
 *  sentence. */
function prettyFormula(text: string): string {
  const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";
  return text.trim().replace(/\d/g, (d) => SUBSCRIPTS[Number(d)] ?? d);
}

export function interpretInsertText(
  text: string,
  dictionary: DictionaryModule,
): InsertInterpretation {
  const trimmed = text.trim();
  if (trimmed === "") return EMPTY;

  const format = sniffFormat(trimmed);
  switch (format.kind) {
    case "json":
      return {
        candidates: [],
        notice: null,
        refusal:
          "That is a saved sketch, not a structure. Open it with “Open a file…”; " +
          "this box adds one structure to the sketch you are drawing.",
      };
    case "inchi":
      return { candidates: [], notice: null, refusal: INCHI_UNSUPPORTED };
    case "sdf":
      if (format.records > 1) {
        return {
          candidates: [],
          notice: null,
          refusal:
            `That SDF holds ${String(format.records)} structures. Open it with “Open a file…” ` +
            "to get one sketch per structure; this box inserts one.",
        };
      }
      return { candidates: [{ kind: "molblock" }], notice: null, refusal: null };
    case "molblock":
      return { candidates: [{ kind: "molblock" }], notice: null, refusal: null };
    case "smiles":
    case "unknown":
      break;
  }

  const candidates: InsertCandidate[] = [];
  const add = (entry: DictionaryEntry, via: "name" | "formula" | "suggestion"): void => {
    if (candidates.some((c) => sameEntry(c, entry))) return;
    candidates.push({ kind: "entry", entry, via });
  };

  const named = dictionary.findDictionaryEntryByName(trimmed);
  if (named !== undefined) add(named, "name");

  let notice: string | null = null;
  const counts = dictionary.parseSumFormula(trimmed);
  if (counts !== undefined) {
    const matches = dictionary.dictionaryEntriesWithFormula(counts);
    for (const entry of matches) add(entry, "formula");
    const formula = prettyFormula(trimmed);
    notice =
      matches.length === 0
        ? `No compound in the built-in list has the formula ${formula}. A formula alone does ` +
          "not name one structure, so it is only accepted when it matches a listed compound."
        : matches.length === 1
          ? `${formula} is read as a formula: it matches one compound in the built-in list. ` +
            "A formula alone does not name one structure, so only listed compounds are offered."
          : `${formula} matches ${String(matches.length)} compounds in the built-in list — ` +
            "pick one. A formula alone does not name one structure.";
  }

  const smiles = looksLikeSmiles(trimmed);
  if (smiles) candidates.push({ kind: "smiles" });
  else for (const match of dictionary.searchDictionary(trimmed)) add(match.entry, "suggestion");

  if (candidates.length > 0) return { candidates, notice, refusal: null };
  return {
    candidates,
    notice,
    refusal:
      notice !== null
        ? null
        : `“${trimmed}” is not a name in the built-in list of ` +
          `${String(dictionary.STRUCTURE_DICTIONARY.length)} compounds, a SMILES or a molfile. ` +
          "Names outside the list cannot be looked up here; paste a SMILES or a molfile instead.",
  };
}

// ---------------------------------------------------------------------------
// Reading the chosen candidate
// ---------------------------------------------------------------------------

export interface ResolvedInsert {
  /** At the standard bond length; the caller rescales it to the drawing's. */
  readonly molecule: Molecule;
  /** What the undo entry and the status line call it. */
  readonly title: string;
}

export type InsertResult =
  | { readonly ok: true; readonly value: ResolvedInsert }
  | { readonly ok: false; readonly message: string };

export interface ResolveOptions {
  /** Defaults to the same dynamic import `open.ts` uses. */
  readonly loadRdkit?: LoadRdkit | undefined;
}

const loadRdkitBridge: LoadRdkit = () => import("@/lib/rdkit");

/**
 * Turn the chosen reading into a molecule. Never throws: a SMILES RDKit
 * refuses is an ordinary outcome, reported with RDKit's own sentence.
 */
export async function resolveInsertCandidate(
  text: string,
  candidate: InsertCandidate,
  dictionary: DictionaryModule,
  options: ResolveOptions = {},
): Promise<InsertResult> {
  switch (candidate.kind) {
    case "entry":
      return {
        ok: true,
        value: { molecule: dictionary.dictionaryMolecule(candidate.entry), title: candidate.entry.name },
      };
    case "molblock": {
      // A one-record SDF arrives with its `$$$$` and data items; the reader
      // wants the record.
      const record = splitSdfRecords(text)[0] ?? text;
      const read = molblockToMolecule(record);
      // VERBATIM, for the reason `open.ts` gives: a lossy import names what
      // it would have dropped, and "could not read" throws that away.
      if (!read.ok) return { ok: false, message: read.error.message };
      const title = read.value.title.trim();
      return {
        ok: true,
        value: {
          molecule: normalizeBondLength(read.value.molecule),
          title: title === "" ? "molfile" : title,
        },
      };
    }
    case "smiles": {
      const load = options.loadRdkit ?? loadRdkitBridge;
      let bridge;
      try {
        bridge = await load();
      } catch (error) {
        return {
          ok: false,
          message: `The structure reader could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      const smiles = text.trim();
      const read = await bridge.fromSmiles(smiles);
      if (!read.ok) return { ok: false, message: read.error.message };
      return {
        ok: true,
        value: { molecule: normalizeBondLength(read.value.molecule), title: smiles },
      };
    }
  }
}

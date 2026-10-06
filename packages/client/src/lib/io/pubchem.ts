/**
 * A name or CAS number -> a SMILES, by asking PubChem. The insert box's one
 * network request (decision 227, revising 114).
 *
 * ── ONLY THE TYPED TEXT, ONLY AFTER A CLICK ────────────────────────────────
 *
 * Decision 108 still holds for drawings: nothing drawn leaves the machine.
 * This module is handed the text of the insert box and nothing else — it has
 * no way to reach the document — and it is called only from the "Look up on
 * PubChem" button. Typing never triggers it; neither does Enter in the box,
 * which inserts the highlighted built-in reading as before.
 *
 * ── ONE REQUEST, NAME -> PROPERTIES ────────────────────────────────────────
 *
 * PUG-REST resolves a name (and a CAS number, which PubChem stores as a
 * synonym) to CIDs and returns properties of each in the same call:
 *
 *   GET /rest/pug/compound/name/<text>/property/SMILES,Title/JSON
 *
 * The SMILES is PubChem's full one, stereo and isotopes included (the
 * property PubChem called `IsomericSMILES` until 2025; older responses still
 * carry that key, so both are read). It is then read by the RDKit worker like
 * any typed SMILES, so PubChem's answer goes through the same oracle as every
 * other import. The SDF route was not taken: PubChem's records carry explicit
 * hydrogens as atoms, which would arrive as drawn H atoms the user never drew.
 *
 * A name with several CIDs takes the first, which is PubChem's own best match;
 * the result says how many there were so the choice is not silent.
 *
 * ── ERRORS ARE PUBCHEM'S OWN ───────────────────────────────────────────────
 *
 * PubChem answers a failure with a `Fault` carrying a code and a message
 * ("PUGREST.NotFound", "No CID found"). Not-found is said in plain words with
 * the text that was sent; every other fault is shown with PubChem's message,
 * and a request that never got an answer says so with the browser's reason.
 */

export const PUBCHEM_HOST = "pubchem.ncbi.nlm.nih.gov";
const PUG_REST = `https://${PUBCHEM_HOST}/rest/pug`;

/** Long enough for PubChem on a slow day, short enough that a dead connection
 *  is reported rather than leaving the box on "Looking up…". */
const TIMEOUT_MS = 20_000;

export interface PubChemCompound {
  readonly cid: number;
  readonly smiles: string;
  /** PubChem's record title ("Caffeine"), or the query when it has none. */
  readonly title: string;
  /** How many CIDs the name resolved to; the first was taken. */
  readonly matches: number;
}

export type PubChemResult =
  | { readonly ok: true; readonly value: PubChemCompound }
  | { readonly ok: false; readonly message: string };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface PubChemOptions {
  /** Defaults to the global `fetch`; tests pass a mock. */
  readonly fetch?: FetchLike | undefined;
  readonly timeoutMs?: number | undefined;
}

export function pubChemPropertyUrl(query: string): string {
  return `${PUG_REST}/compound/name/${encodeURIComponent(query.trim())}/property/SMILES,Title/JSON`;
}

/** The page a chemist would open to check the record by hand. */
export function pubChemCompoundPage(cid: number): string {
  return `https://${PUBCHEM_HOST}/compound/${String(cid)}`;
}

interface Fault {
  readonly Code?: unknown;
  readonly Message?: unknown;
  readonly Details?: unknown;
}

function faultOf(body: unknown): Fault | undefined {
  if (typeof body !== "object" || body === null || !("Fault" in body)) return undefined;
  const fault = (body as { Fault: unknown }).Fault;
  return typeof fault === "object" && fault !== null ? (fault as Fault) : undefined;
}

function describeFault(query: string, status: number, fault: Fault | undefined): string {
  const code = typeof fault?.Code === "string" ? fault.Code : undefined;
  if (code === "PUGREST.NotFound" || (code === undefined && status === 404)) {
    return `PubChem has no compound named “${query}”. Check the spelling, or paste a SMILES or a molfile.`;
  }
  const message = typeof fault?.Message === "string" ? fault.Message : undefined;
  const details = Array.isArray(fault?.Details)
    ? fault.Details.filter((d): d is string => typeof d === "string").join(" ")
    : "";
  const said = [message, details].filter((s) => s !== undefined && s !== "").join(" ");
  return said === ""
    ? `PubChem answered with HTTP ${String(status)} and no explanation. Nothing was inserted.`
    : `PubChem refused the lookup (${code ?? `HTTP ${String(status)}`}): ${said}`;
}

function firstSmiles(row: Record<string, unknown>): string | undefined {
  for (const key of ["SMILES", "IsomericSMILES", "CanonicalSMILES"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

/** Never throws: every failure is an ordinary outcome with a sentence. */
export async function lookUpOnPubChem(
  query: string,
  options: PubChemOptions = {},
): Promise<PubChemResult> {
  const text = query.trim();
  if (text === "") return { ok: false, message: "Type a name or a CAS number to look up." };
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));

  let response: Response;
  try {
    response = await doFetch(pubChemPropertyUrl(text), {
      // No cookies, no referrer path: the request carries the typed text and
      // nothing that says which sketch it came from.
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (error) {
    const reason =
      error instanceof DOMException && error.name === "TimeoutError"
        ? "no answer within 20 seconds"
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      ok: false,
      message: `PubChem could not be reached (${reason}). Check the connection and try again; nothing was inserted.`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  if (!response.ok) return { ok: false, message: describeFault(text, response.status, faultOf(body)) };

  const rows: unknown =
    typeof body === "object" && body !== null
      ? (body as { PropertyTable?: { Properties?: unknown } }).PropertyTable?.Properties
      : undefined;
  if (!Array.isArray(rows) || rows.length === 0) {
    const fault = faultOf(body);
    return {
      ok: false,
      message:
        fault === undefined
          ? "PubChem answered, but not with a structure. Nothing was inserted."
          : describeFault(text, response.status, fault),
    };
  }

  const [first] = rows as unknown[];
  const row = (typeof first === "object" && first !== null ? first : {}) as Record<string, unknown>;
  const cid = row["CID"];
  const smiles = firstSmiles(row);
  if (typeof cid !== "number" || smiles === undefined) {
    return { ok: false, message: "PubChem answered, but without a SMILES for that compound. Nothing was inserted." };
  }
  const title = typeof row["Title"] === "string" && row["Title"].trim() !== "" ? row["Title"].trim() : text;
  return { ok: true, value: { cid, smiles, title, matches: rows.length } };
}

/**
 * Is this a CAS Registry Number with a correct check digit?
 *
 * "50-78-2" is aspirin; it is also, by alphabet, a SMILES (no letters at all),
 * so without this test the box would offer to read it as one and RDKit would
 * refuse it. The check digit is the weighted sum of the other digits, right to
 * left with weights 1, 2, 3…, mod 10 — a typo in one digit fails it.
 */
export function isCasNumber(text: string): boolean {
  const match = /^(\d{2,7})-(\d{2})-(\d)$/.exec(text.trim());
  if (match === null) return false;
  const digits = `${match[1] ?? ""}${match[2] ?? ""}`;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    sum += Number(digits[digits.length - 1 - i]) * (i + 1);
  }
  return sum % 10 === Number(match[3]);
}

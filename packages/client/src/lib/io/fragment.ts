/**
 * `/editor#smiles=<encoded>` and `/editor#molfile=<encoded>` — a structure
 * carried in the link itself (decision 230).
 *
 * A FRAGMENT, NOT A QUERY PARAMETER. The browser never sends the part after
 * `#` to the server, so a structure shared this way reaches no access log, and
 * the pageview (decision 170) sends origin + path only. It also works
 * unchanged in the static export, as `editor.html#smiles=…`, where there is no
 * server at all. The MCP server's `editor_link` builds these links.
 *
 * Only the parse lives here. Reading the text into a document is `openTextAs`
 * in `./open`, the same funnel a drop goes through, so a structure opened from
 * a link is scaled and titled exactly as one opened from a file.
 */

/** Longest fragment read, counted BEFORE percent-decoding (decision 230).
 *  A 300-atom molfile is about 45 kB once encoded; far longer URLs start to
 *  be truncated by Safari and by proxies, and a truncated molfile is a
 *  silently different structure. */
export const MAX_FRAGMENT_LENGTH = 100_000;

export type FragmentKind = "smiles" | "molfile";

/** What the fragment asked for. */
export type FragmentRequest =
  | { readonly kind: "none" }
  | { readonly kind: "structure"; readonly format: FragmentKind; readonly text: string }
  | { readonly kind: "refused"; readonly message: string };

const KINDS: readonly FragmentKind[] = ["smiles", "molfile"];

function isFragmentKind(key: string): key is FragmentKind {
  return (KINDS as readonly string[]).includes(key);
}

/**
 * Parse `location.hash`.
 *
 * A hash that is not `key=value` is not a request — `#panel-2` is an anchor,
 * and the editor has no business complaining about one. A `key=value` with a
 * key this page does not know IS refused, because somebody built that link to
 * open a structure and should learn why it did not.
 *
 * DECODED WITH `decodeURIComponent`, NOT `URLSearchParams`. The latter reads a
 * literal `+` as a space, and `+` is a charge in SMILES: `[NH4+]` pasted into
 * a link unencoded would arrive as `[NH4 ]` and fail with an RDKit parse error
 * that says nothing about the URL.
 */
export function structureFromHash(hash: string): FragmentRequest {
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  const equals = body.indexOf("=");
  if (equals <= 0) return { kind: "none" };

  if (body.length > MAX_FRAGMENT_LENGTH) {
    return {
      kind: "refused",
      message:
        `The link carries ${body.length.toLocaleString("en-US")} characters of structure; ` +
        `the editor reads at most ${MAX_FRAGMENT_LENGTH.toLocaleString("en-US")} from a link. ` +
        `Open it as a file instead.`,
    };
  }

  const key = body.slice(0, equals).toLowerCase();
  if (!isFragmentKind(key)) {
    const shown = key.length > 20 ? `${key.slice(0, 19)}…` : key;
    return {
      kind: "refused",
      message: `The link asks for “${shown}”, which the editor cannot open. Use #smiles= or #molfile=.`,
    };
  }

  let text: string;
  try {
    text = decodeURIComponent(body.slice(equals + 1));
  } catch {
    return {
      kind: "refused",
      message: `The ${key === "smiles" ? "SMILES" : "molfile"} in the link is not properly URL-encoded.`,
    };
  }
  if (text.trim() === "") {
    return {
      kind: "refused",
      message: `The link's ${key === "smiles" ? "SMILES" : "molfile"} is empty.`,
    };
  }
  return { kind: "structure", format: key, text };
}

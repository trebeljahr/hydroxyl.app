/**
 * The vendored WOFFs, by face and weight, for embedding into an exported SVG
 * (decision 250). The only module that imports a `generated/*-woff.ts`.
 *
 * All of them are bundled wherever the SVG serialiser is, about 15–20 kB of
 * base64 each. A lazy import would make `serializeFigure` asynchronous, and
 * the figure serialiser must stay a pure synchronous function of its figure.
 */

import * as ARIMO_400 from "./generated/arimo-400-woff.js";
import * as ARIMO_700 from "./generated/arimo-700-woff.js";
import * as TINOS_400 from "./generated/tinos-400-woff.js";
import * as TINOS_700 from "./generated/tinos-700-woff.js";
import type { FontFace, FontWeight } from "./metrics.js";

interface GeneratedWoff {
  readonly WOFF_BASE64: string;
  readonly GREEK_WOFF_BASE64: string;
  readonly GREEK_UNICODE_RANGE: string;
}

const WOFF: Readonly<Record<FontFace, Readonly<Record<FontWeight, GeneratedWoff>>>> = Object.freeze({
  arimo: Object.freeze({ normal: ARIMO_400, bold: ARIMO_700 }),
  tinos: Object.freeze({ normal: TINOS_400, bold: TINOS_700 }),
});

/** The Latin WOFF of `face` at `weight`, base64, as a `data:` URI carries it. */
export function woffBase64(face: FontFace, weight: FontWeight): string {
  return WOFF[face][weight].WOFF_BASE64;
}

/** The Greek subset's WOFF (decision 252), embedded only when a figure sets Greek. */
export function greekWoffBase64(face: FontFace, weight: FontWeight): string {
  return WOFF[face][weight].GREEK_WOFF_BASE64;
}

/**
 * The code points the Greek file adds over the Latin one, as a CSS
 * `unicode-range`. The same for every vendored face (`font-metrics.test.ts`
 * pins it), so it is one constant.
 */
export const GREEK_UNICODE_RANGE = ARIMO_400.GREEK_UNICODE_RANGE;

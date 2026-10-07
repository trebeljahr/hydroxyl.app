/**
 * SVG -> PNG without a browser, for `render_figure`'s PNG output.
 *
 * resvg as wasm, for the reasons `packages/client/scripts/build-social-card.mjs`
 * gives: no browser, no system fonts, no native binary, the same pixels on
 * every machine. The editor's PNG goes through a canvas; here the SVG the
 * editor would hand that canvas (`figureSvgForRaster`) is rasterised instead,
 * so the two PNGs come from the same markup at the same pixel size.
 *
 * resvg reads only bare TrueType/OpenType and silently draws NOTHING for text
 * it has no font for, so chem-render's vendored Arimo WOFF is unwrapped first
 * and a probe glyph is rendered before the first figure: a PNG whose atom
 * labels are blank is a wrong figure, not a degraded one.
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { inflateSync } from "node:zlib";

import { initWasm, Resvg, type ResvgRenderOptions } from "@resvg/resvg-wasm";

/**
 * WOFF 1.0 -> the SFNT it wraps (https://www.w3.org/TR/WOFF/).
 *
 * The same loop as the social-card script's. Duplicated, not shared: that
 * script is plain .mjs run before any package is built, and the only other
 * home would be chem-render, which must not import node:zlib.
 */
export function woffToSfnt(woff: Uint8Array): Uint8Array {
  const view = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  if (view.getUint32(0) !== 0x774f4646 /* "wOFF" */) throw new Error("not a WOFF 1.0 file");
  const flavor = view.getUint32(4);
  const numTables = view.getUint16(12);

  const tables: { tag: number; checksum: number; data: Uint8Array }[] = [];
  for (let i = 0; i < numTables; i++) {
    const entry = 44 + i * 20;
    const offset = view.getUint32(entry + 4);
    const compLength = view.getUint32(entry + 8);
    const origLength = view.getUint32(entry + 12);
    const stored = woff.subarray(offset, offset + compLength);
    const data = compLength < origLength ? new Uint8Array(inflateSync(stored)) : stored;
    if (data.length !== origLength) throw new Error(`WOFF table ${i} inflates to the wrong length`);
    tables.push({ tag: view.getUint32(entry), checksum: view.getUint32(entry + 16), data });
  }

  const padded = (n: number): number => (n + 3) & ~3;
  const headerLength = 12 + 16 * numTables;
  const sfnt = new Uint8Array(tables.reduce((sum, t) => sum + padded(t.data.length), headerLength));
  const out = new DataView(sfnt.buffer);
  const searchRange = 2 ** Math.floor(Math.log2(numTables));
  out.setUint32(0, flavor);
  out.setUint16(4, numTables);
  out.setUint16(6, searchRange * 16);
  out.setUint16(8, Math.log2(searchRange));
  out.setUint16(10, numTables * 16 - searchRange * 16);
  let at = headerLength;
  tables.forEach((table, i) => {
    const record = 12 + i * 16;
    out.setUint32(record, table.tag);
    out.setUint32(record + 4, table.checksum);
    out.setUint32(record + 8, at);
    out.setUint32(record + 12, table.data.length);
    sfnt.set(table.data, at);
    at += padded(table.data.length);
  });
  return sfnt;
}

export type Rasterize = (svg: string) => Uint8Array;

let ready: Promise<ResvgRenderOptions> | undefined;

/**
 * A rasteriser using the Arimo WOFF at `fontPath`, or a rejection if resvg
 * cannot draw text with it. Initialises the wasm once per process.
 */
export async function loadRasterizer(fontPath: URL | string): Promise<Rasterize> {
  ready ??= (async () => {
    const require = createRequire(import.meta.url);
    await initWasm(await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
    const arimo = woffToSfnt(new Uint8Array(await readFile(fontPath)));
    const options: ResvgRenderOptions = {
      font: {
        fontBuffers: [arimo],
        loadSystemFonts: false,
        defaultFontFamily: "Arimo",
        sansSerifFamily: "Arimo",
      },
    };
    const probe = new Resvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">` +
        `<text x="4" y="34" font-family="Arimo" font-size="36">H</text></svg>`,
      options,
    ).render();
    if (!probe.pixels.some((value, i) => i % 4 === 3 && value > 0)) {
      throw new Error("resvg drew no text with the unwrapped Arimo; a PNG's labels would be blank.");
    }
    return options;
  })();
  const options = await ready;
  return (svg) => new Resvg(svg, options).render().asPng();
}

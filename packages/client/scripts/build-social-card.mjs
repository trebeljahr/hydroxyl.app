/**
 * Render the social card to `packages/client/public/social-card.png`.
 *
 * The card is composed by `src/components/landing/social-card.ts` from the
 * landing page's example figure; this script only turns that SVG into the PNG
 * that Open Graph and Twitter require (neither accepts SVG). The file is
 * gitignored and rebuilt on every `dev` and `build`, like the RDKit assets,
 * so the card can never show a figure the renderer no longer draws.
 *
 * WHY resvg, AS WASM. It rasterises without a browser and without system
 * fonts, so the card is the same pixels on a Mac and in the bookworm-slim
 * Docker build. sharp is in the tree already, but it renders text through
 * fontconfig, which in that image finds no fonts at all. The wasm build needs
 * no native binary and no pnpm build approval.
 *
 * WHY THE FONT IS UNWRAPPED FIRST. chem-render vendors Arimo as a WOFF (the
 * format the SVG export embeds), and resvg reads only bare TrueType/OpenType.
 * Measured: handed the WOFF, resvg drew the text as nothing, with no error.
 * WOFF 1.0 is the same tables, each optionally zlib-compressed, so unwrapping
 * it is a loop over the table directory. And because resvg drops text it has
 * no font for silently, the script renders a probe glyph first and refuses to
 * write a card whose labels would be blank.
 *
 * Chained explicitly from `dev` and `build`, for the reason given at the top
 * of `copy-rdkit.mjs`. It needs chem-core, chem-render and shared built, which
 * `next build` needs anyway.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";

import { initWasm, Resvg } from "@resvg/resvg-wasm";
import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.join(here, "..");

/** WOFF 1.0 → the SFNT it wraps (https://www.w3.org/TR/WOFF/). */
function woffToSfnt(woff) {
  const view = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  if (view.getUint32(0) !== 0x774f4646 /* "wOFF" */) throw new Error("not a WOFF 1.0 file");
  const flavor = view.getUint32(4);
  const numTables = view.getUint16(12);

  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const entry = 44 + i * 20;
    const offset = view.getUint32(entry + 4);
    const compLength = view.getUint32(entry + 8);
    const origLength = view.getUint32(entry + 12);
    const stored = woff.subarray(offset, offset + compLength);
    const data = compLength < origLength ? inflateSync(stored) : stored;
    if (data.length !== origLength) throw new Error(`WOFF table ${i} inflates to the wrong length`);
    tables.push({
      tag: view.getUint32(entry),
      checksum: view.getUint32(entry + 16),
      data,
    });
  }

  const padded = (n) => (n + 3) & ~3;
  const headerLength = 12 + 16 * numTables;
  const sfnt = new Uint8Array(
    tables.reduce((sum, t) => sum + padded(t.data.length), headerLength),
  );
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

/** The card module, bundled for node: it imports through `@/` and the
 *  workspace packages, which only a bundler resolves. */
async function loadCardModule() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hydroxyl-social-card-"));
  try {
    const outfile = path.join(dir, "social-card.mjs");
    await esbuild.build({
      entryPoints: [path.join(clientRoot, "src", "components", "landing", "social-card.ts")],
      outfile,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node24",
      logLevel: "warning",
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const { SOCIAL_CARD, socialCardSvg } = await loadCardModule();

await initWasm(await readFile(fileURLToPath(import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm"))));

// The asset the generated ARIMO_WOFF_BASE64 is made from, beside chem-render's dist/.
const arimo = woffToSfnt(
  await readFile(
    fileURLToPath(
      new URL("../assets/arimo-latin-400-normal.woff", import.meta.resolve("@starter/chem-render")),
    ),
  ),
);
const renderOptions = {
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
  renderOptions,
).render();
if (!probe.pixels.some((value, i) => i % 4 === 3 && value > 0)) {
  throw new Error("resvg drew no text with the unwrapped Arimo; the card's labels would be blank.");
}

const rendered = new Resvg(socialCardSvg(), renderOptions).render();
if (rendered.width !== SOCIAL_CARD.width || rendered.height !== SOCIAL_CARD.height) {
  throw new Error(
    `The social card rendered at ${rendered.width}×${rendered.height}, ` +
      `not ${SOCIAL_CARD.width}×${SOCIAL_CARD.height}.`,
  );
}
const png = rendered.asPng();
const target = path.join(clientRoot, "public", ...SOCIAL_CARD.path.split("/").filter(Boolean));
await writeFile(target, png);
console.log(
  `social card: ${path.relative(clientRoot, target)} ` +
    `(${rendered.width}×${rendered.height}, ${Math.round(png.length / 1024)} kB)`,
);

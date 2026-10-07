/**
 * Draws the installable app's icons: phenol, the hydroxyl the product is
 * named after, white on the UI's near-black primary.
 *
 * Run by hand when the drawing changes; the PNGs it writes are committed:
 *
 *   node packages/client/scripts/build-app-icons.mjs
 *
 * Paths only, no text: resvg draws text it has no font for as nothing, and
 * "OH" is two letters that are easier to stroke than to embed a font for.
 * Everything sits inside the central 80% circle, so the full-bleed maskable
 * variant survives any launcher's mask.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { initWasm, Resvg } from "@resvg/resvg-wasm";

const clientRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKGROUND = "#171717";
const INK = "#fafafa";

function drawing() {
  const cx = 256;
  const cy = 323;
  const r = 110;
  const vertex = (i) => {
    const a = ((-90 + 60 * i) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const v = [0, 1, 2, 3, 4, 5].map(vertex);
  const ring = `M${v.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L")} Z`;
  // Kekulé double bonds on alternate edges, drawn inside the ring.
  const inner = [1, 3, 5]
    .map((i) => {
      const [x1, y1] = v[i];
      const [x2, y2] = v[(i + 1) % 6];
      const shrink = (x, y, ox, oy) => [x + (ox - x) * 0.18, y + (oy - y) * 0.18];
      const pull = (x, y) => [x + (cx - x) * 0.3, y + (cy - y) * 0.3];
      const [a, b] = pull(...shrink(x1, y1, x2, y2));
      const [c, d] = pull(...shrink(x2, y2, x1, y1));
      return `M${a.toFixed(1)} ${b.toFixed(1)} L${c.toFixed(1)} ${d.toFixed(1)}`;
    })
    .join(" ");
  const [tx, ty] = v[0];
  const bond = `M${tx} ${ty.toFixed(1)} L${tx} 156`;
  // "O" centred on the bond, "H" to its right.
  const o = `<ellipse cx="${tx}" cy="112" rx="22" ry="27" />`;
  const h = `M302 85 L302 139 M338 85 L338 139 M302 112 L338 112`;
  return `<g fill="none" stroke="${INK}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 -6)">
    <path d="${ring} ${inner} ${bond} ${h}" />${o}
  </g>`;
}

function svg({ maskable }) {
  const background = maskable
    ? `<rect width="512" height="512" fill="${BACKGROUND}" />`
    : `<rect width="512" height="512" rx="112" fill="${BACKGROUND}" />`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${background}${drawing()}</svg>\n`;
}

await initWasm(await readFile(fileURLToPath(import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm"))));

function png(source, size) {
  return new Resvg(source, { fitTo: { mode: "width", value: size } }).render().asPng();
}

const icons = path.join(clientRoot, "public", "icons");
await mkdir(icons, { recursive: true });
const any = svg({ maskable: false });
const maskable = svg({ maskable: true });
await writeFile(path.join(clientRoot, "src", "app", "icon.svg"), any);
await writeFile(path.join(icons, "icon-192.png"), png(any, 192));
await writeFile(path.join(icons, "icon-512.png"), png(any, 512));
await writeFile(path.join(icons, "icon-maskable-512.png"), png(maskable, 512));
// iOS draws its own rounded mask over the home-screen icon.
await writeFile(path.join(clientRoot, "src", "app", "apple-icon.png"), png(maskable, 180));
console.log("app icons: wrote public/icons/*.png, src/app/icon.svg and src/app/apple-icon.png");

/**
 * SVG -> PNG, at a journal's resolution.
 *
 * ── RASTERISED, NOT UPSCALED ─────────────────────────────────────────────
 *
 * The SVG handed in already declares `width`/`height` equal to the target
 * pixel size (see `figureSvgForRaster`), and the canvas backing store is set
 * to exactly that size through its `width`/`height` ATTRIBUTES. The browser
 * therefore rasterises the vectors at full resolution. Setting a CSS size on a
 * small canvas, or drawing a small intrinsic image into a big one, would
 * interpolate pixels and produce the blur a referee sends back.
 *
 * ── THE RESOLUTION IS WRITTEN INTO THE FILE ──────────────────────────────
 *
 * `canvas.toBlob` writes no pHYs chunk, so every tool would read a 974 px
 * wide PNG as 72 dpi — 34 cm wide — even though the pixel count is right for
 * 8.25 cm at 300 dpi. `withPhysChunk` inserts one. It is a pure byte
 * operation, tested without a browser.
 */

import { pixelsPerMetre } from "@starter/chem-render";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable !== null) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  crcTable = t;
  return t;
}

/** CRC-32 as PNG defines it (ISO 3309), over the chunk type and data. */
export function crc32(bytes: Uint8Array): number {
  const t = table();
  let c = 0xffffffff;
  for (const byte of bytes) c = (t[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/** Width and height from the IHDR chunk, which the spec requires first. */
export function pngDimensions(bytes: Uint8Array): { readonly width: number; readonly height: number } {
  if (!isPng(bytes)) throw new Error("Not a PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Pixels per metre on each axis from a pHYs chunk, or null when there is none. */
export function pngPixelsPerMetre(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "pHYs") return view.getUint32(offset + 8);
    if (type === "IDAT" || type === "IEND") return null;
    offset += 12 + length;
  }
  return null;
}

/**
 * `png` with a pHYs chunk stating `dpi`, inserted straight after IHDR (the
 * spec requires it before the first IDAT). An existing pHYs is replaced.
 */
export function withPhysChunk(png: Uint8Array, dpi: number): Uint8Array {
  if (!isPng(png)) throw new Error("Not a PNG");
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const ihdrEnd = 8 + 12 + view.getUint32(8);

  // Drop any pHYs the encoder did write, so there is exactly one.
  const kept: Uint8Array[] = [png.subarray(0, ihdrEnd)];
  let offset = ihdrEnd;
  while (offset + 8 <= png.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    if (type !== "pHYs") kept.push(png.subarray(offset, end));
    offset = end;
  }

  const ppm = pixelsPerMetre(dpi);
  const chunk = new Uint8Array(21);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  cv.setUint32(8, ppm);
  cv.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  cv.setUint32(17, crc32(chunk.subarray(4, 17)));

  const [head, ...rest] = kept;
  const parts = [head ?? new Uint8Array(), chunk, ...rest];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Rasterise a self-contained SVG to a PNG blob of exactly `widthPx` ×
 * `heightPx`, stamped with `dpi`.
 */
export async function rasterizeSvg(
  svg: string,
  widthPx: number,
  heightPx: number,
  dpi: number,
): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image(widthPx, heightPx);
    image.decoding = "async";
    image.src = url;
    await image.decode();

    const canvas = document.createElement("canvas");
    // The backing store, not the CSS box: this is the rasterisation size.
    canvas.width = widthPx;
    canvas.height = heightPx;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("This browser could not create a canvas to draw the PNG.");
    context.drawImage(image, 0, 0, widthPx, heightPx);

    const encoded = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png");
    });
    if (encoded === null) {
      throw new Error(`The browser could not encode a ${widthPx} × ${heightPx} px PNG.`);
    }
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    return new Blob([withPhysChunk(bytes, dpi) as BlobPart], { type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

import { describe, expect, it } from "vitest";

import { crc32, isPng, pngDimensions, pngPixelsPerMetre, withPhysChunk } from "./png";

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function png(width: number, height: number, extra: Uint8Array[] = []): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...extra,
    chunk("IDAT", new Uint8Array([1, 2, 3])),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Every chunk's CRC, recomputed: a PNG with one wrong CRC is rejected by strict readers. */
function crcsValid(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const stored = view.getUint32(offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== stored) return false;
    offset += 12 + length;
  }
  return offset === bytes.length;
}

describe("PNG helpers", () => {
  it("computes the CRC PNG specifies", () => {
    // The IEND chunk's CRC is the same in every PNG ever written.
    expect(crc32(new TextEncoder().encode("IEND"))).toBe(0xae426082);
  });

  it("reads the size from IHDR", () => {
    const bytes = png(974, 403);
    expect(isPng(bytes)).toBe(true);
    expect(pngDimensions(bytes)).toEqual({ width: 974, height: 403 });
    expect(pngPixelsPerMetre(bytes)).toBeNull();
  });

  it("stamps the resolution as a pHYs chunk before the image data", () => {
    const stamped = withPhysChunk(png(974, 403), 300);
    expect(pngPixelsPerMetre(stamped)).toBe(11811);
    expect(pngDimensions(stamped)).toEqual({ width: 974, height: 403 });
    expect(crcsValid(stamped)).toBe(true);
    const text = String.fromCharCode(...stamped);
    expect(text.indexOf("pHYs")).toBeLessThan(text.indexOf("IDAT"));
    expect(text.indexOf("pHYs")).toBeGreaterThan(text.indexOf("IHDR"));
  });

  it("replaces a pHYs the encoder already wrote rather than adding a second", () => {
    const existing = chunk("pHYs", new Uint8Array([0, 0, 11, 19, 0, 0, 11, 19, 1]));
    const stamped = withPhysChunk(png(10, 10, [existing]), 600);
    expect(pngPixelsPerMetre(stamped)).toBe(23622);
    expect(String.fromCharCode(...stamped).split("pHYs")).toHaveLength(2);
    expect(crcsValid(stamped)).toBe(true);
  });

  it("refuses bytes that are not a PNG", () => {
    expect(() => withPhysChunk(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), 300)).toThrow(/PNG/);
  });
});

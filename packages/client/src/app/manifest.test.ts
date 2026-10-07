import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SITE_NAME } from "@/lib/site";

import manifest from "./manifest";

const publicDir = path.resolve(import.meta.dirname, "..", "..", "public");

/** PNG IHDR width and height. */
function pngSize(file: string): string {
  const bytes = readFileSync(file);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

describe("web app manifest", () => {
  it("takes its name from SITE_NAME, so a rename reaches the installed app", () => {
    const m = manifest();
    expect(m.name).toBe(SITE_NAME);
    expect(m.short_name).toBe(SITE_NAME);
  });

  it("is installable: standalone, a start URL in scope, 192 and 512 icons", () => {
    const m = manifest();
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    const sizes = (m.icons ?? []).map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect((m.icons ?? []).some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("names icon files that exist at the size it claims", () => {
    for (const icon of manifest().icons ?? []) {
      const file = path.join(publicDir, icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      expect(pngSize(file), icon.src).toBe(icon.sizes);
    }
  });
});

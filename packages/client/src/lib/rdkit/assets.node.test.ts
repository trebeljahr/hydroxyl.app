import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The four files that must sit in `public/rdkit/`, and the licence that must
 * sit beside them.
 *
 * This is the "ships in both build modes" assertion. `public/` is the one
 * directory both modes copy verbatim — `output:"export"` writes it into
 * `out/` unprefixed, and the root Dockerfile already does
 * `COPY --from=build /app/packages/client/public ./packages/client/public` —
 * so proving the files are staged here proves they reach both. Anything
 * routed through the bundler instead would have to be proved twice, and one
 * of the two only shows up when the export is served.
 */

const publicRdkit = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "public",
  "rdkit",
);

describe("public/rdkit", () => {
  it("carries the wasm, the glue and the worker", () => {
    // Staged by scripts/copy-rdkit.mjs, which dev, build and test all chain.
    expect(statSync(path.join(publicRdkit, "RDKit_minimal.wasm")).size).toBeGreaterThan(1e6);
    expect(statSync(path.join(publicRdkit, "RDKit_minimal.js")).size).toBeGreaterThan(1e4);
    expect(statSync(path.join(publicRdkit, "rdkit.worker.js")).size).toBeGreaterThan(100);
  });

  it("ships the BSD-3 notice next to the wasm", () => {
    const notice = readFileSync(path.join(publicRdkit, "THIRD-PARTY-NOTICES.txt"), "utf8");
    // The three clauses, quoted closely enough that a truncated copy fails.
    expect(notice).toContain("Redistributions of source code must retain the above copyright");
    expect(notice).toContain("Redistributions in binary form must reproduce the above copyright");
    expect(notice).toContain("Neither the name of the copyright holder nor the names of its");
    expect(notice).toContain("Copyright (c)");
    // The wasm links more than RDKit, and two of those are not BSD.
    expect(notice).toMatch(/InChI/);
    expect(notice).toMatch(/Boost Software License/);
    expect(notice).toMatch(/coordgenlibs/);
  });

  it("names the exact @rdkit/rdkit version the wasm came from", () => {
    // A notice that does not say which build it describes is not a notice.
    const notice = readFileSync(path.join(publicRdkit, "THIRD-PARTY-NOTICES.txt"), "utf8");
    expect(notice).toMatch(/@rdkit\/rdkit \d{4}\.\d+\.\d+-[\d.]+/);
  });

  it("bundles the worker with no bare import left in it", () => {
    // A classic worker: `import` would be a syntax error at load, and the
    // failure surfaces as an error event with an empty message.
    const worker = readFileSync(path.join(publicRdkit, "rdkit.worker.js"), "utf8");
    expect(worker).not.toMatch(/^\s*import\s/m);
    expect(worker).toContain("importScripts");
  });
});

describe("no RDKit at module scope", () => {
  it("names @rdkit/rdkit nowhere in src/", () => {
    // The acceptance criterion, stated as a fact about the module graph
    // rather than as a fact about a network log: with the glue loaded by
    // `importScripts` from public/, RDKit is not in the graph at all, so no
    // bundler decision can accidentally pull it into the first chunk.
    const src = path.join(publicRdkit, "..", "..", "src");
    // An IMPORT of it, in any spelling — static, dynamic or require. Prose
    // mentions are everywhere and are the point: the comments explain why
    // nothing imports it.
    const hits = grep(src, /(?:^\s*import[^\n]*|\bimport\(|\brequire\()["']@rdkit\/rdkit["']/m);
    // The *.node.test.ts files are allowed: they run in node, never in a
    // browser bundle. That filter is the invariant; the count below only
    // stops the exemption quietly growing to cover a real source file that
    // someone happened to name `*.node.test.ts`.
    expect(hits.filter((f) => !f.endsWith(".node.test.ts"))).toEqual([]);
    expect(hits.map((f) => path.basename(f)).toSorted()).toEqual([
      "dative.node.test.ts",
      "descriptors.node.test.ts",
      "fidelity.node.test.ts",
      "inchi.node.test.ts",
      "insert-fidelity.node.test.ts",
      "nuclide-masses.node.test.ts",
      "projection-oracle.node.test.ts",
      "stereo-centres.node.test.ts",
      "stereo-groups.node.test.ts",
      "valence-table.node.test.ts",
    ]);
  });
});

function grep(dir: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...grep(full, pattern));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && pattern.test(readFileSync(full, "utf8"))) {
      out.push(full);
    }
  }
  return out;
}

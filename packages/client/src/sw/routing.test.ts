import { describe, expect, it } from "vitest";

import { cacheableStatic, pageKeys, rdkitVersion, route, staticKey } from "./routing";

/** Decision 239, rule by rule. */

const ORIGIN = "https://hydroxyl.app";

function get(url: string, mode = "cors", rsc = false) {
  return route({ url: `${ORIGIN}${url}`, method: "GET", mode, rsc }, ORIGIN);
}

describe("route", () => {
  it("sends page loads network-first, query and all", () => {
    expect(get("/editor/?example=aspirin", "navigate")).toBe("page");
    expect(get("/", "navigate")).toBe("page");
  });

  it("serves Next's hashed files and the versioned RDKit files cache-first", () => {
    expect(get("/_next/static/chunks/abc123.js?dpl=deadbeef")).toBe("static");
    expect(get("/rdkit/RDKit_minimal.wasm?v=0123456789abcdef")).toBe("rdkit");
  });

  it("leaves the release identity files to the network, so CI and ReleaseLifetime see the truth", () => {
    expect(get("/releases.json?at=1")).toBe("pass");
    expect(get("/version.json")).toBe("pass");
  });

  it("never caches an unversioned RDKit file, whose fixed name outlives a release", () => {
    expect(get("/rdkit/rdkit.worker.js")).toBe("pass");
    expect(get("/rdkit/THIRD-PARTY-NOTICES.txt")).toBe("pass");
  });

  it("passes RSC payloads, writes and other origins through", () => {
    expect(get("/editor/?_rsc=1x2y")).toBe("pass");
    expect(get("/_next/static/chunks/a.js", "cors", true)).toBe("pass");
    expect(route({ url: `${ORIGIN}/_next/static/a.js`, method: "POST", mode: "cors", rsc: false }, ORIGIN)).toBe("pass");
    expect(route({ url: "https://pubchem.ncbi.nlm.nih.gov/rest/pug", method: "GET", mode: "cors", rsc: false }, ORIGIN)).toBe("pass");
  });
});

describe("keys", () => {
  it("stores one hashed file once, whichever release asked for it", () => {
    expect(staticKey(`${ORIGIN}/_next/static/chunks/a.js?dpl=one`)).toBe(staticKey(`${ORIGIN}/_next/static/chunks/a.js?dpl=two`));
  });

  it("answers /editor?example= offline from the cached /editor/ document", () => {
    expect(pageKeys(`${ORIGIN}/editor?example=caffeine`)).toEqual([`${ORIGIN}/editor`, `${ORIGIN}/editor/`]);
    expect(pageKeys(`${ORIGIN}/editor/?doc=x`)).toEqual([`${ORIGIN}/editor/`]);
  });

  it("reads the RDKit content version off the URL", () => {
    expect(rdkitVersion(`${ORIGIN}/rdkit/RDKit_minimal.js?v=abc`)).toBe("abc");
    expect(rdkitVersion(`${ORIGIN}/rdkit/RDKit_minimal.js`)).toBeNull();
  });
});

describe("cacheableStatic", () => {
  it("stores only what the server marked immutable, which next dev never does", () => {
    expect(cacheableStatic(200, "public, max-age=31536000, immutable")).toBe(true);
    expect(cacheableStatic(200, "no-store, must-revalidate")).toBe(false);
    expect(cacheableStatic(200, null)).toBe(false);
    expect(cacheableStatic(404, "public, max-age=31536000, immutable")).toBe(false);
  });
});

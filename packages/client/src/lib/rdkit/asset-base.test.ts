import { afterEach, describe, expect, it, vi } from "vitest";

import { rdkitAssetBase, rdkitAssetUrl, rdkitOfflineAssetUrls } from "./asset-base";

/**
 * The one piece of URL cleverness in the bridge, and the one that fails
 * silently when it is wrong: a bad base means the worker 404s, and a 404 on a
 * worker script produces an error event whose `.message` is the empty string.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  document.head.querySelectorAll("script").forEach((s) => s.remove());
  document.head.querySelectorAll("base").forEach((b) => b.remove());
});

function addScript(src: string): void {
  const script = document.createElement("script");
  script.src = src;
  document.head.append(script);
}

describe("rdkitAssetBase", () => {
  it("resolves to the site root when Next emits absolute asset paths", () => {
    // dev and output:"standalone". public/ is served at the root.
    addScript("/_next/static/chunks/main-app.js");
    expect(rdkitAssetBase()).toBe(`${location.origin}/rdkit/`);
  });

  it("follows the deployment directory when the asset path is relative", () => {
    // output:"export" with assetPrefix "./": Next writes "./_next/static/…"
    // and the BROWSER has already resolved it against the document, so the
    // script's .src carries whatever subdirectory the app was opened from.
    const base = document.createElement("base");
    base.href = "https://example.test/app/";
    document.head.append(base);
    addScript("./_next/static/chunks/main-app.js");
    expect(rdkitAssetBase()).toBe("https://example.test/app/rdkit/");
  });

  it("falls back to the document's own directory when there is no asset tag", () => {
    const base = document.createElement("base");
    base.href = "https://example.test/app/editor/";
    document.head.append(base);
    expect(rdkitAssetBase()).toBe("https://example.test/app/editor/rdkit/");
  });
});

describe("rdkitAssetUrl", () => {
  it("carries the content version, so a cache keyed by URL cannot pair releases", () => {
    // Decision 239: the files keep fixed names and the service worker serves
    // them cache-first.
    vi.stubEnv("NEXT_PUBLIC_RDKIT_ASSET_VERSION", "0123456789abcdef");
    addScript("/_next/static/chunks/main-app.js");
    expect(rdkitAssetUrl("rdkit.worker.js")).toBe(`${location.origin}/rdkit/rdkit.worker.js?v=0123456789abcdef`);
    expect(rdkitOfflineAssetUrls()).toEqual(
      ["rdkit.worker.js", "RDKit_minimal.js", "RDKit_minimal.wasm"].map(
        (name) => `${location.origin}/rdkit/${name}?v=0123456789abcdef`,
      ),
    );
  });

  it("is the bare name outside a Next build", () => {
    vi.stubEnv("NEXT_PUBLIC_RDKIT_ASSET_VERSION", "");
    addScript("/_next/static/chunks/main-app.js");
    expect(rdkitAssetUrl("RDKit_minimal.wasm")).toBe(`${location.origin}/rdkit/RDKit_minimal.wasm`);
  });
});

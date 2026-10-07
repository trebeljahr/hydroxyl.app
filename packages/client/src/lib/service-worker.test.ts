import { afterEach, describe, expect, it, vi } from "vitest";

import { offlineAssetUrls, serviceWorkerPlan, shouldWarmOfflineAssets } from "./service-worker";

const hosted = { fileExport: false, production: true, supported: true, protocol: "https:" };

describe("serviceWorkerPlan", () => {
  it("registers on the hosted build", () => {
    expect(serviceWorkerPlan(hosted)).toBe("register");
    expect(serviceWorkerPlan({ ...hosted, protocol: "http:" })).toBe("register");
  });

  it("never registers in the static export, whose shells cannot", () => {
    expect(serviceWorkerPlan({ ...hosted, fileExport: true })).toBe("none");
    expect(serviceWorkerPlan({ ...hosted, protocol: "file:" })).toBe("none");
    expect(serviceWorkerPlan({ ...hosted, protocol: "app:" })).toBe("none");
  });

  it("clears a production worker off the dev origin instead of registering", () => {
    expect(serviceWorkerPlan({ ...hosted, production: false })).toBe("unregister");
  });

  it("does nothing where workers do not exist", () => {
    expect(serviceWorkerPlan({ ...hosted, supported: false })).toBe("none");
  });
});

describe("shouldWarmOfflineAssets", () => {
  it("fetches RDKit and the 3D worker ahead of use only in the installed editor", () => {
    expect(shouldWarmOfflineAssets("/editor", true)).toBe(true);
    expect(shouldWarmOfflineAssets("/editor/", true)).toBe(true);
    expect(shouldWarmOfflineAssets("/", true)).toBe(false);
  });

  it("keeps a browser tab's editor load free of the 6.9 MB wasm (e2e/rdkit.spec.ts)", () => {
    expect(shouldWarmOfflineAssets("/editor/", false)).toBe(false);
  });
});

describe("offlineAssetUrls", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("names RDKit's three files and the conformer worker, each at its own version", () => {
    vi.stubEnv("NEXT_PUBLIC_RDKIT_ASSET_VERSION", "aaaa");
    vi.stubEnv("NEXT_PUBLIC_CONFORMER_ASSET_VERSION", "bbbb");
    const urls = offlineAssetUrls().map((url) => new URL(url));
    expect(urls.map((url) => `${url.pathname}${url.search}`)).toEqual([
      "/rdkit/rdkit.worker.js?v=aaaa",
      "/rdkit/RDKit_minimal.js?v=aaaa",
      "/rdkit/RDKit_minimal.wasm?v=aaaa",
      "/conformer/conformer.worker.js?v=bbbb",
    ]);
  });
});

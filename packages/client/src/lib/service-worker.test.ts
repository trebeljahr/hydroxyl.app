import { describe, expect, it } from "vitest";

import { serviceWorkerPlan, shouldWarmRdkit } from "./service-worker";

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

describe("shouldWarmRdkit", () => {
  it("fetches RDKit ahead of use only in the installed editor", () => {
    expect(shouldWarmRdkit("/editor", true)).toBe(true);
    expect(shouldWarmRdkit("/editor/", true)).toBe(true);
    expect(shouldWarmRdkit("/", true)).toBe(false);
  });

  it("keeps a browser tab's editor load free of the 6.9 MB wasm (e2e/rdkit.spec.ts)", () => {
    expect(shouldWarmRdkit("/editor/", false)).toBe(false);
  });
});

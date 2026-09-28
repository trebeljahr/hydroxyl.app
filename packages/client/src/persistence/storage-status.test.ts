import { describe, expect, it, vi } from "vitest";

import { formatBytes, readStorageStatus, requestPersistentStorage } from "./storage-status";

describe("readStorageStatus", () => {
  it("reports usage and the browser's promise when the API is there", async () => {
    const status = await readStorageStatus({
      estimate: () => Promise.resolve({ usage: 1_234_567 }),
      persisted: () => Promise.resolve(false),
      persist: () => Promise.resolve(true),
    });
    expect(status).toEqual({ usageBytes: 1_234_567, persisted: false });
  });

  it("claims nothing when the browser has no Storage API", async () => {
    expect(await readStorageStatus(undefined)).toEqual({ usageBytes: null, persisted: null });
  });

  it("treats a refused estimate as no estimate, and never throws", async () => {
    const status = await readStorageStatus({
      estimate: () => Promise.reject(new Error("SecurityError")),
      persisted: () => Promise.reject(new Error("SecurityError")),
      persist: () => Promise.resolve(true),
    });
    expect(status).toEqual({ usageBytes: null, persisted: null });
  });

  it("does not report persistence it could not ask for", async () => {
    // `persisted()` without `persist()` would show a state with no way to
    // change it, so the grid shows neither.
    const status = await readStorageStatus({ persisted: () => Promise.resolve(false) });
    expect(status.persisted).toBeNull();
  });
});

describe("requestPersistentStorage", () => {
  it("passes the browser's answer through", async () => {
    const persist = vi.fn(() => Promise.resolve(false));
    expect(await requestPersistentStorage({ persist })).toBe(false);
    expect(persist).toHaveBeenCalledOnce();
  });

  it("is null where there is no way to ask", async () => {
    expect(await requestPersistentStorage({})).toBeNull();
  });
});

describe("formatBytes", () => {
  it("uses the decimal units a browser's own settings page shows", () => {
    expect(formatBytes(512)).toBe("512 bytes");
    expect(formatBytes(48_200)).toBe("48 KB");
    expect(formatBytes(3_400_000)).toBe("3.4 MB");
  });
});

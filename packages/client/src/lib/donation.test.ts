import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DONATION_SUPPORTED_KEY, recordDonationReturn } from "./donation";

/**
 * The return from the shared donate page. The URL is what a chemist can see
 * and copy, so the assertions are on the whole of it: only `supported` may
 * leave, and `?doc=` and the hash must survive, or the wrong sketch opens.
 */

const NOW = 1_790_000_000_000;

function arriveAt(path: string): void {
  window.history.replaceState(null, "", path);
}

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  arriveAt("/");
});

describe("recordDonationReturn", () => {
  it("stores the time and strips the parameter", () => {
    arriveAt("/?supported=1");
    recordDonationReturn();
    expect(window.localStorage.getItem(DONATION_SUPPORTED_KEY)).toBe(String(NOW));
    expect(currentPath()).toBe("/");
  });

  it("keeps the other parameters and the hash", () => {
    arriveAt("/editor?doc=doc_42&supported=1&fixture=stress#panel-2");
    recordDonationReturn();
    expect(currentPath()).toBe("/editor?doc=doc_42&fixture=stress#panel-2");
    expect(window.localStorage.getItem(DONATION_SUPPORTED_KEY)).toBe(String(NOW));
  });

  it("does nothing without the parameter", () => {
    arriveAt("/editor?doc=doc_42#x");
    const replace = vi.spyOn(window.history, "replaceState");
    recordDonationReturn();
    expect(replace).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(DONATION_SUPPORTED_KEY)).toBeNull();
    expect(currentPath()).toBe("/editor?doc=doc_42#x");
  });

  it("ignores a value other than 1", () => {
    arriveAt("/?supported=0");
    recordDonationReturn();
    expect(window.localStorage.getItem(DONATION_SUPPORTED_KEY)).toBeNull();
    expect(currentPath()).toBe("/?supported=0");
  });

  it("still cleans the URL when storage throws", () => {
    arriveAt("/?supported=1");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => recordDonationReturn()).not.toThrow();
    expect(currentPath()).toBe("/");
  });
});

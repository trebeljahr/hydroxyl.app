import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DONATION_SUPPORTED_KEY,
  SUPPORT_LINE_KEY,
  SUPPORT_QUIET_AFTER_DONATION_MS,
  claimSupportLine,
  recordDonationReturn,
} from "./donation";

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
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => recordDonationReturn()).not.toThrow();
    expect(currentPath()).toBe("/");
  });
});

describe("claimSupportLine", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers yes once per browser and remembers when", () => {
    expect(claimSupportLine(NOW)).toBe(true);
    expect(window.localStorage.getItem(SUPPORT_LINE_KEY)).toBe(String(NOW));
    expect(claimSupportLine(NOW + 1)).toBe(false);
  });

  it("stays quiet for 90 days after a donation, then asks once", () => {
    window.localStorage.setItem(DONATION_SUPPORTED_KEY, String(NOW));
    expect(claimSupportLine(NOW + SUPPORT_QUIET_AFTER_DONATION_MS - 1)).toBe(false);
    expect(window.localStorage.getItem(SUPPORT_LINE_KEY)).toBeNull();
    expect(claimSupportLine(NOW + SUPPORT_QUIET_AFTER_DONATION_MS)).toBe(true);
    expect(claimSupportLine(NOW + SUPPORT_QUIET_AFTER_DONATION_MS + 1)).toBe(false);
  });

  it("never answers yes in the static export an app-store shell packages", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "1");
    expect(claimSupportLine(NOW)).toBe(false);
    expect(window.localStorage.getItem(SUPPORT_LINE_KEY)).toBeNull();
  });

  it("shows nothing when storage cannot remember it", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(claimSupportLine(NOW)).toBe(false);
  });
});

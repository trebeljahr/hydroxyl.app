// The /vitest subpath is load-bearing in both directions.
//
// Runtime: the bare "@testing-library/jest-dom" ESM entry ends with a
// `expect.extend(...)` against a GLOBAL expect, which throws
// "ReferenceError: expect is not defined" under Vitest and takes every
// test file in the package down with it. dist/vitest.mjs imports expect
// from vitest instead.
//
// Types: the root entry does `/// <reference types="jest" />` and
// augments `namespace jest` (@types/jest is not installed; only
// skipLibCheck hides it). types/vitest.d.ts augments vitest's own
// Assertion interface, which is what makes toBeInTheDocument() typecheck.
import "@testing-library/jest-dom/vitest";

// ---------------------------------------------------------------------------
// jsdom shims for Radix and cmdk
//
// jsdom implements no pointer capture, no scrollIntoView and no
// ResizeObserver, and Radix's Select/Dialog and cmdk's list all call at least
// one of them during a normal open. The failure is a thrown TypeError from
// inside the primitive, which reads as "the component is broken" rather than
// "the environment is missing an API", so the shims are here rather than
// scattered through the tests that trip them.
//
// Only the `dom` vitest project loads this file; the `node` and `rdkit`
// projects deliberately do not, and must not — a store test that needs a DOM
// shim has grown a DOM dependency and the split is what catches it.
// ---------------------------------------------------------------------------

if (typeof Element !== "undefined") {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => undefined;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => undefined;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// ---------------------------------------------------------------------------
// localStorage
//
// Node 25+ ships an experimental global `localStorage` that is UNDEFINED
// unless the process was started with `--localstorage-file`, and it shadows
// jsdom's own implementation — so under this runner `localStorage.clear()`
// throws "Cannot read properties of undefined". The persistence journal
// (src/persistence/journal.ts) is the one production user, and production
// degrades to a no-op without it, which is exactly what a test must not
// silently fall into. An in-memory Storage with the spec's surface is enough.
// ---------------------------------------------------------------------------

function storageUsable(): boolean {
  try {
    return typeof globalThis.localStorage?.getItem === "function";
  } catch {
    return false;
  }
}

if (!storageUsable()) {
  class MemoryStorage {
    #items = new Map<string, string>();
    get length(): number {
      return this.#items.size;
    }
    key(index: number): string | null {
      return [...this.#items.keys()][index] ?? null;
    }
    getItem(key: string): string | null {
      return this.#items.get(String(key)) ?? null;
    }
    setItem(key: string, value: string): void {
      this.#items.set(String(key), String(value));
    }
    removeItem(key: string): void {
      this.#items.delete(String(key));
    }
    clear(): void {
      this.#items.clear();
    }
  }
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage() as unknown as Storage,
  });
}

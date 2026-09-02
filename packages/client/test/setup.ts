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

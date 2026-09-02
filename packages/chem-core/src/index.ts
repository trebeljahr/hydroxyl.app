/**
 * @starter/chem-core — the chemistry model.
 *
 * Pure TypeScript: no React, no DOM, no dependencies. Everything the editor
 * knows about molecules lives here so it can be unit-tested without a
 * browser, reused headlessly, and swapped between renderers without
 * touching chemistry logic. (There is no server package — this repo is a
 * client-only surface.)
 */

export * from "./elements.js";
export * from "./types.js";
export * from "./vec.js";
export * from "./molecule.js";
export * from "./valence.js";
export * from "./formula.js";
export * from "./builders.js";
export * from "./ops.js";
export * from "./transform.js";
export * from "./fragment.js";

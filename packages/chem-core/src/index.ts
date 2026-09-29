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
export * from "./nuclides.js";
export * from "./types.js";
export * from "./vec.js";
export * from "./molecule.js";
export * from "./valence.js";
export * from "./formula.js";
export * from "./builders.js";
export * from "./ops.js";
export * from "./transform.js";
export * from "./fragment.js";
export * from "./hit.js";
export * from "./selection.js";
// The ABS/AND/OR record layer. Below ops and fragment in the graph (both
// import it to keep a group honest across a delete, a merge and a paste) and
// deliberately above nothing that perceives: it asks no stereo questions.
export * from "./stereo-groups.js";
// Species: connected components unioned across `Molecule.speciesJoins`, the
// record layer for those joins beside them. Below ops and fragment for the
// same reason as the stereo groups.
export * from "./species.js";
export * from "./sprout.js";
export * from "./rings.js";
export * from "./aromatic.js";
export * from "./molblock-write.js";
export * from "./molblock-read.js";
export * from "./templates.js";
// Functional groups: stamped through templates.ts's attachment direction.
export * from "./groups.js";
export * from "./lewis.js";
export * from "./condensed.js";
// The one lift and signed volume both stereo readers call. Imports neither.
export * from "./parity.js";
// CIP ranking and unit classification, shared by both stereo readers. Imports
// neither of them.
export * from "./cip.js";
// Constitutional symmetry (colour refinement) and stereogenic axes and planes.
export * from "./symmetry.js";
export * from "./stereo-axes.js";
// Perception LAST among the chemistry modules: it reads valence, rings and
// aromaticity, and only stereo-config reads it.
export * from "./stereo.js";
// After stereo.js and valence.js, which it composes. Nothing imports it.
export * from "./issues.js";
// Coordinate-free configuration and reading conventions, built on stereo.ts's
// CIP ranking.
export * from "./stereo-config.js";
// Achirality proved by an atom mapping; reads stereo-config.
export * from "./achirality.js";

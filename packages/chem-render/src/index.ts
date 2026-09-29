/**
 * @starter/chem-render — molecules to pictures.
 *
 * Takes a `Molecule` from @starter/chem-core and produces a scene: a flat list
 * of drawing primitives with their geometry already resolved, plus an SVG
 * serialiser for it. Framework-free in the same way chem-core is — no React,
 * no DOM, no dependencies beyond chem-core — so a figure can be rendered in a
 * unit test, in a build script, or in the browser from the same code.
 *
 * THE INVARIANT — the reason this package exists as a layer of its own:
 *
 *   `RenderStyle` is the sole owner of the model-units-to-px conversion and of
 *   the y-flip. chem-core coordinates are y-up and measured in bond lengths;
 *   `modelToPx` multiplies by `style.bondLengthPx` and negates y, and no other
 *   function anywhere may do either. `buildScene` therefore emits a scene in
 *   FINAL PX with y ALREADY FLIPPED — y-down, exactly as SVG wants it.
 *
 *   Everything downstream inherits that. The editor viewport does pan and zoom
 *   *within* the flipped px space and nothing else: it must never re-scale by
 *   a bond length, and it must never flip again. This is binding on the editor
 *   store, not a suggestion. The moment a second place decides which way is up
 *   or how big a bond is, drawing and hit-testing disagree, and the symptom —
 *   a structure that looks right but selects the mirrored atom — points
 *   nowhere near the cause.
 *
 * Scenes are also byte-deterministic: primitive ids derive from the atom or
 * bond that produced them, emission follows the molecule's insertion order,
 * and every number is printed through one formatter. Exported figures get
 * committed and diffed, and that is only useful if re-rendering an unchanged
 * molecule changes nothing.
 */

export * from "./style.js";
export * from "./representation.js";
export * from "./availability.js";
export * from "./scene/types.js";
// Dependency order: the text layer measures, the label layer decides and
// places, and the scene layer consumes both. `text/generated/` is deliberately
// NOT re-exported — the generated table reaches consumers through
// `text/metrics.js`, so no path containing `generated/` ever leaves the
// package and a regeneration cannot become a breaking change for a caller.
export * from "./text/metrics.js";
export * from "./text/measurer.js";
export * from "./label/visibility.js";
export * from "./label/compose.js";
export * from "./label/placement.js";
// Annotation placement sits with the label layer because it measures text and
// queries the same obstacle unions, but it is the mirror image of it: an atom
// label claims space, an annotation — descriptor, alpha/beta, locant, torsion
// — only looks for space nobody claimed. `descriptors.js` is the one-descriptor
// convenience over the same ladder.
export * from "./label/annotations.js";
export * from "./label/descriptors.js";
// The bond pass: trimming, the second and third lines, and the aromatic
// circle. It consumes the label layer's clear space and produces geometry.
export * from "./bond/geometry.js";
export * from "./bond/doubleBond.js";
export * from "./bond/aromatic.js";
export * from "./bond/stereo.js";
export * from "./scene/build.js";
export * from "./scene/bounds.js";
// Reports overlaps over an already-built scene. Never called by `buildScene`:
// a report on the scene is a field somebody eventually serialises.
export * from "./scene/collide.js";
export * from "./svg/serialize.js";
// Panel figures: N representations of the one molecule on a grid, composed
// with ONE style (decision 5) and serialised as one namespaced SVG root.
// `svg/emit.js` is deliberately not re-exported; it is the shared mechanics.
export * from "./figure/compose.js";
export * from "./figure/physical.js";
export * from "./svg/figure.js";
// Scheme annotations: the stored arrows, plus signs, brackets and text a
// document holds beside its molecule. Types, anchors and pruning.
export * from "./scheme/annotation.js";
// The layer that draws them: an anchor resolver over a panel's injected
// geometry, the chord-frame curve, one arrowhead module, and the curly arrow
// laid out, reported on and emitted as a shaft and a head.
export * from "./annotation/anchor.js";
export * from "./annotation/curve.js";
export * from "./annotation/arrowhead.js";
export * from "./annotation/curly.js";
export * from "./annotation/layer.js";
export * from "./fixtures.js";

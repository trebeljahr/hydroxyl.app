/**
 * The editor canvas module.
 *
 * Everything between the editor store and the pixels: the bridge that turns a
 * `SketchDocument` into a chem-render scene, the measurements taken off that
 * scene, the pointer-to-molecule pick, the gesture hook, and the React layers
 * that draw it all.
 *
 * Import from here rather than from the individual files. Four of them
 * (`SceneLayer`, `OverlayLayer`, `EditorCanvas` and `useCanvasGestures`) pull
 * in React; the other four are plain TypeScript over chem-core, chem-render
 * and the store, and a caller that only wants `buildDocumentScene` or `pickAt`
 * — a unit test, a future export path — can reach for those files directly and
 * keep React out of the picture. The barrel is the convenience, not the wall.
 *
 * DELIBERATELY NOT RE-EXPORTED, in the habit of state/index.ts:
 *
 * - The scene IR itself — `RenderScene`, `ScenePrimitive`, `RenderStyle`,
 *   `Representation` and friends. They belong to @starter/chem-render and
 *   every consumer should say so at the import site. Re-exporting them here
 *   would make `@/canvas` look like a second, client-side definition of the
 *   render vocabulary, and the first time the two got out of step the
 *   ambiguity would be load-bearing.
 * - chem-core's `Hit`, `AtomHit`, `BondHit` and `NO_HIT`, for the same reason:
 *   `pickAt` returns chem-core's hit type unchanged, on purpose, so that the
 *   editing tasks that come next consume the same value chem-core's own tests
 *   assert on.
 * - The internal helpers of each file. `panelToDraw`, the primitive bucketing
 *   in metrics.ts and the finite-vector guards are implementation detail; a
 *   caller reaching for one of them is a sign the public surface is missing
 *   something, and that is worth noticing rather than routing around.
 */

export * from "./scene-bridge";
export * from "./metrics";
export * from "./pick";
export * from "./fixture";
export * from "./SceneLayer";
export * from "./OverlayLayer";
export * from "./useCanvasGestures";
export * from "./EditorCanvas";

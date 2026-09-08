/**
 * A way to make the canvas throw on purpose, so the error boundary can be
 * proven in a real browser rather than asserted about.
 *
 * SAME FAMILY AS `?fixture=stress` in the editor page, and for the same
 * reason: the claim being tested — "a render exception does not cost the
 * drawing" — is a claim about the running app, and there is no honest way to
 * make the running app throw from the outside. The two in-repo alternatives
 * are worse. Unit-testing a boundary around a deliberately throwing child
 * proves the boundary and not the canvas; waiting for a real geometry bug is
 * not a test.
 *
 * IT IS ARMED, NOT IMMEDIATE. A canvas that threw on its first render would
 * have nothing unsaved to lose, which is precisely the case the criterion is
 * not about. Arming instead means the test can draw something first, arm, then
 * make one more edit — and the throw happens with an edit in the store that
 * autosave's debounce has not yet written.
 *
 * The arming function is only reachable when `?crash=canvas` is on the URL;
 * the editor page installs it on `window` there and nowhere else. What is left
 * in a production bundle is the boolean read below, once per canvas render.
 */

let armed = false;

export function armCanvasCrash(): void {
  armed = true;
}

/**
 * Called from `EditorCanvas`'s render body.
 *
 * IT STAYS ARMED, and the first attempt at this file disarmed on the first
 * throw — which silently did nothing. React retries a failed CONCURRENT render
 * synchronously before reporting the error, precisely so that a transient
 * failure does not take a tree down; a throw that only happens once therefore
 * gets swallowed as a "recoverable error" and the canvas renders normally.
 * Measured: charge went to +12, the canvas repainted, and no boundary
 * appeared. Staying armed makes the retry throw too, which is what actually
 * reaches `componentDidCatch`.
 *
 * There is no runaway loop in that: the boundary replaces the canvas with its
 * fallback and nothing renders this again until the page is reloaded, which
 * re-evaluates the module with `armed` back to false.
 */
export function consumeCanvasCrash(): void {
  if (!armed) return;
  throw new Error("Canvas crash requested by ?crash=canvas");
}

/** The key the arming function is installed under. Namespaced so it reads as
 *  this app's affordance and not as a global anyone may call. */
export const CRASH_GLOBAL = "__chemistrySketcherArmCanvasCrash";

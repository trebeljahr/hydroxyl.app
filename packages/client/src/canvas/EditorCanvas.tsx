"use client";

/**
 * The canvas: the one component that owns the `<svg>`, and the only place the
 * store, the scene and the pointer meet.
 *
 * THE TRANSFORM IS THE WHOLE CORRECTNESS ARGUMENT OF THIS FILE.
 *
 * A scene arrives from chem-render in FINAL PX WITH Y ALREADY FLIPPED — the
 * model-units-to-px scale and the y-negation both live in `modelToPx` over in
 * chem-render/src/style.ts, and nothing here may repeat either. What is left
 * for the view is a plain uniform affine map inside that px space, and it is
 * emitted as one SVG transform:
 *
 *     translate(w/2, h/2) scale(zoom) translate(-pan.x, -pan.y)
 *
 * SVG applies those right to left, so a scene point p is painted at
 *
 *     ((p - pan) * zoom) + size/2
 *
 * which is `toScreen(viewport, p)` from state/viewport.ts, term for term. That
 * equivalence is the point: the picture and the hit test are not two
 * implementations that happen to agree, they are the same map written once
 * forwards (here) and once backwards (`toModel`, which `pickAt` calls). Change
 * one and the other stops being its inverse, and the symptom — clicks landing
 * a few pixels off, worse the further you pan — points nowhere near the cause.
 *
 * For the same reason the transform is built from the VIEWPORT's own measured
 * size rather than the live DOM element's. The store's size is what `toModel`
 * will divide by when the next pointer event arrives; painting with the
 * element's size instead would make the two disagree for exactly the one frame
 * between a resize and the ResizeObserver callback, which is the frame during
 * which a user dragging the window edge is clicking.
 *
 * SELECTORS ONLY, NEVER THE WHOLE STATE. `useEditorStore` requires a selector
 * because subscribing to everything re-renders every subscriber on every
 * pointer-move frame of a drag — see the note on the hook in state/store.ts.
 *
 * EVERY MOLECULE EDIT GOES THROUGH THE INTERACTION MACHINE, and this file
 * contains none of the decisions. The pointer plumbing is `useCanvasGestures`,
 * the meaning of a gesture is `editor/interaction/machine.ts` (a pure reducer,
 * unit-tested with no DOM), and the store writes are the adapter's. What is
 * left here is the transform, the layers and the chrome. No draft ever crosses
 * into chem-core — chem-guard.ts would throw.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { ReactElement } from "react";
import { moleculeIssues } from "@/editor/derived";
import { movingAtomIds, useCanvasInteraction } from "@/editor/interaction";
import { toolDef } from "@/editor/tools";
import { describeAtom } from "@/editor/traversal";
import { editorStore, useEditorStore } from "@/state";

import { consumeCanvasCrash } from "./crash";
import { buildCanvasScene, renderStyleFor } from "./scene-bridge";
import { createSceneIndex, fitBounds } from "./metrics";
import { type PickContext } from "./pick";
import { SceneLayer } from "./SceneLayer";
import { OverlayLayer } from "./OverlayLayer";
import {
  useCanvasGestures,
  type CanvasGestureHandlers,
} from "./useCanvasGestures";

export interface EditorCanvasProps {
  readonly className?: string;
}

/**
 * A number safe to interpolate into an SVG transform.
 *
 * JavaScript switches to exponential notation below 1e-6, and `scale(3e-7)` is
 * a parse error to the SVG attribute grammar rather than a small number — the
 * whole transform is then dropped and the molecule vanishes. Sub-micropixel
 * pans are indistinguishable from zero on any display, so snapping them there
 * costs nothing and removes the failure mode. A non-finite value (a NaN pan
 * from a teardown-time measurement) becomes 0 for the same reason: an
 * un-transformed scene is recoverable, a broken attribute is not.
 */
function svgNumber(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.abs(n) < 1e-6 ? 0 : n;
}

export function EditorCanvas(props: EditorCanvasProps): ReactElement {
  // A no-op unless the `?crash=canvas` affordance armed it. See crash.ts: it
  // is how `CanvasErrorBoundary`'s promise — that a render exception does not
  // cost the drawing — is proven against the running app instead of asserted.
  consumeCanvasCrash();

  const svgRef = useRef<SVGSVGElement | null>(null);

  // Named `doc`, never `document`: this file runs in the browser and a local
  // binding called `document` shadows the global one, so the next hand to edit
  // here reaches for `document.querySelector` and silently gets a
  // `SketchDocument` back. The store already calls the field `document`; the
  // shortening stops at this file's scope.
  const doc = useEditorStore((state) => state.document);
  const selection = useEditorStore((state) => state.selection);
  const viewport = useEditorStore((state) => state.viewport);
  const hoveredAtomId = useEditorStore((state) => state.ui.hoveredAtomId);
  const hoveredBondId = useEditorStore((state) => state.ui.hoveredBondId);
  const focusedAtomId = useEditorStore((state) => state.ui.focusedAtomId);
  const tool = useEditorStore((state) => state.tool);

  // Reference identity is MEANINGFUL here, which is what makes this memo real
  // rather than decorative: the document slice assigns a new `SketchDocument`
  // only when something in the saved document actually changed, and returns
  // the same object for a no-op edit (chem-core hands back the input molecule
  // when an op changes nothing). So a pan, a hover or a selection change
  // re-renders this component without rebuilding the scene, and only a genuine
  // document change pays for a rebuild.
  const activePanelId = useEditorStore((state) => state.ui.activePanelId);
  // The switcher's panel when the canvas can edit through it, the default
  // structural panel otherwise — see `canvasPanelFor`.
  const scene = useMemo(
    () => buildCanvasScene(doc, activePanelId),
    [doc, activePanelId],
  );
  const index = useMemo(
    () => createSceneIndex(scene, doc.molecule),
    [scene, doc.molecule],
  );

  // The pick context, kept in a ref so the gesture callbacks below can have
  // EMPTY dependency lists.
  //
  // The context changes on every pan and zoom frame. Threading it through the
  // callbacks' deps instead would rebuild all six handlers — and therefore the
  // handler object the gesture hook holds — on every frame of a drag, which is
  // the one moment in the app where allocation actually shows. Reading the
  // latest value out of a ref is the standard escape, and the write below is a
  // LAYOUT effect on purpose. A passive `useEffect` is scheduled in a task
  // after paint, and the browser may dispatch an input event before that task
  // runs — so a handler could read the previous frame's viewport and pick
  // against a stale zoom. A layout effect flushes before the browser regains
  // control, which is the guarantee this pattern actually needs.
  const pickContext: PickContext = useMemo(
    () => ({ molecule: doc.molecule, viewport, index }),
    [doc.molecule, viewport, index],
  );
  const pickContextRef = useRef<PickContext>(pickContext);
  useLayoutEffect(() => {
    pickContextRef.current = pickContext;
  }, [pickContext]);

  // Actions come off `getState()` rather than through a selector subscription.
  // They are created once by the slice creators and never replaced, so
  // subscribing to them would add a listener that can never fire; taking them
  // inside the callback keeps the callbacks themselves free of dependencies.
  const handleResize = useCallback<CanvasGestureHandlers["onResize"]>((size) => {
    editorStore.getState().setViewportSize(size);
  }, []);

  const handlePan = useCallback<CanvasGestureHandlers["onPan"]>((deltaScreen) => {
    // Already negated by the gesture — `panBy` moves the VIEWPORT, and the
    // sign convention deliberately belongs to the gesture rather than to the
    // store. See the header of state/viewport.ts.
    editorStore.getState().panBy(deltaScreen);
  }, []);

  const handleZoom = useCallback<CanvasGestureHandlers["onZoom"]>(
    (canvasAnchor, factor) => {
      editorStore.getState().zoomAt(canvasAnchor, factor);
    },
    [],
  );

  // Hover, selection and every editing gesture live in the interaction
  // machine. This component supplies it a pick context and nothing else.
  const { handlers: interactionHandlers, overlay } =
    useCanvasInteraction(pickContextRef);

  const gestureHandlers = useMemo<CanvasGestureHandlers>(
    () => ({
      ...interactionHandlers,
      onZoom: handleZoom,
      onPan: handlePan,
      onResize: handleResize,
    }),
    [interactionHandlers, handleZoom, handlePan, handleResize],
  );

  const { isPanning, rootHandlers } = useCanvasGestures(svgRef, gestureHandlers, {
    panTool: tool === "pan",
  });

  const fitToScene = useCallback(() => {
    // The literal 0 is the FRACTIONAL margin and it is deliberate.
    // `scene.bounds` has already been grown by `style.marginPx` on all four
    // sides, so the preset's whitespace is inside the box being framed. Asking
    // `zoomToFit` for its default 5% on top would inset the figure a second
    // time and leave a fresh document looking small for no stated reason.
    editorStore.getState().zoomToFit(fitBounds(scene), 0);
  }, [scene]);

  // Fit once per document, as soon as the canvas has a measured size.
  //
  // GUARDED ON `doc.id`, NOT ON THE DOCUMENT REFERENCE. The reference changes
  // on every edit — `touchDocument` mints a new object to stamp `modifiedAt` —
  // and this canvas now commits on every pointer-move frame of a drag, so a
  // reference guard would re-frame and re-scale the view sixty times a second
  // while the user is drawing, sliding the structure out from under the
  // cursor. `id` is minted per document and preserved across every edit, which
  // is exactly the "is this a different drawing" question being asked. It was
  // invisible while the canvas was read-only.
  //
  // Re-running on every size change would fight the user instead, snapping
  // their zoom back the moment they resized the window after scrolling in on a
  // substituent — so the size is a precondition, not a trigger. `zoomToFit` on
  // a zero-size viewport recentres without touching the zoom, which would
  // consume the one shot this effect gets and leave the molecule at 100%
  // forever.
  const fittedDocumentIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (fittedDocumentIdRef.current === doc.id) return;
    if (viewport.size.width <= 0 || viewport.size.height <= 0) return;
    fittedDocumentIdRef.current = doc.id;
    fitToScene();
  }, [doc.id, viewport.size.width, viewport.size.height, fitToScene]);

  const { width, height } = viewport.size;
  const transform =
    `translate(${svgNumber(width / 2)}, ${svgNumber(height / 2)}) ` +
    `scale(${svgNumber(viewport.zoom)}) ` +
    `translate(${svgNumber(-viewport.pan.x)}, ${svgNumber(-viewport.pan.y)})`;

  // Recomputed per document, which during a drag is per frame. Measured at
  // 0.18 ms for a 300-heavy-atom structure — a tenth of the frame budget.
  //
  // Through `moleculeIssues` rather than chem-core directly, so these badges
  // and the status bar's count are ONE walk of the molecule. It composes both
  // families: valence errors and the structural ones stereo perception finds
  // (a wedge on a non-stereocentre, a wedge drawn backwards). The shared cache
  // does not help mid-drag — a per-move commit mints a new Molecule every
  // frame and every frame misses — but it makes every re-render that changed
  // nothing chemical free, which is most of them.
  const issues = useMemo(() => moleculeIssues(doc.molecule), [doc.molecule]);

  // The atoms the rotate handle is placed around: exactly the ones a drag over
  // the selection would move, so the handle can never appear beside a
  // selection that has nothing to turn.
  const handleAtomIds = useMemo(
    () => movingAtomIds(doc.molecule, selection),
    [doc.molecule, selection],
  );

  const hovering = hoveredAtomId !== null || hoveredBondId !== null;
  // The TOOL owns the resting cursor, and the transient states win over it: a
  // pan in progress is `grabbing` whatever tool is held, and something under
  // the pointer is `pointer` unless the tool has said otherwise. The tool
  // cursor is what tells a user holding the eraser that the next click
  // deletes, before they find out by deleting.
  const toolCursor = toolDef(tool).cursor;
  const cursor = isPanning
    ? "grabbing"
    : hovering && toolCursor === "default"
      ? "pointer"
      : toolCursor;

  // THE CANVAS PAINTS ITS OWN GROUND, and it is the render style's, not a
  // Tailwind class. `SCREEN_STYLE` draws near-black bonds on white; a dark UI
  // theme with a transparent canvas would leave the structure invisible, and a
  // hardcoded `bg-white` would be a second place that knows what a figure's
  // background is. `PUBLICATION_STYLE` deliberately declares none — a figure
  // exported for a journal has no background rect — so the `??` is what keeps
  // the EDITOR usable under that preset without inventing one for the export.
  const ground = renderStyleFor(doc).colors.background ?? "#ffffff";

  // Focus has to land SOMEWHERE, or the first arrow press has nothing to move
  // from and the canvas is a tab stop that does nothing. Seeding only when the
  // held id is stale keeps a Tab away and back from resetting the traversal.
  const handleFocus = useCallback(() => {
    const state = editorStore.getState();
    const mol = state.document.molecule;
    const held = state.ui.focusedAtomId;
    if (held !== null && Object.hasOwn(mol.atoms, held)) return;
    state.setFocusedAtom(mol.atomIds[0] ?? null);
  }, []);

  return (
    <div
      className={`relative h-full w-full ${props.className ?? ""}`}
      style={{ background: ground }}
    >
      <svg
        data-canvas-root="true"
        ref={svgRef}
        width="100%"
        height="100%"
        /*
          ONE TAB STOP FOR THE WHOLE DRAWING, with the arrow keys roving
          between atoms from there. A tab stop per atom is the obvious
          alternative and it is unusable: a fused tetracycle would put twenty
          stops between the tool rail and the properties panel. `application`
          rather than `img` or `group` because the arrow keys do something
          here, and a screen reader in browse mode would otherwise intercept
          them before the editor saw one.
        */
        tabIndex={0}
        role="application"
        aria-label="Structure canvas"
        // ADVERTISED, because an undiscoverable modifier is not an
        // accessibility feature. The bare arrows follow bonds and Shift makes
        // them step through every atom in document order; the second is the
        // one that carries the completeness guarantee, and until it was named
        // here a user had no way to learn it existed.
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight"
        aria-describedby="canvas-focus-help canvas-focus-status"
        onFocus={handleFocus}
        // `touchAction: none` so a one-finger drag pans the canvas instead of
        // scrolling the page — without it the browser claims the gesture
        // before the first pointermove reaches us.
        style={{ touchAction: "none", cursor, outline: "none" }}
        className="focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset"
        {...rootHandlers}
      >
        <g transform={transform}>
          <SceneLayer scene={scene} />
          <OverlayLayer
            index={index}
            selection={selection}
            hoveredAtomId={hoveredAtomId}
            hoveredBondId={hoveredBondId}
            interaction={overlay}
            issues={issues}
            handleAtomIds={handleAtomIds}
            focusedAtomId={focusedAtomId}
          />
        </g>
      </svg>

      {/*
        WHAT A SCREEN READER HEARS when the arrow keys walk the structure.
        `aria-live` rather than a label on the `<svg>`: the canvas's name does
        not change as focus moves, the position does, and re-labelling the
        widget on every arrow press is what makes some readers announce the
        role again each time. Visually hidden rather than absent — sighted
        users have the dashed focus ring.
      */}
      {/* Static, and read once when focus enters the widget: what the arrow
          keys do here, and which modifier guarantees every atom. Separate
          from the live region below because a description that changed on
          every press would be re-read as if it were news. */}
      <div id="canvas-focus-help" className="sr-only">
        Arrow keys move between bonded atoms. Hold Shift to step through every
        atom in the structure in order.
      </div>

      <div
        id="canvas-focus-status"
        role="status"
        aria-live="polite"
        className="sr-only"
      >
        {focusedAtomId === null
          ? ""
          : describeAtom(doc.molecule, focusedAtomId)}
      </div>
    </div>
  );
}

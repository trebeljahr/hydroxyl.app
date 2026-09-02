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
 * NOTHING HERE MUTATES THE MOLECULE. This task is view-only: hover, select,
 * pan, zoom. No draft ever crosses into chem-core (chem-guard.ts would throw),
 * and the document is read, never written.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { ReactElement } from "react";
import type { Vec2 } from "@starter/chem-core";

import { editorStore, useEditorStore } from "@/state";

import { buildDocumentScene } from "./scene-bridge";
import { createSceneIndex, fitBounds } from "./metrics";
import { pickAt, type PickContext } from "./pick";
import { SceneLayer } from "./SceneLayer";
import { OverlayLayer } from "./OverlayLayer";
import {
  useCanvasGestures,
  type CanvasGestureHandlers,
  type CanvasPointerModifiers,
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

  // Reference identity is MEANINGFUL here, which is what makes this memo real
  // rather than decorative: the document slice assigns a new `SketchDocument`
  // only when something in the saved document actually changed, and returns
  // the same object for a no-op edit (chem-core hands back the input molecule
  // when an op changes nothing). So a pan, a hover or a selection change
  // re-renders this component without rebuilding the scene, and only a genuine
  // document change pays for a rebuild.
  const scene = useMemo(() => buildDocumentScene(doc), [doc]);
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

  const handleHover = useCallback((canvasPoint: Vec2) => {
    const { setHoveredAtom, setHoveredBond } = editorStore.getState();
    const hit = pickAt(pickContextRef.current, canvasPoint);
    // BOTH are written on every hover, one of them to null. Writing only the
    // half that matched leaves the other id set from wherever the pointer was
    // last, and the overlay then draws two halos — one of them on an atom the
    // pointer left three bonds ago. Both setters no-op on an unchanged id, so
    // the common case still notifies nobody.
    setHoveredAtom(hit.kind === "atom" ? hit.atomId : null);
    setHoveredBond(hit.kind === "bond" ? hit.bondId : null);
  }, []);

  const handleHoverEnd = useCallback(() => {
    const { setHoveredAtom, setHoveredBond } = editorStore.getState();
    setHoveredAtom(null);
    setHoveredBond(null);
  }, []);

  const handleSelect = useCallback(
    (canvasPoint: Vec2, modifiers: CanvasPointerModifiers) => {
      const state = editorStore.getState();
      const hit = pickAt(pickContextRef.current, canvasPoint);

      if (hit.kind === "atom") {
        if (modifiers.shift) state.toggleAtom(hit.atomId);
        else state.selectAtoms([hit.atomId]);
        return;
      }

      if (hit.kind === "bond") {
        if (modifiers.shift) state.toggleBond(hit.bondId);
        else state.selectBonds([hit.bondId]);
        return;
      }

      // Shift-click on empty space does NOTHING. A shift-click is the "add to
      // what I already picked" gesture, and a multi-select is assembled by
      // aiming at small targets — missing one of them by two pixels must not
      // discard the four atoms already collected. Only an unmodified click on
      // background means "I am done with this selection".
      if (modifiers.shift) return;
      state.clearSelection();
    },
    [],
  );

  const gestureHandlers = useMemo<CanvasGestureHandlers>(
    () => ({
      onHover: handleHover,
      onHoverEnd: handleHoverEnd,
      onSelect: handleSelect,
      onZoom: handleZoom,
      onPan: handlePan,
      onResize: handleResize,
    }),
    [handleHover, handleHoverEnd, handleSelect, handleZoom, handlePan, handleResize],
  );

  const { isPanning, rootHandlers } = useCanvasGestures(svgRef, gestureHandlers);

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
  // Guarded on the document REFERENCE rather than on a "have I fitted yet"
  // boolean: opening a second document has to reframe, and re-running on every
  // size change would fight the user, snapping their zoom back the moment they
  // resized the window after scrolling in on a substituent. The size check is
  // what makes the wait explicit — `zoomToFit` on a zero-size viewport
  // recentres without touching the zoom, which would consume the one shot this
  // effect gets and leave the molecule at 100% forever.
  const fittedDocumentRef = useRef<unknown>(null);
  useEffect(() => {
    if (fittedDocumentRef.current === doc) return;
    if (viewport.size.width <= 0 || viewport.size.height <= 0) return;
    fittedDocumentRef.current = doc;
    fitToScene();
  }, [doc, viewport.size.width, viewport.size.height, fitToScene]);

  const { width, height } = viewport.size;
  const transform =
    `translate(${svgNumber(width / 2)}, ${svgNumber(height / 2)}) ` +
    `scale(${svgNumber(viewport.zoom)}) ` +
    `translate(${svgNumber(-viewport.pan.x)}, ${svgNumber(-viewport.pan.y)})`;

  const hovering = hoveredAtomId !== null || hoveredBondId !== null;
  const cursor = isPanning ? "grabbing" : hovering ? "pointer" : "default";

  const zoomPercent = Math.round(viewport.zoom * 100);

  return (
    <div className={`relative h-full w-full ${props.className ?? ""}`}>
      <svg
        data-canvas-root="true"
        ref={svgRef}
        width="100%"
        height="100%"
        // `touchAction: none` so a one-finger drag pans the canvas instead of
        // scrolling the page — without it the browser claims the gesture
        // before the first pointermove reaches us.
        style={{ touchAction: "none", cursor }}
        {...rootHandlers}
      >
        <g transform={transform}>
          <SceneLayer scene={scene} />
          <OverlayLayer
            index={index}
            selection={selection}
            hoveredAtomId={hoveredAtomId}
            hoveredBondId={hoveredBondId}
          />
        </g>
      </svg>

      {/*
        The minimum chrome a pannable canvas needs to be recoverable: a way
        back to the molecule and a statement of where you are. Deliberately NOT
        a toolbar — there are no editing tools in this task, and a strip that
        grew buttons for them here would have to be torn out when the real one
        arrives. It sits outside the `<svg>` so the canvas root stays the only
        element carrying pointer handlers.
      */}
      <div className="text-muted-foreground bg-background/80 absolute bottom-3 right-3 flex items-center gap-1 rounded-md border p-1 text-xs backdrop-blur">
        <button
          type="button"
          onClick={fitToScene}
          className="hover:bg-muted rounded px-2 py-1"
        >
          Fit
        </button>
        <button
          type="button"
          onClick={() => editorStore.getState().resetViewport()}
          className="hover:bg-muted rounded px-2 py-1"
        >
          Reset
        </button>
        <span className="w-12 text-right font-mono tabular-nums">
          {zoomPercent}%
        </span>
      </div>
    </div>
  );
}

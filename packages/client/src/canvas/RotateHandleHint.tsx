/**
 * The words beside the rotate handle, shown while the pointer rests on it.
 *
 * HTML IN SCREEN SPACE, NOT SVG IN SCENE SPACE. Scene-px type scales with the
 * zoom, and at the ~500% a fitted structure opens at, or the 20% a large one
 * does, it is either a banner or a smudge. A positioned element outside the
 * `<svg>` keeps a fixed, legible size, takes the UI theme's popover colours
 * instead of the render style's, and — like the overlay — can never reach an
 * export, because it is not in the scene at all.
 *
 * `aria-hidden` because it describes a pointer affordance the keyboard cannot
 * reach; announcing "drag to rotate" to someone who cannot drag is noise.
 */

import { useLayoutEffect, useRef, useState } from "react";
import type { ReactElement } from "react";

import type { Vec2 } from "@starter/chem-core";

import { ROTATE_SNAP } from "@/editor/interaction";
import { toScreen } from "@/state";
import type { Viewport, ViewportSize } from "@/state";

import { ROTATE_HANDLE_RADIUS_PX } from "./handles";
import type { RotateHandleGeometry } from "./handles";

/** Clear screen px between the handle's ink and the hint's box. */
const HINT_GAP_PX = 8;

/**
 * The hint's size before it has been measured, screen px — and for good in
 * jsdom, which measures everything as zero. Close to what Chromium renders
 * the text at, so the first frame is already placed where the measured one
 * will be.
 */
const HINT_SIZE_ESTIMATE: ViewportSize = { width: 220, height: 26 };

/** Derived, so the hint cannot promise a step the machine does not snap to. */
const SNAP_DEGREES = Math.round((ROTATE_SNAP * 180) / Math.PI);

export const ROTATE_HINT_TEXT = "Drag to rotate";
export const ROTATE_HINT_DETAIL = `Shift snaps to ${SNAP_DEGREES}°`;

export type RotateHintSide = "right" | "left" | "above" | "below";

/**
 * Which side of the handle the hint goes, given where the handle is on the
 * canvas (screen px) and how big the hint is.
 *
 * AWAY FROM THE SELECTION FIRST. The handle sits on a circle round the
 * selection's centre, so "outward" is the direction from that centre to the
 * handle: its horizontal half first, since the text runs horizontally and a
 * handle straight above the selection has empty canvas to its right; its
 * vertical half next. Only then the inward sides — a hint across the atoms
 * is still better than one cut off by the canvas edge. When nothing fits,
 * the outward horizontal side, and the canvas clips what it must.
 */
export function placeRotateHint(
  handle: Vec2,
  outward: Vec2,
  canvas: ViewportSize,
  hint: ViewportSize,
): RotateHintSide {
  const reach = ROTATE_HANDLE_RADIUS_PX + HINT_GAP_PX;
  const level =
    handle.y - hint.height / 2 >= 0 && handle.y + hint.height / 2 <= canvas.height;
  const centred =
    handle.x - hint.width / 2 >= 0 && handle.x + hint.width / 2 <= canvas.width;
  const fits: Record<RotateHintSide, boolean> = {
    right: level && handle.x + reach + hint.width <= canvas.width,
    left: level && handle.x - reach - hint.width >= 0,
    above: centred && handle.y - reach - hint.height >= 0,
    below: centred && handle.y + reach + hint.height <= canvas.height,
  };
  // A handle straight above or below the centre has no horizontal "outward";
  // right is the tie-break, as "above" is for one level with it.
  const horizontal: RotateHintSide = outward.x < -1e-6 ? "left" : "right";
  const vertical: RotateHintSide = outward.y > 1e-6 ? "below" : "above";
  const order: readonly RotateHintSide[] = [
    horizontal,
    vertical,
    horizontal === "right" ? "left" : "right",
    vertical === "above" ? "below" : "above",
  ];
  return order.find((side) => fits[side]) ?? horizontal;
}

/** Where the box's anchor point goes, and how the box hangs off it. */
function anchorFor(
  side: RotateHintSide,
  handle: Vec2,
): { left: number; top: number; transform: string } {
  const reach = ROTATE_HANDLE_RADIUS_PX + HINT_GAP_PX;
  switch (side) {
    case "right":
      return { left: handle.x + reach, top: handle.y, transform: "translate(0, -50%)" };
    case "left":
      return { left: handle.x - reach, top: handle.y, transform: "translate(-100%, -50%)" };
    case "above":
      return { left: handle.x, top: handle.y - reach, transform: "translate(-50%, -100%)" };
    case "below":
      return { left: handle.x, top: handle.y + reach, transform: "translate(-50%, 0)" };
  }
}

export interface RotateHandleHintProps {
  readonly geometry: RotateHandleGeometry;
  readonly viewport: Viewport;
}

export function RotateHandleHint({
  geometry,
  viewport,
}: RotateHandleHintProps): ReactElement | null {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<ViewportSize>(HINT_SIZE_ESTIMATE);

  // Measured once, before paint, so the side is chosen from the real box
  // rather than a guess at the font. The text never changes while mounted.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (box === undefined || box.width <= 0 || box.height <= 0) return;
    setSize((previous) =>
      previous.width === box.width && previous.height === box.height
        ? previous
        : { width: box.width, height: box.height },
    );
  }, []);

  const handle = toScreen(viewport, geometry.handle);
  if (!Number.isFinite(handle.x) || !Number.isFinite(handle.y)) return null;

  const side = placeRotateHint(
    handle,
    { x: geometry.handle.x - geometry.pivot.x, y: geometry.handle.y - geometry.pivot.y },
    viewport.size,
    size,
  );

  return (
    <div
      ref={ref}
      data-canvas-hint="rotate"
      data-hint-side={side}
      aria-hidden="true"
      className="bg-popover text-popover-foreground pointer-events-none absolute z-10 whitespace-nowrap rounded-md border px-2 py-1 text-xs shadow-sm"
      style={anchorFor(side, handle)}
    >
      <span className="font-medium">{ROTATE_HINT_TEXT}</span>
      <span className="text-muted-foreground"> · {ROTATE_HINT_DETAIL}</span>
    </div>
  );
}

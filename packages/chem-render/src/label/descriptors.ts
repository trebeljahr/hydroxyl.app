/**
 * Where an `(R)`, `(S)`, `(E)` or `(Z)` goes — one descriptor at a time.
 *
 * THE SEARCH NO LONGER LIVES HERE. It moved to `label/annotations.ts`, which
 * places descriptors, alpha/beta labels, locants and torsion labels in one
 * pass ordered by decision 17, so a locant and a descriptor on the same atom
 * can never each pick "the" free slot. `buildScene` calls that pass directly.
 *
 * This module is the single-descriptor convenience kept for callers that
 * placed one descriptor against their own obstacles: it is exactly
 * `placeAnnotation` with kind `"descriptor"`, so its numbers are the
 * annotation ladder's numbers and cannot drift from them.
 */

import type { AtomId } from "@starter/chem-core";

import type { ScenePoint } from "../scene/types.js";
import type { RenderStyle } from "../style.js";
import { ANNOTATION_PLACEMENT, placeAnnotation } from "./annotations.js";
import type { AnnotationSegment } from "./annotations.js";
import type { LabelBox, LabelObstacle } from "./placement.js";

/** The annotation ladder's constants, under the name descriptors knew them by. */
export const DESCRIPTOR_PLACEMENT = ANNOTATION_PLACEMENT;

/** A drawn segment a descriptor must not lie across. */
export type DescriptorSegment = AnnotationSegment;

export interface DescriptorPlacement {
  /**
   * Origin for a middle-anchored run, ON THE ALPHABETIC BASELINE.
   *
   * The search centres the run on its candidate point, but the origin handed
   * back is already dropped to the baseline, because a `TextRunPrimitive` has
   * no baseline mode: see its `origin` for why.
   */
  readonly origin: ScenePoint;
  readonly fontSizePx: number;
  /** The measured box, for the caller to feed back in as an obstacle. */
  readonly box: LabelBox;
  /**
   * False when no candidate was clear, and a fallback was taken anyway. A
   * descriptor is never dropped for want of space. This entry point takes no
   * atom centres, so decision 35's proximity test does not apply here.
   */
  readonly clear: boolean;
}

export interface DescriptorRequest {
  readonly text: string;
  /** Where the annotation belongs: an atom centre, or a bond's midpoint. */
  readonly anchor: ScenePoint;
  /** Scene px. The direction tried first. */
  readonly preferred: ScenePoint;
  readonly style: RenderStyle;
  /** Label glyphs, drawn bond lines, and descriptors already placed. */
  readonly obstacles: readonly LabelObstacle[];
  readonly segments: readonly DescriptorSegment[];
}

// The source only names the annotation's id, which this entry point does not
// return; any atom id gives the same geometry.
const ANONYMOUS_ATOM = "a0" as AtomId;

/** Places one descriptor. Always returns a placement; see `clear`. */
export function placeDescriptor(request: DescriptorRequest): DescriptorPlacement {
  const placed = placeAnnotation(
    {
      kind: "descriptor",
      source: { kind: "atom", atomId: ANONYMOUS_ATOM },
      text: request.text,
      anchor: request.anchor,
      preferred: request.preferred,
    },
    {
      style: request.style,
      obstacles: request.obstacles,
      segments: request.segments,
    },
  );
  return {
    origin: placed.origin,
    fontSizePx: placed.fontSizePx,
    box: placed.box,
    clear: placed.clear,
  };
}

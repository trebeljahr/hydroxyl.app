/**
 * The two scheme marks that are only text: the stoichiometric coefficient
 * before a species, and a free label at a stored position.
 *
 * A COEFFICIENT (decision 204) is set at the LABEL size, not the formal-charge
 * size and not the descriptor size: the 2 of `2 H2O` is as large as the
 * formula it multiplies. It sits a quarter em before its species' ink,
 * centred on the species' box by the cap band, and its box then widens the
 * species' box (species-box.ts `extend`), so an arrow or a plus sign keeps
 * clear of it exactly as it keeps clear of the structure.
 *
 * A FREE LABEL is printed exactly as typed, centred on its `at` point
 * horizontally and on the cap band vertically, like an atom label. It anchors
 * to the MODEL FRAME (decision 112), so only a panel drawing the molecule at
 * its own coordinates places it.
 *
 * Both are measured through the one measurer, and an unmeasured code point is
 * a finding, never an exception (decision 206).
 */

import type { ScenePoint, TextRunPrimitive } from "../scene/types.js";
import type { CoefficientAnnotation, TextAnnotation } from "../scheme/annotation.js";
import { modelToPx } from "../style.js";
import type { RenderStyle } from "../style.js";
import { EM_CAP_HEIGHT } from "../text/metrics.js";
import type { Measurer } from "../text/measurer.js";
import { unmeasuredCodePoints } from "../text/typography.js";
import { formatQuantity } from "./conditions.js";
import { annotationSource, primitivesBox, SCHEME_LAYOUT, schemeMarkPrimitiveId } from "./scheme-mark.js";
import type { SchemeMarkFinding, SchemeMarkLayout, SchemeMarkSite } from "./scheme-mark.js";
import { boxCentre } from "./species-box.js";

export interface CoefficientLayout extends SchemeMarkLayout {
  readonly text: string;
  /** The run's baseline origin; the run is end-anchored there. */
  readonly origin: ScenePoint;
}

export interface SchemeTextLayout extends SchemeMarkLayout {
  /** The run's baseline origin; the run is middle-anchored there. */
  readonly origin: ScenePoint;
}

function findingsFor(text: string, measurer: Measurer, style: RenderStyle): SchemeMarkFinding[] {
  const codePoints = unmeasuredCodePoints(text, measurer, style.fontFamily);
  return codePoints.length === 0 ? [] : [{ kind: "unmeasured-glyphs", codePoints }];
}

/** The coefficient, before its species' box; undefined when the panel draws none of it. */
export function layoutCoefficient(annotation: CoefficientAnnotation, site: SchemeMarkSite): CoefficientLayout | undefined {
  const { style, measurer } = site;
  const box = site.boxes.boxOf(annotation.species);
  if (box === undefined) return undefined;
  const text = formatQuantity(annotation.value);
  const size = style.fontSizePx;
  const origin = {
    x: box.minX - SCHEME_LAYOUT.coefficientGapEm * size,
    y: boxCentre(box).y + (EM_CAP_HEIGHT * size) / 2,
  };
  const run: TextRunPrimitive = {
    id: schemeMarkPrimitiveId(annotation.id, "coefficient"),
    source: annotationSource(annotation.id),
    type: "textRun",
    origin,
    spans: [{ text }],
    fontFamily: style.fontFamily,
    fontSizePx: size,
    fill: { color: style.colors.label },
    anchor: "end",
  };
  const primitives = [run];
  return {
    annotationId: annotation.id,
    primitives,
    box: primitivesBox(primitives, style),
    findings: findingsFor(text, measurer, style),
    text,
    origin,
  };
}

/** The free label, centred on its stored point. Always laid out: the caller checks the frame. */
export function layoutSchemeText(annotation: TextAnnotation, style: RenderStyle, measurer: Measurer): SchemeTextLayout {
  const size = style.fontSizePx;
  const at = modelToPx(style, annotation.at);
  const origin = { x: at.x, y: at.y + (EM_CAP_HEIGHT * size) / 2 };
  const run: TextRunPrimitive = {
    id: schemeMarkPrimitiveId(annotation.id, "text"),
    source: annotationSource(annotation.id),
    type: "textRun",
    origin,
    spans: [{ text: annotation.text }],
    fontFamily: style.fontFamily,
    fontSizePx: size,
    fill: { color: style.colors.label },
    anchor: "middle",
  };
  const primitives = [run];
  return {
    annotationId: annotation.id,
    primitives,
    box: primitivesBox(primitives, style),
    findings: findingsFor(annotation.text, measurer, style),
    origin,
  };
}

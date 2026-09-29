/**
 * The projections the panel chooser lists as PLANNED: named, described, and
 * not pickable.
 *
 * WHY THEY ARE SHOWN AT ALL. A chemist looking for a Fischer or a Haworth of a
 * sugar reads a view list with no Fischer in it as "this tool does not do
 * that", and stops looking. Listing them greyed out, with the reason, says
 * instead "not yet", and says what each one would show, which is most of what
 * a reader choosing between them needs.
 *
 * WHY THEY ARE NOT VIEW KINDS. Decision 128 made a projection an axis
 * ORTHOGONAL to the view kind: a panel keeps its `representation.kind` and
 * stores the projection in `Panel.view`, so a Fischer can be drawn skeletal or
 * with explicit hydrogens. Each entry therefore names the chem-core template a
 * panel will store for it (`stored`), and none of them will ever appear in
 * `VIEW_KINDS`.
 *
 * WHY THEY ARE STILL NOT PICKABLE. The document can store every one of these
 * views, and the engine already draws a Fischer, but nothing in the editor
 * sets `Panel.view` or draws a stored one in a panel yet. That is the task
 * wiring projections into the chooser, the commands and the gestures
 * (`editor-projection-commands-and-gestures`).
 *
 * WHEN ONE SHIPS, IT LEAVES THIS LIST. `FigurePanelChooser.test.tsx` clicks
 * every control of the chooser and asserts that none stores a view, so the
 * day one does, that test fails until its planned entry goes: a projection
 * cannot be offered twice, once live and once as "not built yet".
 * `planned-projections.test.ts` checks each `stored` template against
 * chem-core's list, so a renamed template cannot leave an entry naming
 * nothing.
 *
 * The seven match the epic's projection tasks. Steroid alpha/beta and the
 * wedge-dash policy are left out: they are marking conventions on the planar
 * frame Mills uses, not separate pictures a chemist would pick from a list.
 * The torsion overlay is left out for the same reason: it labels the drawing
 * rather than redrawing it.
 */

import type { ProjectionView } from "@starter/chem-core";

/** A projection as a panel stores it: a frame kind and one of its templates. */
export type StoredProjection = ProjectionView extends infer V
  ? V extends ProjectionView
    ? Pick<V, "kind" | "template">
    : never
  : never;

export interface PlannedProjection {
  /** Stable hook for tests; never stored in a document. */
  readonly id: string;
  /** The name a chemist looks for. */
  readonly title: string;
  /** One sentence: what the projection draws, so the list teaches as it refuses. */
  readonly shows: string;
  /** The `Panel.view` kind and template this entry becomes when it ships. */
  readonly stored: StoredProjection;
}

export const PLANNED_PROJECTIONS: readonly PlannedProjection[] = Object.freeze([
  {
    id: "fischer",
    title: "Fischer",
    shows: "The carbon chain runs down the page; horizontal bonds point toward you.",
    stored: { kind: "chain", template: "fischer" },
  },
  {
    id: "haworth",
    title: "Haworth",
    shows: "A sugar ring drawn flat and edge-on, each group pointing up or down.",
    stored: { kind: "ring", template: "haworth" },
  },
  {
    id: "chair",
    title: "Chair",
    shows: "A six-membered ring in its chair shape, each bond axial or equatorial.",
    stored: { kind: "ring", template: "chair" },
  },
  {
    id: "newman",
    title: "Newman",
    shows: "The view straight down one bond: the front carbon's groups over the back's.",
    stored: { kind: "sightedBond", template: "newman" },
  },
  {
    id: "sawhorse",
    title: "Sawhorse",
    shows: "One bond seen from an angle, with the groups on both carbons.",
    stored: { kind: "sightedBond", template: "sawhorse" },
  },
  {
    id: "natta",
    title: "Natta",
    shows: "A polymer backbone as a flat zig-zag, each repeat unit's groups above or below.",
    stored: { kind: "chain", template: "natta" },
  },
  {
    id: "mills",
    title: "Mills",
    shows: "A fused ring system drawn flat, with wedges for groups above or below it.",
    stored: { kind: "planar", template: "mills" },
  },
]);

/**
 * The one reason every planned entry gives. Shared rather than per entry
 * because it is the same reason for all seven: the editor cannot yet set a
 * panel's projection or draw one in a panel.
 */
export const PLANNED_PROJECTION_REASON =
  "Not built yet. The editor cannot show these projections in a figure panel.";

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
 * WHY THEY ARE NOT VIEW KINDS. None of these has a renderer, and whether a
 * projection becomes a seventh `ViewKind` or an axis orthogonal to it is an
 * open decision in the projection epic (`projection-engine-frames-and-layout`).
 * A planned entry in `VIEW_KINDS` would be a panel the document can store and
 * nothing can draw. So this list lives in the client, as copy, and touches no
 * type the document codec reads.
 *
 * WHEN ONE SHIPS, IT LEAVES THIS LIST. `planned-projections.test.ts` fails the
 * moment a planned id or title also appears among the real view kinds, so a
 * projection cannot be offered twice, once live and once as "not built yet".
 *
 * The seven match the epic's projection tasks. Steroid alpha/beta and the
 * wedge-dash policy are left out: they are marking conventions on the planar
 * frame Mills uses, not separate pictures a chemist would pick from a list.
 */

export interface PlannedProjection {
  /** Stable hook for tests; never stored in a document. */
  readonly id: string;
  /** The name a chemist looks for. */
  readonly title: string;
  /** One sentence: what the projection draws, so the list teaches as it refuses. */
  readonly shows: string;
}

export const PLANNED_PROJECTIONS: readonly PlannedProjection[] = Object.freeze([
  {
    id: "fischer",
    title: "Fischer",
    shows: "The carbon chain runs down the page; horizontal bonds point toward you.",
  },
  {
    id: "haworth",
    title: "Haworth",
    shows: "A sugar ring drawn flat and edge-on, each group pointing up or down.",
  },
  {
    id: "chair",
    title: "Chair",
    shows: "A six-membered ring in its chair shape, each bond axial or equatorial.",
  },
  {
    id: "newman",
    title: "Newman",
    shows: "The view straight down one bond: the front carbon's groups over the back's.",
  },
  {
    id: "sawhorse",
    title: "Sawhorse",
    shows: "One bond seen from an angle, with the groups on both carbons.",
  },
  {
    id: "natta",
    title: "Natta",
    shows: "A polymer backbone as a flat zig-zag, each repeat unit's groups above or below.",
  },
  {
    id: "mills",
    title: "Mills",
    shows: "A fused ring system drawn flat, with wedges for groups above or below it.",
  },
]);

/**
 * The one reason every planned entry gives. Shared rather than per entry
 * because it is the same reason for all seven: each needs the projection
 * engine, which does not exist yet.
 */
export const PLANNED_PROJECTION_REASON =
  "Not built yet. Each of these needs a projection engine that is still being planned.";

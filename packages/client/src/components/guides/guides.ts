/**
 * Every guide the site has, and which of them Rico has released (decision 243).
 *
 * ── RELEASING A GUIDE IS ONE LINE ──────────────────────────────────────────
 *
 * A guide is written, merged and served at its own URL long before anyone is
 * sent to it: Rico reads it on the live site first. Until then `released` is
 * null, and the guide is out of the `/guides` index, out of `sitemap.xml`, out
 * of every nav, and its page asks crawlers not to index it. Setting
 * `released` to the day it goes out puts it in all four places at once.
 *
 * A date rather than a boolean, because the index lists the newest first and
 * the date is the one fact the index needs that the page does not have.
 *
 * ── NO IMPORTS, ON PURPOSE ─────────────────────────────────────────────────
 *
 * This module is data. The pages, the sitemap, the social-card script and the
 * e2e specs all read it, and the specs import it by relative path, where
 * neither `@/` nor a workspace package resolves. What each guide's figures
 * ARE lives in `example-document.ts`, keyed by the example names here.
 */

export interface GuideFigure {
  /** The `?example=` name its "Open this figure in the editor" link opens
   *  (decision 127). Defined in `EXAMPLES`, `example-document.ts`. */
  readonly example: string;
  /** What the figure shows, for a reader who cannot see it. The social card
   *  carries it as its alt text when this is the guide's first figure. */
  readonly alt: string;
}

export interface Guide {
  /** The path segment: `/guides/<slug>`, `guides-<slug>.html` in the export
   *  (decision 137). Each slug has its own folder under `app/guides/`, since
   *  no route may use a dynamic segment. */
  readonly slug: string;
  /** The page's `<h1>`, its `<title>` and the social card's headline. */
  readonly title: string;
  /** The meta description and the line under the title in the index. */
  readonly description: string;
  /** `YYYY-MM-DD` the day Rico released it, or null while he has not. */
  readonly released: string | null;
  /** In page order. The first is the one the social card draws (decision 245). */
  readonly figures: readonly [GuideFigure, ...GuideFigure[]];
}

export const GUIDES: readonly Guide[] = [
  {
    slug: "journal-figure-size",
    title: "How big should a chemical structure be in a single-column figure?",
    description:
      "Bond length, label size and column width for a chemical structure in a journal figure, " +
      "from the ACS author guidelines, and how to export a figure at those sizes.",
    released: null,
    figures: [
      {
        example: "journal-figure-size-two-per-row",
        alt: "Acetic acid in four panels, two to a row: skeletal, explicit hydrogens, Lewis and condensed.",
      },
      {
        example: "journal-figure-size-one-row",
        alt: "The same four panels of acetic acid in one row.",
      },
    ],
  },
  {
    slug: "glycine-zwitterion",
    title: "Glycine as a neutral molecule and as a zwitterion",
    description:
      "Neutral glycine and its zwitterion have the same sum formula and the same mass. " +
      "Where the two structures differ, how to draw each one, and the PubChem record for each.",
    released: null,
    figures: [
      {
        example: "glycine-forms-neutral",
        alt: "Neutral glycine, H2N–CH2–COOH, as a skeletal formula and as a Lewis structure.",
      },
      {
        example: "glycine-forms-zwitterion",
        alt: "The glycine zwitterion, with NH3+ and CO2−, as a skeletal formula and as a Lewis structure.",
      },
    ],
  },
  {
    slug: "formal-charges-and-lone-pairs",
    title: "How do you count formal charges and lone pairs?",
    description:
      "Formal charge is valence electrons minus lone-pair electrons minus bonds. " +
      "This guide works it for ammonia, ammonium and acetate, and shows how the editor flags a missing charge.",
    released: null,
    figures: [
      {
        example: "formal-charges-ammonia",
        alt: "Ammonia as NH3 in skeletal view, and in Lewis view with three N–H bonds and one lone pair on nitrogen.",
      },
      {
        example: "formal-charges-ammonium",
        alt: "Ammonium as NH4+ in skeletal view, and in Lewis view with four N–H bonds, no lone pair and a plus charge.",
      },
      {
        example: "formal-charges-mistake",
        alt: "A nitrogen with four bonds to hydrogen and no charge drawn, in skeletal and Lewis views.",
      },
      {
        example: "formal-charges-fixed",
        alt: "The same nitrogen with four bonds to hydrogen, now with a plus charge, in skeletal and Lewis views.",
      },
      {
        example: "formal-charges-acetate",
        alt: "Acetate in skeletal and Lewis views; the singly bonded oxygen carries three lone pairs and a minus charge.",
      },
    ],
  },
];

/** The guide with this slug. Throws, because every caller names a guide that
 *  a page folder exists for, and a typo there should fail the build. */
export function guideBySlug(slug: string, guides: readonly Guide[] = GUIDES): Guide {
  const guide = guides.find((g) => g.slug === slug);
  if (guide === undefined) throw new Error(`No guide has the slug "${slug}".`);
  return guide;
}

/** The released guides, newest first; ties keep their order in `GUIDES`. */
export function releasedGuides(guides: readonly Guide[] = GUIDES): Guide[] {
  return guides
    .filter((g) => g.released !== null)
    .sort((a, b) => (b.released ?? "").localeCompare(a.released ?? ""));
}

/** The guides still unreleased: linked from nowhere, absent from the sitemap. */
export function unreleasedGuides(guides: readonly Guide[] = GUIDES): Guide[] {
  return guides.filter((g) => g.released === null);
}

/** Where a guide's social card is served from `public/` (decision 245). */
export function guideCardPath(slug: string): string {
  return `/social-cards/${slug}.png`;
}

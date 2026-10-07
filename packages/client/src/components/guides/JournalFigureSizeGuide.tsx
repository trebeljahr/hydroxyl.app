/**
 * "How big should a chemical structure be in a single-column figure?"
 *
 * A reader who asks that is about to submit, has a structure that looks right
 * on screen, and does not know what it will look like in a 8 cm column. The
 * page answers with ACS's own numbers first, then shows what shrinking does to
 * the labels, and ends at the export dialog that applies those numbers.
 *
 * ── EVERY NUMBER IS COMPUTED OR CITED, NEVER TYPED INTO THE PROSE ──────────
 *
 * Product numbers come from chem-render and the worked example from the export
 * path, through `guideNumbers()`; ACS's numbers from `ACS_GUIDELINE`, which
 * records the page and the date it was read. Each product number sits in a
 * `data-guide-number` span, which is what e2e/guide.spec.ts compares with the
 * chem-render constants.
 *
 * ── A SERVER COMPONENT, LIKE THE LANDING PAGE ──────────────────────────────
 *
 * It composes two figures at build time. Every link is a plain anchor from
 * `@/lib/deployment`, for the reason given there. Under each figure, "Open
 * this figure in the editor" opens that figure's document through
 * `?example=` (decision 127); the names are the guide's entry in `guides.ts`.
 * Whether the page is linked from anywhere is that entry's `released`.
 */

import type { ReactElement } from "react";

import { editorHref } from "@/lib/deployment";
import { SITE_NAME } from "@/lib/site";

import { N, Section, WorkedExample, fetchedOn } from "./guide-parts";
import { guideBySlug } from "./guides";
import type { GuideFigure } from "./guides";
import { ACS_GUIDELINE, cmFromPt, decimal, guideNumbers } from "./journal-figure-size";

const GUIDE = guideBySlug("journal-figure-size");
const [TWO_PER_ROW, ONE_ROW] = GUIDE.figures as readonly [GuideFigure, GuideFigure];

export function JournalFigureSizeGuide(): ReactElement {
  const n = guideNumbers();
  const acs = ACS_GUIDELINE;
  const { twoPerRow, oneRow } = n;

  return (
    <article
      data-guide="journal-figure-size"
      className="text-muted-foreground mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6 [&_strong]:text-foreground [&_strong]:font-medium"
    >
      <header className="py-10 md:py-14">
        <p className="mb-3 text-sm font-medium tracking-wide uppercase">Guide</p>
        <h1 className="text-foreground text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {GUIDE.title}
        </h1>
        <p data-guide="answer" className="mt-6 text-lg leading-relaxed">
          Draw every bond <N k="bond-cm">{n.bondCm}</N> cm long, with{" "}
          <N k="label-pt">{n.labelPt}</N> pt atom labels. Then let the figure be as wide as the
          structure needs, up to the column. ACS journals take a single-column figure up to{" "}
          {acs.singleColumnMaxPt} pt wide, or {n.acsSingleCm} cm.
        </p>
        <p className="mt-4 text-lg leading-relaxed">
          Shrink a figure only when it is wider than the column. Shrinking takes the labels down
          with the bonds, and ACS asks for text no smaller than {acs.minArtworkTextPt} pt.
        </p>
      </header>

      <Section id="acs" heading="What ACS asks for">
        <p>
          The{" "}
          <a
            href={acs.url}
            data-guide="source"
            className="text-foreground underline underline-offset-2"
          >
            {acs.pageTitle}
          </a>{" "}
          give the drawing settings for structures and the size of a column on one page. The
          numbers below come from that page, read on{" "}
          <time dateTime={acs.fetched} data-guide="fetched">
            {fetchedOn(acs.fetched)}
          </time>
          .
        </p>
        <figure className="border-l-2 pl-4">
          <blockquote data-guide="quote" className="text-foreground">
            “{acs.quote}”
          </blockquote>
          <figcaption className="mt-1 text-sm">
            — {acs.pageTitle}, Appendix 2: Preparing Graphics
          </figcaption>
        </figure>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">ACS artwork sizes</caption>
          <tbody className="[&_td]:py-1.5 [&_td]:align-top [&_th]:py-1.5 [&_th]:pr-4 [&_th]:align-top [&_th]:font-medium [&_tr]:border-b">
            <tr>
              <th scope="row" className="text-foreground">Single column</th>
              <td>
                Up to {acs.singleColumnMaxPt} pt ({n.acsSingleCm} cm)
              </td>
            </tr>
            <tr>
              <th scope="row" className="text-foreground">Double column</th>
              <td>
                {acs.doubleColumnMinPt} to {acs.doubleColumnMaxPt} pt ({n.acsDoubleMinCm} to{" "}
                {n.acsDoubleMaxCm} cm)
              </td>
            </tr>
            <tr>
              <th scope="row" className="text-foreground">Bond length</th>
              <td>
                {acs.bondLengthPt} pt ({cmFromPt(acs.bondLengthPt).toFixed(3)} cm), the same for
                every structure
              </td>
            </tr>
            <tr>
              <th scope="row" className="text-foreground">Atom labels</th>
              <td>{acs.labelPt} pt Arial or Helvetica</td>
            </tr>
            <tr>
              <th scope="row" className="text-foreground">Bond lines</th>
              <td>
                {acs.lineWidthPt} pt, and {decimal(acs.boldWidthPt, 1)} pt for bold bonds
              </td>
            </tr>
            <tr>
              <th scope="row" className="text-foreground">Text in artwork</th>
              <td>No smaller than {acs.minArtworkTextPt} pt</td>
            </tr>
            <tr>
              <th scope="row" className="text-foreground">Resolution</th>
              <td>
                {acs.lineArtDpi} dpi for black-and-white line art, {acs.grayscaleDpi} dpi for
                grayscale, {acs.colourDpi} dpi for colour
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          The same appendix allows lettering down to {acs.minPublishedLetteringPt} pt in the
          final published format. Draw for {acs.minArtworkTextPt} pt anyway. It is the stricter
          rule, and a figure that meets it meets both. The guidelines for JACS, J. Org. Chem. and
          Org. Lett. repeat the column sizes word for word.
        </p>
      </Section>

      <Section id="one-scale" heading="Keep one bond length for the whole paper">
        <p>
          Stretch every figure to fill the column and each one gets its own scale. A small
          molecule prints with long bonds and large labels. A large scheme prints with short bonds
          and small labels. Put them in one paper and the structures stop matching.
        </p>
        <p>
          A fixed bond length keeps every structure at one scale. A small figure then sits
          narrower than the column, and that is correct.
        </p>
      </Section>

      <Section id="shrink" heading="When the structure is wider than the column">
        <p>
          A figure wider than the column has to shrink to fit, and its labels shrink by the same
          factor. Labels drawn at <N k="label-pt">{n.labelPt}</N> pt reach the{" "}
          <N k="min-label-pt">{n.minLabelPt}</N> pt minimum at{" "}
          <N k="shrink-floor-percent">{n.shrinkFloorPercent}</N>% of full size. In a{" "}
          <N k="single-cm">{n.singleCm}</N> cm column, that allows a figure up to{" "}
          <N k="max-natural-single-cm">{n.maxNaturalSingleCm}</N> cm wide at full size.
        </p>
        <p>
          Acetic acid in four panels, two to a row, is{" "}
          <N k="two-per-row-width-cm">{twoPerRow.widthCm.toFixed(1)}</N> cm wide. It fits the
          column and prints at full size, with <N k="two-per-row-label-pt">{twoPerRow.fontSizePt}</N>{" "}
          pt labels.
        </p>
        <WorkedExample
          id="two-per-row"
          figure={twoPerRow}
          opens={TWO_PER_ROW}
          label={`Acetic acid in four panels, two to a row, ${twoPerRow.widthCm.toFixed(1)} cm wide at full size.`}
        />
        <p>
          Put the same four panels in one row and the figure is{" "}
          <N k="one-row-natural-width-cm">{oneRow.naturalWidthCm.toFixed(1)}</N> cm wide. In the
          column it shrinks to <N k="one-row-width-cm">{decimal(oneRow.widthCm, 2)}</N> cm, and
          its labels print at <N k="one-row-label-pt">{oneRow.fontSizePt}</N> pt.
        </p>
        <WorkedExample
          id="one-row"
          figure={oneRow}
          opens={ONE_ROW}
          label={`The same four panels in one row, shrunk to ${decimal(oneRow.widthCm, 2)} cm, with ${oneRow.fontSizePt} pt labels.`}
        />
        <p className="text-sm">
          Both figures are drawn at the same scale, so their labels compare. A centimetre on a
          screen is rarely a true centimetre.
        </p>
      </Section>

      <Section id="editor" heading={`Export at these sizes with ${SITE_NAME}`}>
        <p>
          {SITE_NAME} prints every bond at <N k="bond-cm">{n.bondCm}</N> cm, which is{" "}
          <N k="bond-pt">{n.bondPt}</N> pt. Its Publication style uses the ACS 1996 settings at
          that bond: <N k="label-pt">{n.labelPt}</N> pt labels and{" "}
          <N k="line-width-pt">{n.lineWidthPt}</N> pt lines. The export dialog applies them.
        </p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Draw the structure, paste a SMILES string or drop a molfile on the editor.</li>
          <li>
            Choose <strong>Export</strong> in the top bar, or press{" "}
            <kbd data-guide="shortcut">Ctrl+Shift+E</kbd> (<kbd>⌘⇧E</kbd> on a Mac). The dialog
            uses the Publication style unless you pick another.
          </li>
          <li>
            Under <strong>Maximum width</strong>, choose{" "}
            <strong data-guide="single-column-choice">
              Single column (up to <N k="single-cm">{n.singleCm}</N> cm)
            </strong>
            .
          </li>
          <li>
            Read the line under the preview. It gives the printed width and height, the bond
            length and the label size.
          </li>
          <li>
            If the figure had to shrink, the dialog says by how much. If its labels fall under{" "}
            <N k="min-label-pt">{n.minLabelPt}</N> pt, it says so and names the width that keeps
            them at <N k="min-label-pt">{n.minLabelPt}</N> pt.
          </li>
          <li>
            Choose <strong>Download SVG</strong>, <strong>Download PDF</strong>, or{" "}
            <strong>Download PNG</strong> at{" "}
            {n.dpiChoices.map((dpi, i) => (
              <span key={dpi}>
                {i === 0 ? "" : " or "}
                <N k="dpi">{dpi}</N>
              </span>
            ))}{" "}
            dpi.
          </li>
        </ol>
        <p>For the one-row acetic acid above, the dialog says:</p>
        <blockquote
          data-guide="dialog-notice"
          className="border-l-2 border-amber-600 pl-4 text-sm text-amber-800 dark:text-amber-300"
        >
          {oneRow.scaleNotice} {oneRow.labelNotice}
        </blockquote>
        <p>
          The single column is{" "}
          <N k="single-cm">{n.singleCm}</N> cm, a little under the {n.acsSingleCm} cm ACS allows.
          A figure sized for it fits, and a custom width can use the rest. The double column is{" "}
          <N k="double-cm">{n.doubleCm}</N> cm, which is {acs.doubleColumnMaxPt} pt rounded to the
          millimetre.
        </p>
        <p>
          PNG files stop at <N k="max-dpi">{Math.max(...n.dpiChoices)}</N> dpi, and ACS asks{" "}
          {acs.lineArtDpi} dpi for black-and-white line art. The SVG file keeps lines and text as
          vectors, so it has no fixed resolution.
        </p>
        <p className="pt-2">
          <a
            href={editorHref()}
            data-guide="open-editor"
            className="bg-primary text-primary-foreground focus-visible:ring-ring inline-block rounded-md px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            Open the editor
          </a>
        </p>
      </Section>
    </article>
  );
}

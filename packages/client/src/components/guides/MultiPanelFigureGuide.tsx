/**
 * "How do I make a lettered multi-panel figure of one molecule?"
 *
 * The reader has a molecule and needs it in several views side by side,
 * lettered so the text can say "(c)", for a paper or a thesis. The page shows
 * the finished figure first, then every click that builds it, then what
 * surprises people: letters that follow the list, a panel that keeps its
 * display settings when its view changes, a view that is refused, and a
 * column count worth setting.
 *
 * ── EVERY NUMBER IS COMPUTED OR CITED ──────────────────────────────────────
 *
 * Sizes come from the export path through `multiPanelNumbers()`; view names,
 * the refusal sentence and the automatic column count from chem-render; the
 * caption rule from ACS, with the page and the day it was read. Each product
 * number sits in a `data-guide-number` span, and each control the steps name
 * in a `data-guide-control` span, which e2e/guide.spec.ts clicks.
 *
 * ── A SERVER COMPONENT, LIKE THE FIGURE-SIZE GUIDE ─────────────────────────
 *
 * Its two figures are composed at build time. Under each, "Open this figure
 * in the editor" opens that figure's document through `?example=`
 * (decision 127). Whether the page is linked from anywhere is its entry's
 * `released` in `guides.ts`.
 */

import type { ReactElement } from "react";

import { editorHref, guideHref } from "@/lib/deployment";
import { SITE_NAME } from "@/lib/site";

import { N, Section, WorkedExample, fetchedOn } from "./guide-parts";
import { guideBySlug } from "./guides";
import type { GuideFigure } from "./guides";
import { ACS_FIGURE_CAPTION, multiPanelNumbers, printedSize } from "./multi-panel-figure";
import type { MultiPanelPanel } from "./multi-panel-figure";

const GUIDE = guideBySlug("multi-panel-figure");
const [FINISHED, AUTOMATIC] = GUIDE.figures as readonly [GuideFigure, GuideFigure];
const FIGURE_SIZE = guideBySlug("journal-figure-size");

/** A control the steps tell the reader to use, by the name it has on screen. */
function C({ k, children }: { readonly k: string; readonly children: string }): ReactElement {
  return (
    <strong data-guide-control={k} className="text-foreground font-medium">
      {children}
    </strong>
  );
}

export function MultiPanelFigureGuide(): ReactElement {
  const n = multiPanelNumbers();
  const { finished, automatic } = n;
  const [a, b, c, d] = n.panels as readonly [
    MultiPanelPanel,
    MultiPanelPanel,
    MultiPanelPanel,
    MultiPanelPanel,
  ];
  const [firstView, secondView] = n.newSketchViews as readonly [string, string];
  const acs = ACS_FIGURE_CAPTION;

  return (
    <article
      data-guide="multi-panel-figure"
      className="text-muted-foreground mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6 [&_strong]:text-foreground [&_strong]:font-medium"
    >
      <header className="py-10 md:py-14">
        <p className="mb-3 text-sm font-medium tracking-wide uppercase">Guide</p>
        <h1 className="text-foreground text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {GUIDE.title}
        </h1>
        <p data-guide="answer" className="mt-6 text-lg leading-relaxed">
          Draw the molecule once, then list four panels under Figure panels. The editor letters
          them {a.label} to {d.label} in list order and prints each caption under its panel. Set
          Columns to <N k="columns">{n.columns}</N>, and the figure below prints{" "}
          <N k="finished-width-cm">{finished.widthCm.toFixed(2)}</N> cm wide, inside a{" "}
          <N k="single-cm">{n.singleCm}</N> cm single column.
        </p>
      </header>

      <WorkedExample
        id="finished"
        figure={finished}
        opens={FINISHED}
        label={FINISHED.alt}
      />
      <p className="mt-3 text-sm">
        Aspirin, exported at a single column: <N k="finished-size">{printedSize(finished)}</N>, at
        full size, with <N k="finished-label-pt">{finished.fontSizePt}</N> pt labels.
      </p>

      <Section id="steps" heading="Build the figure in nine steps">
        <ol className="list-decimal space-y-3 pl-5">
          <li>
            <a
              href={editorHref()}
              data-guide="open-editor"
              className="text-foreground underline underline-offset-2"
            >
              Open the editor
            </a>
            . It opens on benzene. Press <kbd data-guide="shortcut-select-all">Ctrl+A</kbd> (
            <kbd>⌘A</kbd> on a Mac), then <kbd data-guide="shortcut-delete">Delete</kbd>, to clear
            it.
          </li>
          <li>
            Choose <C k="insert">Insert a structure</C> in the top bar. Type{" "}
            <code data-guide="insert-text">aspirin</code> and press Enter.
          </li>
          <li>
            Find the <C k="figure-panels">Figure panels</C> list beside the canvas. A new sketch
            has two panels: (a) <span data-guide="new-sketch-view">{firstView}</span> and (b){" "}
            <span data-guide="new-sketch-view">{secondView}</span>.
          </li>
          <li>
            In the menu under the list, choose <C k="view-b">{b.view}</C>, then{" "}
            <C k="add-panel">Add panel</C>. This adds panel {c.label}.
          </li>
          <li>
            Choose <C k="view-c">{c.view}</C> in the same menu, then <strong>Add panel</strong>{" "}
            again. This adds panel {d.label}.
          </li>
          <li>
            The <span data-guide="moved-view">{secondView}</span> panel is still {b.label}. Choose
            the down arrow on its row twice. It moves to {d.label}, and the two new panels move up
            to {b.label} and {c.label}.
          </li>
          <li>
            Click each panel&rsquo;s <C k="caption">Caption</C> field, type its caption and press
            Enter:
            <ul className="mt-2 space-y-1 pl-1">
              {n.panels.map((panel) => (
                <li key={panel.label} data-guide="caption-step">
                  {panel.label} <q data-guide="caption-text">{panel.caption}</q>
                </li>
              ))}
            </ul>
          </li>
          <li>
            Type <N k="columns">{n.columns}</N> in the <C k="columns">Columns</C> field and press
            Enter.
          </li>
          <li>
            Press <kbd data-guide="shortcut-export">Ctrl+Shift+E</kbd> (<kbd>⌘⇧E</kbd> on a Mac)
            to open the export dialog. Under <strong>Maximum width</strong>, choose{" "}
            <C k="single-column">{`Single column (up to ${n.singleCm} cm)`}</C>. Then choose{" "}
            <strong>Download SVG</strong>, <strong>Download PDF</strong> or{" "}
            <strong>Download PNG</strong>.
          </li>
        </ol>
        <p>
          The line under the preview reads{" "}
          <q>
            Prints <N k="finished-size">{printedSize(finished)}</N>
          </q>{" "}
          for this figure. It is the same size as the figure at the top of this page.
        </p>
      </Section>

      <Section id="letters" heading="The letters follow the list">
        <p>
          {SITE_NAME} letters panels by their place in the list, not by their view. That is why
          step 6 relabels three panels. Move a panel with its arrow buttons, or focus it and press
          Alt+Up or Alt+Down. Each caption moves with its panel.
        </p>
        <p>
          You can also change the view of a panel you have. The panel then takes the display
          settings of the new view, so a sum-formula panel changed to {b.view} draws its carbon
          and hydrogen labels. A setting you changed yourself stays with the panel.
        </p>
        <p>
          The letters and the captions print at the size of the atom labels:{" "}
          <N k="finished-label-pt">{finished.fontSizePt}</N> pt in this figure. All four panels
          share one bond length, so a reader can compare {a.label} with {c.label} bond for bond.
        </p>
      </Section>

      <Section id="sum-formula" heading={`Why panel ${d.label} is the sum formula`}>
        <p>
          Aspirin has a benzene ring, and a ring has no condensed formula. The view menu still
          lists <strong>Condensed formula</strong>, but greyed out, with this line under it:
        </p>
        <blockquote data-guide="condensed-refusal" className="border-l-2 pl-4 text-sm">
          {n.condensedRefusal}
        </blockquote>
        <p>
          A molecule without a ring, such as acetic acid, can use a condensed formula in that
          place.
          {FIGURE_SIZE.released === null ? null : (
            // An unreleased guide is linked from nowhere (decision 243), not
            // even from another guide, so this sentence waits for its release.
            <>
              {" "}
              The{" "}
              <a
                href={guideHref(FIGURE_SIZE.slug)}
                data-guide="related-guide"
                className="text-foreground underline underline-offset-2"
              >
                figure-size guide
              </a>{" "}
              shows it that way.
            </>
          )}
        </p>
      </Section>

      <Section id="columns" heading="Set the column count yourself">
        <p>
          Leave <strong>Columns</strong> empty and the editor puts up to{" "}
          <N k="automatic-columns">{n.automaticColumns}</N> panels in a row. Four panels then make
          a row of three and a row of one:
        </p>
        <WorkedExample
          id="automatic"
          figure={automatic}
          opens={AUTOMATIC}
          label={AUTOMATIC.alt}
        />
        <p>
          That figure is <N k="automatic-natural-width-cm">{automatic.naturalWidthCm.toFixed(2)}</N>{" "}
          cm wide at full size, wider than the column. To fit, it shrinks to{" "}
          <N k="automatic-scale-percent">{n.automaticScalePercent}</N>%, and its labels print at{" "}
          <N k="automatic-label-pt">{automatic.fontSizePt}</N> pt. ACS asks for no text under{" "}
          <N k="min-label-pt">{n.minLabelPt}</N> pt, and the export dialog warns:
        </p>
        <blockquote
          data-guide="dialog-notice"
          className="border-l-2 border-amber-600 pl-4 text-sm text-amber-800 dark:text-amber-300"
        >
          {automatic.scaleNotice} {automatic.labelNotice}
        </blockquote>
        <p>
          With <N k="columns">{n.columns}</N> columns, the same panels make two rows of two. The
          figure is <N k="finished-width-cm">{finished.widthCm.toFixed(2)}</N> cm wide and prints
          at full size. The field takes any whole number from 1 to{" "}
          <N k="max-columns">{n.maxColumns}</N>.
        </p>
      </Section>

      <Section id="caption" heading="Write the figure caption in the manuscript">
        <p>
          The captions inside the figure name each panel. The journal also wants a caption for
          the whole figure, in the text of the paper. The{" "}
          <a
            href={acs.url}
            data-guide="source"
            className="text-foreground underline underline-offset-2"
          >
            {acs.pageTitle}
          </a>{" "}
          ask for{" "}
          <q data-guide="quote" className="text-foreground">
            {acs.quote}
          </q>{" "}
          (section &ldquo;{acs.section}&rdquo;, read on{" "}
          <time dateTime={acs.fetched} data-guide="fetched">
            {fetchedOn(acs.fetched)}
          </time>
          ).
        </p>
        <p>Name each panel there by its letter. For the figure above:</p>
        <blockquote data-guide="example-caption" className="text-foreground border-l-2 pl-4 text-sm">
          <strong>Figure 1.</strong> Aspirin drawn four ways: {a.label} skeletal formula, {b.label}{" "}
          with every hydrogen drawn, {c.label} Lewis structure with lone pairs, and {d.label} sum
          formula.
        </blockquote>
      </Section>
    </article>
  );
}

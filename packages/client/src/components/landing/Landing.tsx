/**
 * What the editor is for, told to a chemist who has never opened it.
 *
 * ── WHERE IT APPEARS (decision 109) ────────────────────────────────────────
 *
 * On `/about`, always, for anyone who wants the explanation and for links from
 * outside. And on `/` in place of the old one-line empty state, when this
 * browser holds no sketches: a first visit to the site is a first visit to the
 * app, and a blank grid explains nothing. Once a sketch exists, `/` is the
 * grid and this page moves behind the header's "About" link.
 *
 * ── A SERVER COMPONENT, AND IT MUST STAY ONE ───────────────────────────────
 *
 * It composes the example figure at build time. Imported into a client module
 * it would ship chem-render's figure composer to every visitor to redo the
 * same work, so `/` receives it as a prop from its server `page.tsx` instead.
 *
 * ── EVERY CLAIM HERE IS CHECKABLE IN THE SHIPPED EDITOR ────────────────────
 *
 * The house copy rules apply: nothing planned, nothing on a branch, no
 * invented number. The figure's size, bond length and label size are computed
 * by the export code, not typed. When a feature changes, change this page in
 * the same commit — and when one is removed, the "Not in this version" list is
 * where it goes.
 */

import { ProjectDonateLink } from "../project-donate-link";
import type { ReactElement, ReactNode } from "react";

import { JOURNAL_WIDTHS_CM, MIN_PRINTED_LABEL_PT } from "@starter/chem-render";

import {
  editorExampleHref,
  editorHref,
  isFileExportBuild,
  thirdPartyNoticesHref,
} from "@/lib/deployment";
import { DONATE_URL } from "@/lib/donation";
import { FEEDBACK_ADDRESS, FEEDBACK_HREF } from "@/lib/feedback";

import { LANDING_HEADLINE } from "./copy";
import { LANDING_EXAMPLE } from "./example-document";
import { EXAMPLE_FIGURE_ALT, exampleCaption, exampleFigure } from "./example-figure";

function Section({
  id,
  heading,
  children,
}: {
  readonly id: string;
  readonly heading: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      data-landing-section={id}
      className="border-t py-10 md:grid md:grid-cols-[14rem_1fr] md:gap-10"
    >
      <h2 id={`${id}-heading`} className="mb-4 text-lg font-semibold tracking-tight md:mb-0">
        {heading}
      </h2>
      <div className="text-muted-foreground max-w-prose space-y-4 leading-relaxed [&_strong]:text-foreground [&_strong]:font-medium">
        {children}
      </div>
    </section>
  );
}

export function Landing(): ReactElement {
  const example = exampleFigure();
  const single = String(JOURNAL_WIDTHS_CM.single);
  const double = String(JOURNAL_WIDTHS_CM.double);

  return (
    <div data-landing="page" className="mx-auto w-full max-w-5xl px-4 sm:px-6">
      <section className="grid items-center gap-10 py-10 md:py-16 lg:grid-cols-[1fr_minmax(0,26rem)]">
        <div>
          <h1
            data-landing="headline"
            className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
          >
            {LANDING_HEADLINE}
          </h1>
          <p className="text-muted-foreground mt-5 max-w-prose text-lg leading-relaxed">
            A figure that needs the skeletal structure beside the Lewis structure usually means
            drawing the molecule twice, and fixing it twice when it changes.
          </p>
          <p className="text-muted-foreground mt-4 max-w-prose text-lg leading-relaxed">
            Chemistry Sketcher keeps one structure and draws each view from it. Put the views side
            by side as lettered panels and export them as one figure, sized for a journal column.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <a
              href={editorHref()}
              data-landing="start"
              className="bg-primary text-primary-foreground focus-visible:ring-ring rounded-md px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              New sketch
            </a>
            <span className="text-muted-foreground text-sm">
              Runs in your browser. No account.
            </span>
          </div>
        </div>

        <figure data-landing="figure" className="min-w-0">
          <div
            className="rounded-lg border bg-white p-4 shadow-sm [&>svg]:h-auto [&>svg]:w-full"
            role="img"
            aria-label={EXAMPLE_FIGURE_ALT}
            // Markup this app generated from its own scene graph at build
            // time, never from anyone's file — there is no untrusted input.
            dangerouslySetInnerHTML={{ __html: example.svg }}
          />
          <figcaption className="text-muted-foreground mt-3 text-sm leading-snug">
            {exampleCaption(example)}
          </figcaption>
          {/* A plain anchor, like "New sketch": see `@/lib/deployment` for why
              the static export needs a full page load here. The editor opens
              a copy under a new id and stores nothing until the first edit
              (decision 127). */}
          <a
            href={editorExampleHref(LANDING_EXAMPLE)}
            data-landing="open-example"
            className="text-foreground focus-visible:ring-ring mt-2 inline-block rounded-sm text-sm font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2"
          >
            Open this example in the editor
          </a>
        </figure>
      </section>

      <Section id="print-size" heading="Know the printed size before you submit">
        <p>
          A figure scaled down to fit a column takes its labels down with it. A structure that
          reads well on screen can print with atom labels too small for the journal.
        </p>
        <p>
          The export dialog sizes the figure for a single column ({single} cm), a double column (
          {double} cm) or a width you type. It shows the printed width and height, the bond length
          and the label size before you save. When a label will print under {MIN_PRINTED_LABEL_PT}{" "}
          pt, the minimum ACS asks for, it says so and suggests a fix. R/S
          labels and stereo group tags get the same check.
        </p>
        <p>
          The Publication style uses the ACS 1996 settings: a {example.styleBondLength} bond with{" "}
          {example.styleLabelSize} labels at full size. PNG files export at 300 or 600 dpi, with the
          resolution written into the file. SVG files keep the text as text, so you can still edit
          a label later.
        </p>
      </Section>

      <Section id="views" heading="Every view from one structure">
        <p>
          Each panel shows the structure in the view you pick for it:{" "}
          <strong>skeletal</strong>, <strong>Kekulé</strong>, <strong>explicit hydrogens</strong>,{" "}
          <strong>Lewis</strong> with lone pairs and formal charges, the{" "}
          <strong>condensed formula</strong> or the <strong>sum formula</strong>. Edit the structure
          once and every panel shows the change.
        </p>
        <p>
          Panels are lettered (a), (b), (c) in order. Give each one a caption, reorder them and
          choose how many sit in a row. Per panel, you can show or hide carbon labels, hydrogens,
          lone pairs, charges, aromatic circles and R/S or E/Z labels.
        </p>
      </Section>

      <Section id="files" heading="Structures in, figures out">
        <p>
          Drop or paste a molfile, an SDF file or a SMILES string onto the editor. Molfiles can be
          V2000 or V3000. Each record in an SDF file becomes its own sketch.
        </p>
        <p>
          <strong>Copy figure</strong> puts SVG and PNG on the clipboard, ready to paste into slides
          or a manuscript. You can also download SVG, PNG and molfiles, or copy the SMILES.
        </p>
        <p>
          Draw wedge, hash and wavy bonds, and mark AND, OR and absolute stereo groups. A structure
          with stereo groups exports as a V3000 molfile, because V2000 cannot store them. The status bar shows the formula, molecular weight and exact mass as you draw.
        </p>
      </Section>

      <Section id="storage" heading="Your sketches stay in this browser">
        <p>
          Every change saves to this browser as you work. There is no account, and no server
          stores your sketches: the structures you draw do not leave your computer.
        </p>
        <p>
          It also means a sketch exists only in the browser you drew it in. To back up your
          sketches or move them to another computer, use <strong>Export all sketches</strong> on
          the sketch list. It writes one file, and <strong>Import</strong> reads it back.
        </p>
      </Section>

      <Section id="limits" heading="Not in this version">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            No 3D views, and no Fischer, Haworth, chair, Newman or sawhorse projections yet.
          </li>
          <li>No condensed formula for molecules with rings. It works for chains only.</li>
          <li>No InChI import. Paste a SMILES or open a molfile instead.</li>
          <li>No PDF, EPS or CDXML export. Most drawing programs open SVG.</li>
          <li>No reaction arrows or schemes.</li>
          <li>No sync between computers. Export all sketches to one file to move them.</li>
        </ul>
      </Section>

      <footer className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-2 border-t py-6 text-sm">
        <span>Chemistry Sketcher</span>
        <a href={thirdPartyNoticesHref()} className="hover:text-foreground underline-offset-2 hover:underline">
          Third-party licences
        </a>
        {/* The address itself, so a visitor with no mail program set up can
            still copy it. In every build, the static export too (decision
            167): an email address is a contact, not a payment page. */}
        <a href={FEEDBACK_HREF} className="hover:text-foreground underline-offset-2 hover:underline">
          {FEEDBACK_ADDRESS}
        </a>
        {/* Not in the static export an app-store shell would package, for the
            reason given in shell/StatusBar.tsx. New tab, like the editor's. */}
        {isFileExportBuild() ? null : (
          <ProjectDonateLink
            href={DONATE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground underline-offset-2 hover:underline"
          >
            Donate
          </ProjectDonateLink>
        )}
      </footer>
    </div>
  );
}

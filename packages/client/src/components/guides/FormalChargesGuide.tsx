/**
 * "How do you count formal charges and lone pairs?"
 *
 * The reader is a student who has met Lewis structures and keeps getting the
 * charges wrong. The page gives the rule in its first paragraph, works it on
 * ammonia and ammonium, then shows the mistake they are most likely to make —
 * a nitrogen with four bonds and no charge — and what the editor does with
 * it. It ends on the case the editor cannot catch: a missing minus on oxygen.
 *
 * ── NOTHING CHEMICAL IS TYPED INTO THE PROSE ───────────────────────────────
 *
 * The table and the worked counts come from chem-core through `chargeRows()`;
 * the editor's label, message and fix button from `mistakeReport()`; the
 * formulas from `forgottenMinus()`. Each sits in a `data-guide-*` element the
 * unit test and e2e/guide.spec.ts read back. The rule itself is cited to
 * OpenStax, which a student can open for free.
 *
 * ── A SERVER COMPONENT, LIKE THE OTHER GUIDES ──────────────────────────────
 *
 * Figures are composed at build time. Under each, "Open this figure in the
 * editor" opens its document through `?example=` (decision 127); the mistake
 * opens with its error showing, so the reader can click the fix themselves.
 */

import type { ReactElement, ReactNode } from "react";

import { commandById, formatShortcut } from "@/editor/commands/registry";
import { editorExampleHref, editorHref } from "@/lib/deployment";
import { SITE_NAME } from "@/lib/site";

import {
  chargeRows,
  forgottenMinus,
  guideFigures,
  mistakeReport,
  OPENSTAX_SOURCE,
  signed,
} from "./formal-charges";
import type { ChargeRow, GuideFigureSvg } from "./formal-charges";
import { guideBySlug } from "./guides";
import type { GuideFigure } from "./guides";

const GUIDE = guideBySlug("formal-charges-and-lone-pairs");
const [AMMONIA, AMMONIUM, MISTAKE, FIXED, ACETATE] = GUIDE.figures as readonly [
  GuideFigure,
  GuideFigure,
  GuideFigure,
  GuideFigure,
  GuideFigure,
];

/** How much larger than print a figure is shown. See `Figure`. */
const SCREEN_SCALE = 2;

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
    <section aria-labelledby={`${id}-heading`} data-guide-section={id} className="border-t py-8">
      <h2 id={`${id}-heading`} className="text-foreground mb-4 text-xl font-semibold tracking-tight">
        {heading}
      </h2>
      <div className="space-y-4 leading-relaxed">{children}</div>
    </section>
  );
}

function Figure({
  id,
  figure,
  opens,
}: {
  readonly id: string;
  readonly figure: GuideFigureSvg;
  readonly opens: GuideFigure;
}): ReactElement {
  return (
    <figure className="space-y-2">
      <div className="inline-block max-w-full rounded-lg border bg-white p-3 shadow-sm">
        <div
          data-guide-figure={id}
          role="img"
          aria-label={opens.alt}
          // Twice the printed width, in CSS centimetres: at print size these
          // small ions are 3–4 cm and their lone-pair dots are too small to
          // count on a screen, and counting them is the point of the page.
          // One factor for all, so the figures keep their sizes relative to
          // each other. Markup this app generated at build time from its own
          // documents, never from anyone's file.
          style={{ width: `${figure.widthCm * SCREEN_SCALE}cm` }}
          className="max-w-full [&>svg]:h-auto [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: figure.svg }}
        />
      </div>
      {/* A copy under a fresh id, stored only once edited (decision 127). */}
      <a
        href={editorExampleHref(opens.example)}
        data-guide-open-example={opens.example}
        className="text-foreground focus-visible:ring-ring block w-fit rounded-sm text-sm font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2"
      >
        Open this figure in the editor
      </a>
    </figure>
  );
}

/** "5 − 0 − 4 = +1", the count for one row. */
function count(row: ChargeRow): string {
  return `${row.valenceElectrons} − ${row.lonePairElectrons} − ${row.bonds} = ${signed(row.counted)}`;
}

function fetchedOn(isoDate: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

function Key({ id }: { readonly id: string }): ReactElement {
  const shortcut = commandById(id).shortcut ?? "";
  return <kbd data-guide-shortcut={id}>{formatShortcut(shortcut, false)}</kbd>;
}

export function FormalChargesGuide(): ReactElement {
  const rows = chargeRows();
  const [nh3, nh4, carbonyl, oxide, mistakeRow] = rows as readonly [
    ChargeRow,
    ChargeRow,
    ChargeRow,
    ChargeRow,
    ChargeRow,
  ];
  const figures = guideFigures();
  const report = mistakeReport();
  const minus = forgottenMinus();
  const source = OPENSTAX_SOURCE;

  return (
    <article
      data-guide="formal-charges-and-lone-pairs"
      className="text-muted-foreground mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6 [&_strong]:text-foreground [&_strong]:font-medium"
    >
      <header className="py-10 md:py-14">
        <p className="mb-3 text-sm font-medium tracking-wide uppercase">Guide</p>
        <h1 className="text-foreground text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {GUIDE.title}
        </h1>
        <p data-guide="answer" className="mt-6 text-lg leading-relaxed">
          Start with the atom&apos;s valence electrons. Subtract its lone-pair electrons, then
          subtract one for each bond. The result is the formal charge. A nitrogen with four bonds
          and no lone pair gives <span data-guide-count="ammonium">{count(nh4)}</span>.
        </p>
        <p className="mt-4 text-lg leading-relaxed">
          Lone pairs and charges are easy to leave out of a drawing. The Lewis view in{" "}
          {SITE_NAME} draws both, so you can check one against the other.
        </p>
      </header>

      <Section id="rule" heading="The rule">
        <p>
          <a
            href={source.url}
            data-guide="source"
            className="text-foreground underline underline-offset-2"
          >
            {source.publisher} {source.title}
          </a>{" "}
          gives the rule in section {source.section}, read on{" "}
          <time dateTime={source.fetched} data-guide="fetched">
            {fetchedOn(source.fetched)}
          </time>
          . Formal charge is the valence electrons of the free atom, minus the lone-pair
          electrons, minus half the bonding electrons.
        </p>
        <p>
          Half the bonding electrons is one per bond. A double bond counts as two. A bond to
          hydrogen counts too, even where the skeletal formula hides the hydrogen.
        </p>
        <table data-guide="charge-table" className="w-full text-left text-sm">
          <caption className="sr-only">Formal charge, counted atom by atom</caption>
          <thead>
            <tr className="text-foreground border-b [&_th]:py-1.5 [&_th]:pr-3 [&_th]:font-medium">
              <th scope="col">Atom</th>
              <th scope="col">Valence electrons</th>
              <th scope="col">Lone-pair electrons</th>
              <th scope="col">Bonds</th>
              <th scope="col">Formal charge</th>
            </tr>
          </thead>
          <tbody className="[&_td]:py-1.5 [&_td]:pr-3 [&_td]:align-top [&_th]:py-1.5 [&_th]:pr-3 [&_th]:align-top [&_th]:font-normal [&_tr]:border-b">
            {rows.map((r) => (
              <tr key={r.atom} data-guide-row={r.atom}>
                <th scope="row" className="text-foreground">
                  {r.atom}
                </th>
                <td>{r.valenceElectrons}</td>
                <td>{r.lonePairElectrons}</td>
                <td>{r.bonds}</td>
                <td>
                  {signed(r.counted)}
                  {r.counted === r.drawn ? null : (
                    <span className="text-destructive"> (drawn as {signed(r.drawn)})</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section id="ammonium" heading="Where the charge on ammonium comes from">
        <p>
          The nitrogen in ammonia has three N–H bonds and one lone pair. Its count is{" "}
          <span data-guide-count="ammonia">{count(nh3)}</span>. The Lewis view draws the lone pair
          as two dots beside the N.
        </p>
        <Figure id="ammonia" figure={figures.ammonia} opens={AMMONIA} />
        <p>
          Ammonia takes a proton, H⁺, with that lone pair. The pair becomes the fourth N–H bond.
          The nitrogen now has four bonds and no lone pair, so its count is{" "}
          <span data-guide-count="ammonium">{count(nh4)}</span>.
        </p>
        <Figure id="ammonium" figure={figures.ammonium} opens={AMMONIUM} />
        <p>
          The skeletal view writes NH₃ and NH₄⁺ and draws no lone pairs. The Lewis view draws
          every bond, every lone pair and every charge.
        </p>
      </Section>

      <Section id="mistake" heading="A nitrogen with four bonds and no charge">
        <p>
          A common first try at ammonium draws four hydrogens on the nitrogen and leaves the
          charge off. The count says <span data-guide-count="mistake">{count(mistakeRow)}</span>,
          and the drawing says {signed(mistakeRow.drawn)}. One of them is wrong, and it is the
          drawing.
        </p>
        <Figure id="mistake" figure={figures.mistake} opens={MISTAKE} />
        <p>
          The editor checks every atom against the number of bonds its element allows. A neutral
          nitrogen allows three. On this drawing the editor marks the error in three places:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>A red ring around the nitrogen, and a red band on each of its four bonds.</li>
          <li>
            The words <strong data-guide="canvas-label">{report.canvasLabel}</strong> beside the
            nitrogen.
          </li>
          <li>
            The red counter <strong data-guide="counter">{report.counter}</strong> in the status
            bar.
          </li>
        </ul>
        <p>Click the counter to open the list of errors. The row for the nitrogen reads:</p>
        <div
          data-guide="issue-row"
          className="w-fit max-w-full rounded-md border px-3 py-2 text-sm shadow-sm"
        >
          <p className="text-destructive text-xs font-semibold">{report.atomName}</p>
          <p data-guide="issue-message" className="text-foreground">
            {report.listMessage}
          </p>
          <p className="mt-1 flex flex-wrap gap-1">
            {report.fixTitles.map((title) => (
              <span
                key={title}
                data-guide="fix-title"
                className="text-foreground rounded border px-2 py-0.5 text-xs font-medium"
              >
                {title}
              </span>
            ))}
          </p>
        </div>
        <p>
          The button is the fix. Click it and the editor sets the nitrogen&apos;s charge to{" "}
          <span data-guide="charge-after-fix">{report.chargeAfterFix}</span> in one step. Undo puts
          the drawing back. The counter then reads 0 chemistry errors.
        </p>
        <Figure id="fixed" figure={figures.fixed} opens={FIXED} />
        <p>
          The editor offers a button only when it can show that the change clears the error. When
          the right change is your call, the row names the problem and offers no button.
        </p>
      </Section>

      <Section id="acetate" heading="A negative charge on oxygen">
        <p>
          In acetate, the oxygen with one bond has three lone pairs. Its count is{" "}
          <span data-guide-count="oxide">{count(oxide)}</span>. The C=O oxygen has two lone pairs
          and two bonds, so its count is{" "}
          <span data-guide-count="carbonyl">{count(carbonyl)}</span>.
        </p>
        <Figure id="acetate" figure={figures.acetate} opens={ACETATE} />
        <p>
          Leave the minus off and the editor shows no error. An oxygen with one bond is a normal
          OH oxygen, so the editor gives it a hydrogen. The formula in the status bar changes
          from <strong data-guide="formula-ion">{minus.ion}</strong> to{" "}
          <strong data-guide="formula-neutral">{minus.neutral}</strong>, which is acetic acid.
        </p>
        <p>
          So the editor catches an atom with too many bonds, but not a missing charge on an atom
          that can take a hydrogen instead. Check the formula whenever you draw an ion.
        </p>
      </Section>

      <Section id="editor" heading={`Draw charges and lone pairs in ${SITE_NAME}`}>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Draw the structure, or open one of the figures above in the editor.</li>
          <li>
            In the panel on the right, find <strong>Figure panels</strong>. Pick{" "}
            <strong>Lewis</strong> in its view menu and choose <strong>Add panel</strong>.
          </li>
          <li>
            Select an atom and press <Key id="structure.charge-up" /> to raise its charge by one,
            or <Key id="structure.charge-down" /> to lower it.
          </li>
          <li>Read the status bar. It shows the formula with its charge, and the error counter.</li>
        </ol>
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

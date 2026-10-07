/**
 * "Where are the carbons and hydrogens in a skeletal formula?"
 *
 * The reader is new to biochemistry and has a textbook full of zig-zag lines
 * with letters only at the ends. The page answers in its first paragraph,
 * then walks one molecule from the insert box, L-isoleucine, carbon by
 * carbon, with the skeletal panel and the explicit-H panel side by side.
 * It ends at the mistake the editor marks: a carbon with five bonds.
 *
 * ── EVERY NUMBER IS COMPUTED OR CITED, NEVER TYPED INTO THE PROSE ──────────
 *
 * Counts and the formula come from chem-core through
 * `skeletalFormulaNumbers()`; the drawing rules from `IUPAC_DRAWING`, by
 * section; the formula's check from `PUBCHEM_ISOLEUCINE`. Each computed
 * number sits in a `data-guide-number` span, which e2e/guide.spec.ts compares
 * with what the editor shows for the same molecule.
 *
 * ── A SERVER COMPONENT, LIKE THE JOURNAL GUIDE ─────────────────────────────
 *
 * Every link is a plain anchor from `@/lib/deployment`. "Open this figure in
 * the editor" opens the figure's document through `?example=` (decision
 * 127); the five-bond example has a link of its own and no figure.
 */

import type { ReactElement, ReactNode } from "react";

import { editorExampleHref, editorHref } from "@/lib/deployment";
import { SITE_NAME } from "@/lib/site";

import { guideBySlug } from "./guides";
import { IUPAC_DRAWING, PUBCHEM_ISOLEUCINE, skeletalFormulaNumbers } from "./skeletal-formula";

/** The example the last section links, which no figure draws. */
export const FIVE_BONDS_EXAMPLE = "skeletal-formula-five-bonds";

/** A computed number, tagged so the e2e spec can hold it to the editor. */
function N({ k, children }: { readonly k: string; readonly children: ReactNode }): ReactElement {
  return <span data-guide-number={k}>{children}</span>;
}

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

/** A link to one section of the IUPAC standard, named by its number. */
function Gr({
  section,
}: {
  readonly section: (typeof IUPAC_DRAWING.sections)[keyof typeof IUPAC_DRAWING.sections];
}): ReactElement {
  return (
    <a
      href={`${IUPAC_DRAWING.url}${section.anchor}`}
      data-guide="iupac-section"
      className="text-foreground underline underline-offset-2"
    >
      {section.id}
    </a>
  );
}

function fetchedOn(isoDate: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

const GUIDE = guideBySlug("skeletal-formula");
const [FIGURE] = GUIDE.figures;

const LINK =
  "text-foreground focus-visible:ring-ring block w-fit rounded-sm text-sm font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2";

export function SkeletalFormulaGuide(): ReactElement {
  const n = skeletalFormulaNumbers();
  const iupac = IUPAC_DRAWING;
  const s = iupac.sections;
  const lineEnds = n.carbons.filter((c) => c.lineEnd);
  const c1 = n.carbons[0]!;

  return (
    <article
      data-guide="skeletal-formula"
      className="text-muted-foreground mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6 [&_strong]:text-foreground [&_strong]:font-medium"
    >
      <header className="py-10 md:py-14">
        <p className="mb-3 text-sm font-medium tracking-wide uppercase">Guide</p>
        <h1 className="text-foreground text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {GUIDE.title}
        </h1>
        <p data-guide="answer" className="mt-6 text-lg leading-relaxed">
          Every corner and every line end with no letter is a carbon atom. Each carbon has four
          bonds, and hydrogens fill the bonds the drawing leaves out. Any other atom is written as
          a letter, with its hydrogens written beside it.
        </p>
      </header>

      <Section id="figure" heading="One molecule, drawn two ways">
        <p>
          L-isoleucine is one of the amino acids in proteins. Panel (a) is its skeletal formula.
          Panel (b) is the same molecule with every hydrogen drawn. The numbers in (a) are the editor&apos;s carbon numbers, counted from the
          carboxyl carbon, C1.
        </p>
        <figure className="space-y-2">
          <div className="inline-block max-w-full rounded-lg border bg-white p-3 shadow-sm">
            <div
              data-guide-figure="isoleucine"
              role="img"
              aria-label={FIGURE.alt}
              // CSS centimetres: the figure at the size it prints. Markup this
              // app generated at build time from its own document.
              style={{ width: `${n.figure.widthCm}cm` }}
              className="max-w-full [&>svg]:h-auto [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: n.figure.svg }}
            />
          </div>
          {/* A copy under a fresh id, stored only once edited (decision 127). */}
          <a
            href={editorExampleHref(FIGURE.example)}
            data-guide-open-example={FIGURE.example}
            className={LINK}
          >
            Open this figure in the editor
          </a>
        </figure>
      </Section>

      <Section id="carbons" heading="Find the carbons">
        <p>
          A corner is a point where two lines meet at an angle. The drawing does not label it, and
          IUPAC&apos;s drawing standard reads every unlabelled corner as a carbon (<Gr section={s.carbons} />).
          A line end with no letter is a carbon too. In the words of the same standard,{" "}
          <q data-guide="quote" className="text-foreground">
            {iupac.quote}
          </q>{" "}
          (<Gr section={s.lineEnds} />).
        </p>
        <p>
          L-isoleucine has <N k="carbon-count">{n.carbonCount}</N> carbons. Panel (b) writes a C
          at each one. <N k="line-end-count">{n.lineEndCount}</N> of them are line ends:{" "}
          {lineEnds.map((c, i) => (
            <span key={c.atomId}>
              {i === 0 ? "" : " and "}
              {c.name}
            </span>
          ))}
          . These are the ones a newcomer misses. Count only the corners and you find{" "}
          <N k="corner-count">{n.carbonCount - n.lineEndCount}</N> carbons.
        </p>
        <p>
          The line from C1 down to OH is not a line end. It ends at a letter, so it ends at an
          oxygen.
        </p>
      </Section>

      <Section id="hydrogens" heading="Count the hydrogens">
        <p>
          A carbon makes four bonds. Count the bonds drawn to it, with a double bond as two. The
          carbon carries one hydrogen for each bond that is missing.
        </p>
        <table data-guide="carbon-table" className="w-full text-left text-sm">
          <caption className="sr-only">Bonds drawn and hydrogens at each carbon of L-isoleucine</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="text-foreground py-1.5 pr-4 font-medium">Carbon</th>
              <th scope="col" className="text-foreground py-1.5 pr-4 font-medium">Bonds drawn</th>
              <th scope="col" className="text-foreground py-1.5 font-medium">Hydrogens</th>
            </tr>
          </thead>
          <tbody className="[&_td]:py-1.5 [&_td]:pr-4 [&_th]:py-1.5 [&_th]:pr-4 [&_th]:font-medium [&_tr]:border-b">
            {n.carbons.map((c) => (
              <tr key={c.atomId} data-guide-carbon={c.name}>
                <th scope="row" className="text-foreground">{c.name}</th>
                <td>
                  <span data-guide-bonds>{c.bondsDrawn}</span>
                  {c.hasDoubleBond ? " (one double bond)" : ""}
                </td>
                <td>
                  <span data-guide-hydrogens>{c.hydrogens}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          That is <N k="carbon-hydrogens">{n.hydrogensOnCarbon}</N> hydrogens on carbon. {c1.name}{" "}
          has <N k="c1-bonds">{c1.bondsDrawn}</N> bonds drawn and no hydrogen. The wedge at C2
          points toward you and the hashed bond at C3 points away. Each still counts as one bond.
        </p>
        <p>
          Nitrogen and oxygen are written as letters, and so are their hydrogens. The standard
          reads a written atom as carrying only the hydrogens written beside it (
          <Gr section={s.hydrogens} />
          ). Here H<sub>2</sub>N has <N k="nitrogen-hydrogens">{n.hydrogensOnNitrogen}</N> and
          OH has <N k="oxygen-hydrogens">{n.hydrogensOnOxygen}</N>.
        </p>
        <p>
          In all, L-isoleucine has <N k="hydrogen-count">{n.hydrogenCount}</N> hydrogens, and its
          formula is <N k="formula">{n.formulaUnicode}</N>.{" "}
          <a
            href={PUBCHEM_ISOLEUCINE.url}
            data-guide="pubchem"
            className="text-foreground underline underline-offset-2"
          >
            PubChem&apos;s record for {PUBCHEM_ISOLEUCINE.title}
          </a>{" "}
          gives the same formula.
        </p>
      </Section>

      <Section id="editor" heading={`Check your count in ${SITE_NAME}`}>
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Choose <strong>Insert</strong> in the top bar, type <kbd>isoleucine</kbd> and press
            Enter. The editor draws L-isoleucine beside what is on the canvas and gives its
            formula.
          </li>
          <li>
            Choose <strong>Figure panels</strong> above the canvas, then{" "}
            <strong data-guide="add-view">Explicit H</strong> under <strong>Add a view</strong>.
            The new panel draws every hydrogen.
          </li>
          <li>Compare your count with the panel, carbon by carbon.</li>
        </ol>
        <p>
          The editor also catches the reverse mistake. Draw a fifth bond to a carbon and it rings
          the atom in red, with the label{" "}
          <q data-guide="issue-label" className="text-foreground">
            {n.fiveBondLabel}
          </q>
          . It does not stop you drawing, so you can finish the structure first and fix the
          carbon after.
        </p>
        <a
          href={editorExampleHref(FIVE_BONDS_EXAMPLE)}
          data-guide-open-example={FIVE_BONDS_EXAMPLE}
          className={LINK}
        >
          Open L-isoleucine with a fifth bond on C1
        </a>
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

      <p className="border-t pt-6 text-sm">
        Drawing rules from{" "}
        <a href={iupac.url} data-guide="source" className="text-foreground underline underline-offset-2">
          {iupac.title}
        </a>
        , {iupac.citation} (
        <a href={iupac.doi} className="underline underline-offset-2">
          doi
        </a>
        ), read on{" "}
        <time dateTime={iupac.fetched} data-guide="fetched">
          {fetchedOn(iupac.fetched)}
        </time>
        .
      </p>
    </article>
  );
}

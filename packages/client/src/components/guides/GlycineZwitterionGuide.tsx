/**
 * "Glycine as a neutral molecule and as a zwitterion"
 *
 * A reader who asks this has two drawings of glycine with the same formula
 * and the same mass, and wants to know whether they are the same molecule.
 * The page answers no in its first paragraph, shows both, puts every reading
 * that agrees beside the one that does not, cites the PubChem record for each
 * form, and ends at the two key presses that turn one into the other.
 *
 * ── EVERY NUMBER IS COMPUTED OR CITED, NEVER TYPED INTO THE PROSE ──────────
 *
 * The editor's readings come from chem-core through `formReading()`, and the
 * difference between the forms from `diffMolecules`, the fidelity harness's
 * own comparison. PubChem's facts come from `PUBCHEM_GLYCINE`, which records
 * each URL and the date it was read. Each editor reading sits in a
 * `data-guide-number` span, which e2e/guide.spec.ts compares with what the
 * editor's status bar shows for the same figure.
 *
 * ── THE MODEL IS JournalFigureSizeGuide ────────────────────────────────────
 *
 * A server component that composes its figures at build time, with plain
 * anchors from `@/lib/deployment` and "Open this figure in the editor" under
 * each figure (decision 127). Whether the page is linked from anywhere is its
 * entry's `released` in `guides.ts` (decision 243).
 */

import type { ReactElement, ReactNode } from "react";

import { commandById, formatShortcut } from "@/editor/commands/registry";
import { editorExampleHref, editorHref } from "@/lib/deployment";
import { SITE_NAME } from "@/lib/site";

import { chargeList, formReading, formsDiff, PUBCHEM_GLYCINE, signed } from "./glycine-zwitterion";
import type { FormReading, GlycineFigure, PubChemRecord } from "./glycine-zwitterion";
import { guideBySlug } from "./guides";
import type { GuideFigure } from "./guides";

/** An editor reading, tagged so the e2e spec can hold it to the status bar. */
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

const GUIDE = guideBySlug("glycine-zwitterion");
const [NEUTRAL_FIGURE, ZWITTERION_FIGURE] = GUIDE.figures as readonly [GuideFigure, GuideFigure];

function GlycineFigureBlock({
  id,
  figure,
  caption,
  opens,
}: {
  readonly id: string;
  readonly figure: GlycineFigure;
  readonly caption: ReactNode;
  /** The guide figure this is, for its alt text and its editor link. */
  readonly opens: GuideFigure;
}): ReactElement {
  return (
    <figure className="space-y-2">
      <div className="inline-block max-w-full rounded-lg border bg-white p-3 shadow-sm">
        <div
          data-guide-figure={id}
          role="img"
          aria-label={opens.alt}
          // CSS centimetres, so both forms print at the same scale. Markup
          // this app generated at build time from its own document.
          style={{ width: `${figure.widthCm}cm` }}
          className="max-w-full [&>svg]:h-auto [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: figure.svg }}
        />
      </div>
      <figcaption className="text-sm">{caption}</figcaption>
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

function fetchedOn(isoDate: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

function RecordLink({ record, form }: { readonly record: PubChemRecord; readonly form: string }): ReactElement {
  return (
    <a
      href={record.url}
      data-guide-source={form}
      className="text-foreground underline underline-offset-2"
    >
      PubChem CID {record.cid}
    </a>
  );
}

/** One row of the comparison: a reading, its value in each form, and
 *  whether the two differ. */
function Row({
  k,
  label,
  neutral,
  zwitterion,
}: {
  readonly k: string;
  readonly label: string;
  readonly neutral: string;
  readonly zwitterion: string;
}): ReactElement {
  const same = neutral === zwitterion;
  return (
    <tr data-guide-row={k} data-guide-same={same ? "true" : "false"}>
      <th scope="row" className="text-foreground">
        {label}
      </th>
      <td>
        <N k={`neutral-${k}`}>{neutral}</N>
      </td>
      <td className={same ? undefined : "text-foreground font-medium"}>
        <N k={`zwitterion-${k}`}>{zwitterion}</N>
      </td>
    </tr>
  );
}

export function GlycineZwitterionGuide(): ReactElement {
  const neutral: FormReading = formReading("neutral");
  const zwitterion: FormReading = formReading("zwitterion");
  const diff = formsDiff();
  const pubchem = PUBCHEM_GLYCINE;
  const increase = formatShortcut(commandById("structure.charge-up").shortcut ?? "", false);
  const decrease = formatShortcut(commandById("structure.charge-down").shortcut ?? "", false);
  const separated = diff.find((d) => d.kind === "formal-charges");
  if (diff.length !== 1 || separated === undefined || separated.kind !== "formal-charges") {
    // The page says the formal charges are the one difference. If the
    // comparison ever reports more or less, the prose is wrong: fail the build.
    throw new Error(
      `The glycine guide expects one difference, the formal charges, and got: ${diff.map((d) => d.kind).join(", ")}.`,
    );
  }

  return (
    <article
      data-guide="glycine-zwitterion"
      className="text-muted-foreground mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6 [&_strong]:text-foreground [&_strong]:font-medium"
    >
      <header className="py-10 md:py-14">
        <p className="mb-3 text-sm font-medium tracking-wide uppercase">Guide</p>
        <h1 className="text-foreground text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {GUIDE.title}
        </h1>
        <p data-guide="answer" className="mt-6 text-lg leading-relaxed">
          Both forms of glycine have the sum formula <N k="formula">{neutral.formulaUnicode}</N> and
          the exact mass <N k="exact-mass">{neutral.exactMass}</N>. They are still two different
          structures. In the zwitterion, one hydrogen sits on the nitrogen instead of the oxygen.
          The nitrogen carries a +1 charge and the oxygen a −1 charge.
        </p>
        <p className="mt-4 text-lg leading-relaxed">
          A formula or a mass cannot tell the two apart. The formal charges can.
        </p>
      </header>

      <Section id="forms" heading="The two drawings">
        <p>
          Neutral glycine has an amino group, NH<sub>2</sub>, and a carboxylic acid group, COOH.
          The nitrogen has <N k="neutral-n-lone-pairs">{neutral.nitrogen.lonePairs}</N> lone pair,
          and the OH oxygen has <N k="neutral-o-lone-pairs">{neutral.hydroxylOxygen.lonePairs}</N>.
        </p>
        <GlycineFigureBlock
          id="neutral"
          figure={neutral.figure}
          opens={NEUTRAL_FIGURE}
          caption={<>Neutral glycine, skeletal (left) and Lewis (right).</>}
        />
        <p>
          The zwitterion has an ammonium group, NH<sub>3</sub>
          <sup>+</sup>, and a carboxylate group, CO<sub>2</sub>
          <sup>−</sup>. The nitrogen uses its lone pair to bond the third hydrogen, so it has{" "}
          <N k="zwitterion-n-lone-pairs">{zwitterion.nitrogen.lonePairs}</N> lone pairs. The
          oxygen that lost the hydrogen has{" "}
          <N k="zwitterion-o-lone-pairs">{zwitterion.hydroxylOxygen.lonePairs}</N>.
        </p>
        <GlycineFigureBlock
          id="zwitterion"
          figure={zwitterion.figure}
          opens={ZWITTERION_FIGURE}
          caption={<>The glycine zwitterion, skeletal (left) and Lewis (right).</>}
        />
        <p className="text-sm">
          Both figures are drawn at the same scale and in the same orientation, so the two atoms
          that change sit in the same place.
        </p>
      </Section>

      <Section id="compare" heading="What is the same, and what is different">
        <p>
          The table compares the two drawings above. {SITE_NAME} computes every value from the
          structure itself.
        </p>
        <table className="w-full text-left text-sm" data-guide="comparison">
          <caption className="sr-only">Neutral glycine and the glycine zwitterion compared</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-1.5 pr-4 font-medium">
                Reading
              </th>
              <th scope="col" className="py-1.5 pr-4 font-medium">
                Neutral
              </th>
              <th scope="col" className="py-1.5 font-medium">
                Zwitterion
              </th>
            </tr>
          </thead>
          <tbody className="[&_td]:py-1.5 [&_td]:pr-4 [&_td]:align-top [&_th]:py-1.5 [&_th]:pr-4 [&_th]:align-top [&_th]:font-medium [&_tr]:border-b">
            <Row k="formula" label="Sum formula" neutral={neutral.formulaUnicode} zwitterion={zwitterion.formulaUnicode} />
            <Row k="exact-mass" label="Exact mass" neutral={neutral.exactMass} zwitterion={zwitterion.exactMass} />
            <Row
              k="weight"
              label="Average mass (g/mol)"
              neutral={neutral.molecularWeight}
              zwitterion={zwitterion.molecularWeight}
            />
            <Row k="net-charge" label="Net charge" neutral={signed(neutral.netCharge)} zwitterion={signed(zwitterion.netCharge)} />
            <Row
              k="bond-orders"
              label="Bond orders"
              neutral={neutral.bondOrders.join(", ")}
              zwitterion={zwitterion.bondOrders.join(", ")}
            />
            <Row
              k="formal-charges"
              label="Formal charges"
              neutral={chargeList(separated.before)}
              zwitterion={chargeList(separated.after)}
            />
            <Row
              k="n-hydrogens"
              label="Hydrogens on N"
              neutral={String(neutral.nitrogen.hydrogens)}
              zwitterion={String(zwitterion.nitrogen.hydrogens)}
            />
            <Row
              k="o-hydrogens"
              label="Hydrogens on the single-bonded O"
              neutral={String(neutral.hydroxylOxygen.hydrogens)}
              zwitterion={String(zwitterion.hydroxylOxygen.hydrogens)}
            />
          </tbody>
        </table>
        <p>
          The +1 and −1 cancel, so the net charge is 0 for both. The status bar in the editor reads{" "}
          <strong>Charge neutral</strong> for the zwitterion too. It reports the net charge, not
          the charges on single atoms.
        </p>
        <p>
          When {SITE_NAME} writes a SMILES string or an InChI, RDKit does the writing.{" "}
          {SITE_NAME} then reads RDKit&apos;s version of the structure back and compares it with the drawing.
          That comparison checks the formal charges, not only the formula and the net charge. A
          check on those two alone would let the zwitterion come back as neutral glycine with no
          warning. The test suite runs the comparison on this pair.
        </p>
      </Section>

      <Section id="pubchem" heading="The PubChem records">
        <p>
          PubChem keeps a separate compound record for each form. Both records were read on{" "}
          <time dateTime={pubchem.fetched} data-guide="fetched">
            {fetchedOn(pubchem.fetched)}
          </time>
          .
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Neutral glycine: <RecordLink record={pubchem.neutral} form="neutral" />, titled “
            {pubchem.neutral.title}”.
          </li>
          <li>
            The zwitterion: <RecordLink record={pubchem.zwitterion} form="zwitterion" />, titled “
            {pubchem.zwitterion.title}”. The record lists “{pubchem.zwitterionSynonym}” among its
            synonyms.
          </li>
        </ul>
        <p>
          Both records give the formula {pubchem.neutral.molecularFormula}, the monoisotopic mass{" "}
          {pubchem.neutral.monoisotopicMass} and the molecular weight{" "}
          {pubchem.neutral.molecularWeight}. {SITE_NAME} gives the same values to the precision it
          shows. Both records also list the same InChIKey,{" "}
          <code className="text-foreground break-all">{pubchem.neutral.inchiKey}</code>. So the
          InChIKey does not tell the two forms apart either.
        </p>
      </Section>

      <Section id="editor" heading={`Draw both forms in ${SITE_NAME}`}>
        <p>
          Two charges turn neutral glycine into the zwitterion. You do not add a hydrogen by hand:{" "}
          {SITE_NAME} counts the hydrogens from the charges.
        </p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Open the neutral figure with the link under it. The insert box gives the same neutral
            glycine: choose <strong>Insert</strong> in the top bar and type <strong>glycine</strong>.
          </li>
          <li>
            Click the nitrogen. Press <kbd data-guide="shortcut-increase">{increase}</kbd>. Its
            label gains a third hydrogen and a + sign.
          </li>
          <li>
            Click the oxygen of the OH group. Press <kbd data-guide="shortcut-decrease">{decrease}</kbd>.
            Its label changes from OH to O<sup>−</sup>.
          </li>
          <li>
            Click an empty part of the canvas, so the status bar measures the whole structure. It
            still shows <N k="status-formula">{zwitterion.formulaUnicode}</N>, Exact{" "}
            <N k="status-exact-mass">{zwitterion.exactMass}</N> and Charge neutral.
          </li>
        </ol>
        <p>
          The Lewis panel redraws the lone pairs as you go. The nitrogen loses its pair, and the
          oxygen gains a third.
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

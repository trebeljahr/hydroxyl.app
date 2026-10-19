/**
 * `/privacy` — every server the browser contacts, and what each one receives.
 *
 * A server component with no client state, written like `/about`: plain
 * anchors from `@/lib/deployment`, flat in the file export.
 *
 * This page and the app must agree. A new request to a host that is not
 * listed under "Servers your browser contacts", or a change to what the app
 * keeps in the browser, updates this page and `UPDATED_ON` in the same change.
 * That includes setting the two `NEXT_PUBLIC_PLAUSIBLE_…` repository variables:
 * the live site has no analytics of its own until they exist (see
 * `@/lib/analytics`).
 */

import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";

import { GuidePageShell } from "@/components/guides/GuidePageShell";
import { PUBCHEM_HOST } from "@/lib/io/pubchem";
import { FEEDBACK_ADDRESS } from "@/lib/feedback";
import { SITE_NAME } from "@/lib/site";

const UPDATED_ON = "October 19, 2026";
const PRIVACY_ADDRESS = "privacy@hydroxyl.app";

const DESCRIPTION =
  "Every server your browser contacts on hydroxyl.app, what each one receives, what the app keeps " +
  "in your browser, and your rights under the GDPR.";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: DESCRIPTION,
  alternates: { canonical: "/privacy" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: "/privacy",
    title: `Privacy Policy | ${SITE_NAME}`,
    description: DESCRIPTION,
  },
};

const linkClass = "text-foreground underline underline-offset-2";

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }): ReactElement {
  return (
    <section>
      <h2 className="text-foreground text-lg font-semibold tracking-tight">{title}</h2>
      <div className="text-muted-foreground mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Host({ children }: { readonly children: ReactNode }): ReactElement {
  return <code className="text-foreground font-mono text-[0.92em]">{children}</code>;
}

function Mail({ address }: { readonly address: string }): ReactElement {
  return (
    <a href={`mailto:${address}`} className={linkClass}>
      {address}
    </a>
  );
}

export default function PrivacyPage(): ReactElement {
  return (
    <GuidePageShell>
      <article className="mx-auto max-w-3xl space-y-10 px-4 py-12 text-sm leading-relaxed sm:px-6">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
          <p className="text-muted-foreground mt-2 italic">Last updated: {UPDATED_ON}</p>
          <p className="mt-6">
            {SITE_NAME} runs in your browser. The molecules you draw stay on your device. This page lists
            every server your browser contacts when you use hydroxyl.app, and what each one receives. The site
            has no accounts and no forms. It sets no cookies.
          </p>
        </header>

        <Section title="Controller">
          <p>
            The controller under the EU General Data Protection Regulation (GDPR) is Rico Trebeljahr, c/o Block
            Services, Stuttgarter Str. 106, 70736 Fellbach, Germany. Email for privacy questions:{" "}
            <Mail address={PRIVACY_ADDRESS} />.
          </p>
        </Section>

        <Section title="Servers your browser contacts">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <Host>hydroxyl.app</Host>: the app itself, served by Cloudflare. Pages, scripts, the chemistry
              engine and its data all come from here.
            </li>
            <li>
              <Host>static.cloudflareinsights.com</Host>: the script of Cloudflare Web Analytics. Visitors in
              the EU, the EEA, the United Kingdom and Switzerland do not get it.
            </li>
            <li>
              <Host>{PUBCHEM_HOST}</Host>: PubChem. Your browser contacts it only when you click “Look up on
              PubChem” in the insert box.
            </li>
          </ul>
          <p>
            No other server receives a request from your browser. A link to another site, such as the donation
            page on ricos.site or a source in a guide, contacts that site only when you click it.
          </p>
        </Section>

        <Section title="Hosting by Cloudflare">
          <p>
            The app is a set of static files. Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107, USA,
            serves them from its Worker <Host>chemistry-sketcher-client</Host>. No code of mine runs when you
            load a page.
          </p>
          <p>
            Cloudflare receives your IP address, the address of the page, the user agent and the referrer of
            each request. It uses them to deliver the site and to protect it against abuse. I do not export or
            keep logs of these requests.
          </p>
          <p>
            The app has no font service and no image service. It uses the fonts installed on your device. Its
            icons and the chemistry engine are copies on hydroxyl.app.
          </p>
          <p>Legal basis: Art. 6 (1) (f) GDPR (legitimate interest in delivering the site securely).</p>
        </Section>

        <Section title="Cloudflare Web Analytics">
          <p>
            Cloudflare adds the script of{" "}
            <a href="https://developers.cloudflare.com/web-analytics/" className={linkClass} rel="noreferrer">
              Cloudflare Web Analytics
            </a>{" "}
            to each page. Your browser loads it from <Host>static.cloudflareinsights.com</Host>, and the script
            sends its report to <Host>hydroxyl.app/cdn-cgi/rum</Host>.
          </p>
          <p>
            The report holds the page URL, the referrer and how long the page took to load. The timings include
            Largest Contentful Paint, Interaction to Next Paint and Cumulative Layout Shift. Cloudflare shows me
            totals by page, country, browser and device type. The report holds nothing from your sketches.
          </p>
          <p>
            The script sets no cookies and stores nothing on your device. It gives each page view a random ID
            and keeps no ID from one page view to the next. Cloudflare receives your IP address with the report,
            discards it at the nearest data center and does not store it.
          </p>
          <p>
            Cloudflare does not add the script for visitors who connect through a Cloudflare data center in the
            EU, the EEA, the United Kingdom or Switzerland. For all other visitors the legal basis is Art. 6 (1)
            (f) GDPR (legitimate interest in knowing how fast the pages load). You can object at any time, or
            block <Host>static.cloudflareinsights.com</Host> with a content blocker.
          </p>
        </Section>

        <Section title="PubChem lookup">
          <p>
            The insert box can turn a compound name or a CAS number into a structure. When you click “Look up on
            PubChem”, your browser sends the text you typed to <Host>{PUBCHEM_HOST}</Host>. Typing does not send
            it, and neither does Enter.
          </p>
          <p>
            PubChem is a service of the National Center for Biotechnology Information (NCBI), part of the U.S.
            National Library of Medicine. It receives the text, your IP address and your user agent. The request
            carries no cookies and no referrer, so PubChem does not learn which page or sketch it came from. The
            drawing itself is never sent.
          </p>
          <p>
            You start this transfer to the United States yourself. I have no contract with NCBI. The editor
            works without the lookup, so skip it if you do not want to send the text. Legal basis: Art. 6 (1) (f)
            GDPR (legitimate interest in offering the lookup you asked for).
          </p>
        </Section>

        <Section title="Data in your browser">
          <p>
            The app keeps your work in your browser. None of it leaves your device, and you can delete all of it
            by clearing the site data in your browser.
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <Host>IndexedDB “chemistry-sketcher”</Host>: your saved sketches and your library.
            </li>
            <li>
              <Host>chemistry-sketcher/unsaved/…</Host> in local storage: the edits of a sketch that you have not
              saved yet. The next save deletes them.
            </li>
            <li>
              <Host>chemistry-sketcher.theme</Host> and <Host>chemistry-sketcher.recent-elements</Host> in local
              storage: your theme choice and the elements you used last.
            </li>
            <li>
              <Host>donation-supported-at</Host> in local storage: the time you came back from the donation page
              on ricos.site. The app writes it only when the address has <code className="font-mono">?supported=1</code>.
              Nothing reads it yet.
            </li>
            <li>
              <Host>chemistry-release-reload:…</Host> in session storage: a mark that stops a page from reloading
              twice in a row after an update. It ends with the tab.
            </li>
            <li>
              Cache Storage: copies of the app’s own files, so the app opens without a connection. The app asks
              the server for <Host>/releases.json</Host> to see whether a new version exists.
            </li>
          </ul>
          <p>
            Open tabs of the app tell each other about changes to a sketch through a browser channel. The
            message stays inside your browser. The button “Ask the browser to keep them” on the sketches page
            asks your browser to protect this data from automatic clearing.
          </p>
          <p>
            Legal basis: § 25 (2) No. 2 TDDDG (storage that the app needs to give you the sketches and settings
            you asked for). The donation entry records an action of yours.
          </p>
        </Section>

        <Section title="Email">
          <p>
            If you write to <Mail address={FEEDBACK_ADDRESS} /> or <Mail address={PRIVACY_ADDRESS} />, Cloudflare
            Email Routing forwards your message to my mailbox at Google. I use your message and your address to
            answer you, and I delete the thread when the matter is done. Legal basis: Art. 6 (1) (f) GDPR
            (legitimate interest in answering you).
          </p>
        </Section>

        <Section title="Transfers outside the EU">
          <p>
            Cloudflare, Inc. is established in the United States. It handles each request in a data center of
            its network, normally the one nearest to you. Access by U.S. authorities under U.S. law cannot be
            fully excluded. The PubChem lookup goes to the United States as described above.
          </p>
        </Section>

        <Section title="Storage period">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Cloudflare Web Analytics keeps totals by page, country, browser and device type. Cloudflare does
              not store the IP address.
            </li>
            <li>PubChem keeps what its own policy says. I receive no copy of the request.</li>
            <li>Everything under “Data in your browser” stays there until you delete it.</li>
          </ul>
        </Section>

        <Section title="Your rights">
          <p>Under the GDPR you have the right to:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>access the personal data held about you (Art. 15);</li>
            <li>have inaccurate data corrected (Art. 16);</li>
            <li>have your data deleted (Art. 17), unless a legal obligation requires me to keep it;</li>
            <li>restrict processing (Art. 18);</li>
            <li>receive your data in a portable format (Art. 20);</li>
            <li>object to processing based on legitimate interest (Art. 21).</li>
          </ul>
          <p>
            To use any of these rights, email <Mail address={PRIVACY_ADDRESS} />. You can also complain to a
            supervisory authority (Art. 77 GDPR). The authority responsible for me is the Landesbeauftragte für
            den Datenschutz und die Informationsfreiheit Baden-Württemberg.
          </p>
          <p>The app makes no automated decisions about you and builds no profile of you (Art. 22 GDPR).</p>
        </Section>

        <Section title="Changes">
          <p>
            I update this page when the app starts or stops contacting a server, or changes what it keeps in your
            browser. The date at the top shows the last change.
          </p>
        </Section>
      </article>
    </GuidePageShell>
  );
}

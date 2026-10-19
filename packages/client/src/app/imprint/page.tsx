/**
 * `/imprint` — the provider information that § 5 DDG and § 18 (2) MStV require
 * on every site that is run as a regular activity.
 *
 * A server component with no client state, written like `/about` and
 * `/privacy`: plain anchors from `@/lib/deployment`, flat in the file export.
 * The name and address are the same on every site of the operator.
 */

import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";

import { GuidePageShell } from "@/components/guides/GuidePageShell";
import { privacyHref, thirdPartyNoticesHref } from "@/lib/deployment";
import { SITE_NAME } from "@/lib/site";

const IMPRINT_ADDRESS = "imprint@hydroxyl.app";

const DESCRIPTION = "Provider information for hydroxyl.app, a chemical structure editor by Rico Trebeljahr.";

export const metadata: Metadata = {
  title: "Imprint",
  description: DESCRIPTION,
  alternates: { canonical: "/imprint" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: "/imprint",
    title: `Imprint | ${SITE_NAME}`,
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

function Address(): ReactElement {
  return (
    <p>
      Rico Trebeljahr
      <br />
      c/o Block Services
      <br />
      Stuttgarter Str. 106
      <br />
      70736 Fellbach
      <br />
      Germany
    </p>
  );
}

export default function ImprintPage(): ReactElement {
  return (
    <GuidePageShell>
      <article className="mx-auto max-w-3xl space-y-10 px-4 py-12 text-sm leading-relaxed sm:px-6">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Imprint</h1>
          <p className="text-muted-foreground mt-2 italic">
            Information pursuant to § 5 DDG (German Digital Services Act) and § 18 (2) MStV (Interstate Media
            Treaty).
          </p>
        </header>

        <Section title="Service Provider">
          <Address />
        </Section>

        <Section title="Contact">
          <p>
            Email:{" "}
            <a href={`mailto:${IMPRINT_ADDRESS}`} className={linkClass}>
              {IMPRINT_ADDRESS}
            </a>
          </p>
        </Section>

        <Section title="Person Responsible for Content (§ 18 (2) MStV)">
          <Address />
        </Section>

        <Section title="Data Protection">
          <p>
            What the site sends to which server, and what it keeps in your browser, is on the{" "}
            <a href={privacyHref()} className={linkClass}>
              privacy page
            </a>
            .
          </p>
        </Section>

        <Section title="Liability for Content">
          <p>
            As a service provider, I am responsible for my own content on these pages in accordance with § 7 (1)
            DDG and general laws. However, pursuant to §§ 8 to 10 DDG, I am not obligated as a service provider
            to monitor transmitted or stored third-party information or to investigate circumstances that
            indicate illegal activity.
          </p>
          <p>
            Obligations to remove or block the use of information under general laws remain unaffected. However,
            liability in this regard is only possible from the point in time at which a specific legal violation
            becomes known. Upon becoming aware of such violations, I will remove this content immediately.
          </p>
        </Section>

        <Section title="Liability for Links">
          <p>
            This site contains links to external websites of third parties over whose content I have no
            influence. Therefore, I cannot assume any liability for these third-party contents. The respective
            provider or operator of the pages is always responsible for the content of the linked pages.
          </p>
        </Section>

        <Section title="Copyright and Licences">
          <p>
            The texts and other content that the site operator created for these pages are subject to German
            copyright law. The source code of the app is published under the MIT licence. The licences of the
            components it includes are in the{" "}
            <a href={thirdPartyNoticesHref()} className={linkClass}>
              third-party licences notice
            </a>
            .
          </p>
        </Section>
      </article>
    </GuidePageShell>
  );
}

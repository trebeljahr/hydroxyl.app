import type { Metadata } from "next";
import "@/styles/globals.css";

import { Analytics } from "@/components/Analytics";
import { DonationReturn } from "@/components/DonationReturn";
import { ReleaseLifetime } from "@/components/ReleaseLifetime";
import { siteUrl } from "@/lib/deployment";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  // Makes the landing pages' relative `og:image` and `og:url` absolute, on
  // the domain in .hatchkit.json (decisions 122 and 138).
  metadataBase: new URL(siteUrl()),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  other: { "build-sha": process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "development" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased">
        <Analytics />
        <DonationReturn />
        <ReleaseLifetime />
        {children}
      </body>
    </html>
  );
}

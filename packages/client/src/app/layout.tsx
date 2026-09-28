import type { Metadata } from "next";
import "@/styles/globals.css";

import { DonationReturn } from "@/components/DonationReturn";

export const metadata: Metadata = {
  title: {
    default: "Chemistry Sketcher",
    template: "%s | Chemistry Sketcher",
  },
  description:
    "A chemical structure editor for publication figures. Draw a molecule once and " +
    "export skeletal, Lewis and formula views as one figure, sized for a journal column.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased">
        <DonationReturn />
        {children}
      </body>
    </html>
  );
}

/**
 * `/`. The recents grid is a client component, because it reads IndexedDB;
 * the landing page it shows to a browser with no sketches is rendered here,
 * on the server, at build time, and handed over as a prop. See the header of
 * `RecentsPage.tsx`.
 */

import type { ReactElement } from "react";

import { Landing } from "@/components/landing/Landing";

import RecentsPage from "./RecentsPage";

export default function Page(): ReactElement {
  return <RecentsPage landing={<Landing />} />;
}

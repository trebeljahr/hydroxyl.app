import { PAGEVIEW_SCRIPT_ID, pageviewScript, plausibleSettings } from "@/lib/analytics";

/**
 * The Plausible pageview, or nothing (decisions 136 and 170).
 *
 * A server component on purpose: the script is written into the HTML only
 * when this build has settings, and none of `@/lib/analytics` reaches a
 * client bundle, so the static export ships no analytics code at all. An
 * inline script runs when the HTML is parsed, once per page load, which is
 * one pageview per page since every link in the app is a plain anchor.
 */
export function Analytics(): React.ReactElement | null {
  const settings = plausibleSettings();
  if (settings === null) return null;
  return (
    <script id={PAGEVIEW_SCRIPT_ID} dangerouslySetInnerHTML={{ __html: pageviewScript(settings) }} />
  );
}

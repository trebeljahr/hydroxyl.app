import { defineConfig, devices } from "@playwright/test";

import { E2E_COMMIT } from "./e2e/support/release";

/**
 * 6337 by default, overridable through PORT — the same convention the client's
 * own `dev` and `start` scripts already use.
 *
 * The override is not a nicety. Development here happens in several git
 * worktrees at once, and a `pnpm dev` from any one of them owns 6337; with the
 * port hardcoded, `reuseExistingServer` below then points every worktree's e2e
 * run at whichever checkout happens to be serving, so a spec passes or fails
 * against code that is not the code under test. Running with
 * `PORT=<something free> pnpm test:e2e` builds and serves THIS tree instead.
 */
const PORT = Number(process.env.PORT ?? 6337);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // *.spec.ts is Playwright, *.test.ts(x) is Vitest. Keep the split: with
  // no testDir Playwright would default to the config's directory and
  // collect every Vitest file under packages/.
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Undefined lets Playwright pick ~half the cores, i.e. five concurrent
  // Chromium instances at several hundred MB each. With several agent
  // sessions building this repo at once that is what tips the machine
  // into swap, so cap it locally too.
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  // Service workers BLOCKED by default: a request a worker answers never
  // reaches `page.route`, so the offline worker (decision 239) would quietly
  // disarm every spec that intercepts the network. e2e/pwa.spec.ts turns
  // them back on for itself.
  use: { baseURL, trace: "on-first-retry", serviceWorkers: "block" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // What production serves (decision 257): the web export, served by the
    // same Workers runtime with the same `_headers`, 307 trailing-slash
    // redirects and 404 page. build:web chains build:deps (chem-core tsc, then
    // shared tsc) before `next build`, so this works on a clean checkout. cwd
    // defaults to this config's directory, i.e. the repo root, where
    // wrangler.jsonc names packages/client/out. Wrangler is pinned to the
    // version the release workflow uploads with.
    //
    // The two release-identity files a deploy writes are written here too
    // (one release, carrying nothing), so `ReleaseLifetime` finds this build
    // listed instead of logging a 404 into every spec's console.
    command: [
      "pnpm run build:web",
      `node scripts/write-version.mjs packages/client/out ${E2E_COMMIT}`,
      `node -e "require('fs').writeFileSync('packages/client/out/releases.json', JSON.stringify({ schema: 2, head: '${E2E_COMMIT}', window: ['${E2E_COMMIT}'], releases: ['${E2E_COMMIT}'] }))"`,
      `npx --yes wrangler@4.145.0 dev --port ${PORT} --ip 127.0.0.1 --show-interactive-dev-session=false`,
    ].join(" && "),
    url: baseURL,
    // 6337 is also the dev port. Locally, reuse a running `pnpm dev`
    // rather than fighting it for the port; in CI always build fresh.
    reuseExistingServer: !process.env.CI,
    // A cold chem-core + shared tsc plus `next build` is far past
    // Playwright's 60s default, especially on a CI runner.
    timeout: 300_000,
    // The Plausible settings build the pageview script into every page, the
    // way a deploy with `hatchkit add` done does, so e2e/analytics.spec.ts can
    // read what it sends. The host is reserved (.invalid) and that spec
    // intercepts it. Every other spec stays off the network because the script
    // sends nothing while `navigator.webdriver` is set.
    //
    // A release identity, so `ReleaseLifetime` runs as it does in production.
    // The served `/releases.json` lists it, so the check does nothing, except
    // in e2e/release-reload.spec.ts, which answers that request itself.
    env: {
      NEXT_PUBLIC_PLAUSIBLE_DOMAIN: "hydroxyl.app",
      NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL: "https://plausible.e2e.invalid/js/script.js",
      NEXT_PUBLIC_BUILD_COMMIT: E2E_COMMIT,
    },
  },
});

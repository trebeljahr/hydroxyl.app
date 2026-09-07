import { defineConfig, devices } from "@playwright/test";

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
  use: { baseURL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // build:client chains build:deps (chem-core tsc, then shared tsc)
    // before `next build`, so this works on a clean checkout. cwd
    // defaults to this config's directory, i.e. the repo root.
    command: "pnpm run build:client && pnpm --filter @starter/client run start",
    url: baseURL,
    // 6337 is also the dev port. Locally, reuse a running `pnpm dev`
    // rather than fighting it for the port; in CI always build fresh.
    reuseExistingServer: !process.env.CI,
    // A cold chem-core + shared tsc plus `next build` is far past
    // Playwright's 60s default, especially on a CI runner.
    timeout: 300_000,
    // NEXT_FILE_EXPORT must stay unset: output:"export" emits no server
    // for `next start` to run.
    env: { PORT: String(PORT), NEXT_FILE_EXPORT: "" },
  },
});

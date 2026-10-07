import { expect as baseExpect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The installable, offline web app — decision 239.
 *
 * Every other spec runs with service workers BLOCKED (playwright.config.ts):
 * a request a worker answers never reaches `page.route`, so a worker would
 * silently disarm their interceptions. This file turns them back on.
 *
 * What only a browser proves: that the head links a manifest Chrome accepts,
 * that the worker registers and takes control, and that after one online
 * visit the editor reloads with the network gone and still reads a SMILES
 * through the RDKit wasm.
 */

test.use({ serviceWorkers: "allow" });
// The first visit precaches the build and, installed, the 6.9 MB wasm.
test.describe.configure({ timeout: 120_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const SCENE = '[data-canvas-root] [data-layer="scene"]';
const FORMULA = '[data-status="formula"]';
const MESSAGE = '[data-status="message"]';
const INPUT = '[data-shell="insert-input"]';
const OPTIONS = '[data-shell="insert-candidates"] [role="option"]';
const RDKIT_ASSET = /RDKit_minimal|rdkit\.worker|\.wasm(\?|$)/;

/** Waits until the worker has installed (precache done) and controls the page. */
async function controlled(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 30_000 })
    .toBe(true);
}

async function cachedRdkit(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const cache = await caches.open("sketcher-rdkit-v1");
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  });
}

async function importSmiles(page: Page, smiles: string, formula: string, total: string): Promise<void> {
  await page.locator('[data-command="structure.insert"]').click();
  await expect(page.locator(INPUT)).toBeFocused();
  await page.locator(INPUT).fill(smiles);
  await expect(page.locator(OPTIONS).first()).toContainText("Read as SMILES");
  await page.keyboard.press("Enter");
  await expect(page.locator(MESSAGE)).toHaveText(`Inserted ${smiles} (${formula})`, { timeout: 30_000 });
  await expect(page.locator(FORMULA)).toHaveText(total);
}

test("the head links a manifest named after the site, with installable icons", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).not.toBeNull();
  const response = await request.get(href ?? "");
  expect(response.status()).toBe(200);
  const manifest = (await response.json()) as {
    name: string;
    display: string;
    start_url: string;
    icons: { src: string; sizes: string }[];
  };
  expect(manifest.name).toBe(await page.locator('meta[property="og:site_name"]').getAttribute("content"));
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/");
  for (const icon of manifest.icons) {
    expect((await request.get(icon.src)).status(), icon.src).toBe(200);
  }
});

test("the worker registers and controls the page", async ({ page }) => {
  await page.goto("/");
  await controlled(page);
  const script = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL);
  expect(new URL(script ?? "").pathname).toBe("/sw.js");
});

test("in a browser tab the worker still fetches nothing from RDKit until an import asks", async ({ page }) => {
  // e2e/rdkit.spec.ts's rule, with the worker running.
  const rdkitRequests: string[] = [];
  page.on("request", (request) => {
    if (RDKIT_ASSET.test(request.url())) rdkitRequests.push(request.url());
  });
  await page.goto("/editor");
  await controlled(page);
  await page.waitForLoadState("networkidle");
  expect(rdkitRequests).toEqual([]);
  expect(await cachedRdkit(page)).toEqual([]);
});

test("after one online visit, /editor reloads offline and imports a SMILES", async ({ page, context }) => {
  // An installed app (display-mode: standalone) fetches RDKit ahead of use,
  // so this visit never imports anything online.
  // Chromium's media emulation has no display-mode feature, so this reports
  // installed the way an iOS Home Screen app does.
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));

  await page.goto("/editor");
  await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(6);
  await controlled(page);
  await expect
    .poll(() => cachedRdkit(page), { timeout: 30_000 })
    .toEqual(expect.arrayContaining(["/rdkit/rdkit.worker.js", "/rdkit/RDKit_minimal.js", "/rdkit/RDKit_minimal.wasm"]));

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(6);
  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");
  // Pyrrole: the [nH] is the hydrogen a careless reader loses.
  await importSmiles(page, "c1cc[nH]c1", "C₄H₅N", "C₁₀H₁₁N");

  // ?example= is read by the page, so the cached /editor/ serves it too.
  await page.goto("/editor?example=landing");
  await expect(page.locator(FORMULA)).toHaveText("C₂H₄O₂");
});

test("in a tab, RDKit is kept after its first use and works offline from then on", async ({ page, context }) => {
  await page.goto("/editor");
  await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(6);
  await controlled(page);
  await importSmiles(page, "CCO", "C₂H₆O", "C₈H₁₂O");
  await expect.poll(() => cachedRdkit(page)).toHaveLength(3);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");
  await importSmiles(page, "c1cc[nH]c1", "C₄H₅N", "C₁₀H₁₁N");
});

import { expect, test } from "@playwright/test";
import type { Page, Request } from "@playwright/test";

/**
 * What analytics sends, read off the wire (decisions 136 and 170).
 *
 * The landing page says "the structures you draw do not leave your computer".
 * This draws a structure, reopens it by `?doc=`, leaves it through the recents
 * link, and then checks every request the browser made to another host: each
 * one must be a Plausible pageview, and each pageview must be exactly origin +
 * path, the site domain and a referrer that names no page of this site.
 *
 * playwright.config.ts builds the server with Plausible settings on a
 * reserved `.invalid` host, which this spec intercepts. The pageview script
 * sends nothing under automation, so the spec clears `navigator.webdriver`
 * first; every other spec leaves it set and stays off the network.
 *
 * Against a server built without those settings (a reused `pnpm dev`), no
 * pageview arrives and the count assertion fails. Run with a free PORT.
 */

const PLAUSIBLE_ORIGIN = "https://plausible.e2e.invalid";
const DOMAIN = "chemistry.trebeljahr.com";

const SCENE_ATOM = '[data-canvas-root] [data-layer="scene"] circle[data-atom-id]';
const FORMULA = '[data-status="formula"]';
const SAVE_STATE = '[data-status="save-state"]';
const RECENTS_LINK = '[data-shell="recents-link"]';

interface Pageview {
  readonly request: Request;
  readonly body: string;
}

/** Every request to a host other than the app's, and the pageviews among them. */
function watchTheWire(page: Page, appOrigin: string): { external: string[]; pageviews: Pageview[] } {
  const external: string[] = [];
  const pageviews: Pageview[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== appOrigin && url.protocol !== "data:" && url.protocol !== "blob:") {
      external.push(request.url());
    }
  });
  void page.route(`${PLAUSIBLE_ORIGIN}/**`, async (route) => {
    pageviews.push({ request: route.request(), body: route.request().postData() ?? "" });
    await route.fulfill({ status: 202, body: "ok" });
  });
  return { external, pageviews };
}

/** Sprouts a bond off benzene's lowest carbon: benzene becomes toluene. */
async function drawAMethyl(page: Page): Promise<void> {
  await expect(page.locator(SCENE_ATOM)).toHaveCount(6);
  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");
  const lowest = await page.locator(SCENE_ATOM).evaluateAll((circles) => {
    const centres = circles.map((circle) => {
      const box = circle.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
    return centres.reduce((low, c) => (c.y > low.y ? c : low));
  });
  await page.mouse.move(lowest.x, lowest.y);
  await page.mouse.down();
  await page.mouse.move(lowest.x, lowest.y + 90, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(FORMULA)).toHaveText("C₇H₈");
}

test("a pageview carries the path and the domain, and nothing from a document", async ({
  page,
  baseURL,
}) => {
  const appOrigin = new URL(baseURL!).origin;
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "webdriver", { configurable: true, get: () => false });
  });
  const { external, pageviews } = watchTheWire(page, appOrigin);

  // Draw, and let it save, so the document has an id worth leaking.
  await page.goto("/editor");
  await drawAMethyl(page);
  await expect(page.locator(`${SAVE_STATE}[data-save-status="saved"]`)).toBeVisible({
    timeout: 10_000,
  });
  const docId = await page.locator('[data-shell="top-bar"]').getAttribute("data-doc-id");
  expect(docId, "the drawn sketch should have an id").toBeTruthy();

  // Reopen it by URL: the query now names the document.
  await page.goto(`/editor?doc=${encodeURIComponent(docId!)}`);
  await expect(page.locator(FORMULA)).toHaveText("C₇H₈");
  expect(new URL(page.url()).searchParams.get("doc")).toBe(docId);

  // Leave through a plain anchor, so the next page's document.referrer is
  // the full `/editor/?doc=…` URL.
  await page.locator(RECENTS_LINK).click();
  await page.waitForURL(`${appOrigin}/`);
  expect(await page.evaluate(() => document.referrer)).toContain(docId!);

  // Arrive from another site whose link carried a query of its own.
  await page.goto("/about/", { referer: "https://news.example/item?id=42#comments" });

  await expect.poll(() => pageviews.length, { timeout: 10_000 }).toBe(4);
  // One more beat, so a late or duplicated event would still be counted.
  await page.waitForTimeout(500);
  expect(pageviews).toHaveLength(4);

  expect(
    external.filter((url) => !url.startsWith(`${PLAUSIBLE_ORIGIN}/`)),
    "nothing but the pageview may leave for another host",
  ).toEqual([]);

  const bodies = pageviews.map(({ body }) => JSON.parse(body) as unknown);
  expect(bodies).toEqual([
    { n: "pageview", u: `${appOrigin}/editor/`, d: DOMAIN, r: null },
    { n: "pageview", u: `${appOrigin}/editor/`, d: DOMAIN, r: null },
    { n: "pageview", u: `${appOrigin}/`, d: DOMAIN, r: null },
    { n: "pageview", u: `${appOrigin}/about/`, d: DOMAIN, r: "https://news.example/item" },
  ]);

  // The exact bodies above already leave no room; these say what is NOT there
  // in the terms the landing page's promise is made in.
  const toluene = ["Cc1ccccc1", "c1ccccc1", "CC1=CC=CC=C1", "C7H8", "C₇H₈"];
  const molfile = ["V2000", "V3000", "M  END"];
  for (const { request, body } of pageviews) {
    const url = new URL(request.url());
    expect(url.href).toBe(`${PLAUSIBLE_ORIGIN}/api/event`);
    expect(request.method()).toBe("POST");
    for (const text of [body, url.href]) {
      expect(text).not.toContain(docId!);
      expect(text).not.toContain("?");
      expect(text).not.toContain("doc=");
      for (const fragment of [...toluene, ...molfile]) expect(text).not.toContain(fragment);
    }
    const headers = await request.allHeaders();
    expect(headers.cookie, "the pageview must carry no cookie").toBeUndefined();
    expect(headers.referer, "the pageview must carry no Referer").toBeUndefined();
  }
});

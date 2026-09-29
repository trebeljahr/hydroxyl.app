import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * `sitemap.xml` and `robots.txt` as the standalone server serves them
 * (decision 122). The static export's copies are checked on the files by
 * `packages/client/scripts/check-export.mjs`, since `next start` cannot serve
 * an export.
 *
 * The expected host is read from `.hatchkit.json` here rather than taken from
 * the app, so a wrong derivation in `next.config.ts` cannot also be the
 * expectation. The specs run from the repo root; Playwright compiles them to
 * CommonJS, so `import.meta.url` is not available to locate the file.
 */

const { domain } = JSON.parse(readFileSync(join(process.cwd(), ".hatchkit.json"), "utf8")) as {
  domain: string;
};
const SITE = `https://${domain}/`;

test("the sitemap lists the landing and the about page, and each answers without a redirect", async ({
  request,
}) => {
  // maxRedirects 0 throughout: trailingSlash:true redirects extensionless
  // paths, and a sitemap or an entry that 308s is one a crawler reports.
  const response = await request.get("/sitemap.xml", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("xml");

  const locs = [...(await response.text()).matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  expect(locs).toEqual([SITE, `${SITE}about/`]);

  for (const loc of locs) {
    const page = await request.get(new URL(loc!).pathname, { maxRedirects: 0 });
    expect(page.status(), loc).toBe(200);
  }
});

test("robots.txt closes the editor and points at the sitemap", async ({ request }) => {
  const response = await request.get("/robots.txt", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  const lines = (await response.text()).split("\n");
  expect(lines).toContain("Allow: /");
  expect(lines).toContain("Disallow: /editor");
  expect(lines).toContain(`Sitemap: ${SITE}sitemap.xml`);
});

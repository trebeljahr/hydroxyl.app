import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

/**
 * Link previews for `/` and `/about`: the Open Graph and Twitter card tags, and
 * the 1200×630 card they point at.
 *
 * Read from the HTML the server sends, through `request` rather than a page:
 * a crawler runs no JavaScript, so a tag that only exists after hydration does
 * not exist for it. Both pages are static, so this is the prerendered HTML.
 * The static export's copies of the same tags are checked by
 * `packages/client/scripts/check-export.mjs`.
 */

// The origin `metadataBase` is built from. Playwright compiles specs to
// CommonJS, so `import.meta.url` is not available to locate the manifest.
const { domain } = JSON.parse(readFileSync(join(process.cwd(), ".hatchkit.json"), "utf8")) as {
  domain: string;
};
const ORIGIN = `https://${domain}`;
const CARD_URL = `${ORIGIN}/social-card.png`;

/** Every `<meta>` in the document's `<head>`, keyed by `property` or `name`. */
async function headMeta(request: APIRequestContext, path: string): Promise<Map<string, string>> {
  const response = await request.get(path);
  expect(response.status()).toBe(200);
  const html = await response.text();
  const head = html.slice(0, html.indexOf("</head>"));
  const meta = new Map<string, string>();
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/g)) {
    const key = /\b(?:property|name)="([^"]+)"/.exec(tag)?.[1];
    const content = /\bcontent="([^"]*)"/.exec(tag)?.[1];
    if (key !== undefined && content !== undefined) meta.set(key, content);
  }
  return meta;
}

for (const page of [
  { path: "/", title: "Hydroxyl" },
  { path: "/about", title: "About Hydroxyl" },
]) {
  test(`${page.path} carries an Open Graph and Twitter card with the social card`, async ({
    request,
  }) => {
    const meta = await headMeta(request, page.path);

    expect(meta.get("og:type")).toBe("website");
    expect(meta.get("og:site_name")).toBe("Hydroxyl");
    expect(meta.get("og:title")).toBe(page.title);
    expect(meta.get("og:description")).toBe(meta.get("description"));
    // Absolute, from the manifest's domain; the trailing slash is the build's.
    expect(meta.get("og:url")).toMatch(new RegExp(`^${ORIGIN}${page.path.replace(/\/$/, "")}/?$`));

    expect(meta.get("og:image")).toBe(CARD_URL);
    expect(meta.get("og:image:width")).toBe("1200");
    expect(meta.get("og:image:height")).toBe("630");
    expect(meta.get("og:image:type")).toBe("image/png");
    expect(meta.get("og:image:alt")).toContain("Acetic acid in four panels");

    expect(meta.get("twitter:card")).toBe("summary_large_image");
    expect(meta.get("twitter:title")).toBe(page.title);
    expect(meta.get("twitter:description")).toBe(meta.get("description"));
    expect(meta.get("twitter:image")).toBe(CARD_URL);
    expect(meta.get("twitter:image:alt")).toBe(meta.get("og:image:alt"));
  });
}

test("the card the tags point at is served as a 1200×630 PNG", async ({ request }) => {
  const response = await request.get(new URL(CARD_URL).pathname);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
  const png = await response.body();
  expect([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
  // IHDR's width and height, the first two fields after the signature.
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
});

test("the editor gets no card: its ?doc= links open a sketch only the sharer has", async ({
  request,
}) => {
  const meta = await headMeta(request, "/editor");
  expect(meta.has("og:image")).toBe(false);
  expect(meta.has("twitter:card")).toBe(false);
});

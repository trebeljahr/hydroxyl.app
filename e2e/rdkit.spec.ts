import { expect, test } from "@playwright/test";

/**
 * The wasm must not be fetched by simply loading the app.
 *
 * 6.9 MB is roughly forty times the rest of the client put together, and a
 * chemist who opens the editor to draw a hexagon must never pay for it. The
 * cost of getting this wrong is invisible on a development machine and
 * obvious on a conference wifi, which is exactly the kind of regression a
 * build-time check cannot catch: nothing about the bundle changes, only when
 * the browser asks for the file.
 *
 * Asserted at the NETWORK, not at the bundle. The wasm is served out of
 * `public/rdkit/` and is not in the module graph at all, so a bundle-size
 * check would pass whatever the runtime did.
 */

const RDKIT_ASSET = /RDKit_minimal|rdkit\.worker|\.wasm(\?|$)/;

for (const route of ["/", "/editor"]) {
  test(`loading ${route} fetches nothing from RDKit`, async ({ page }) => {
    const rdkitRequests: string[] = [];
    page.on("request", (request) => {
      if (RDKIT_ASSET.test(request.url())) rdkitRequests.push(request.url());
    });

    await page.goto(route);
    await page.waitForLoadState("networkidle");

    expect(rdkitRequests).toEqual([]);
  });
}

test("the RDKit assets are nonetheless there when something asks for them", async ({
  page,
  baseURL,
}) => {
  // The other half of the claim: nothing fetches them, and they are served
  // correctly when the bridge does. A worker script that 404s reports an
  // error event with an EMPTY message, so a missing asset would otherwise be
  // invisible until someone tried to import a structure.
  for (const name of [
    "rdkit/rdkit.worker.js",
    "rdkit/RDKit_minimal.js",
    "rdkit/RDKit_minimal.wasm",
    "rdkit/THIRD-PARTY-NOTICES.txt",
  ]) {
    const response = await page.request.get(`${baseURL}/${name}`);
    expect(response.status(), name).toBe(200);
  }
});

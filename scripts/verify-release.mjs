import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// hydroxyl.app is the product's domain; chemistry.trebeljahr.com stays an alias until
// sketch libraries saved there have a way across (IndexedDB is per origin).
// www.hydroxyl.app serves the same build. Each host reaches the Worker through
// its own route (decision 257), so a missing route shows up as one origin
// still answering with the old build.
export const ORIGINS = [
  "https://hydroxyl.app",
  "https://www.hydroxyl.app",
  "https://chemistry.trebeljahr.com",
];
// The product name: the homepage's <title> is `SITE_NAME`
// (packages/client/src/lib/site.ts), so a rename changes this too.
export const PAGE_MARKER = "hydroxyl";
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

// Public HTTP proves the serving build. A Worker version goes live within
// seconds of `wrangler versions deploy`; the nine-minute budget was sized for
// a Coolify image pull and drain and is kept as the ceiling. It is bounded by
// time so slow requests cannot extend it.
export async function verifyRelease(
  commit,
  {
    fetch: request = fetch,
    sleep = pause,
    now = Date.now,
    attempts = 240,
    budgetMs = 540000,
    stableSamples = 16,
  } = {},
) {
  if (!/^[a-f0-9]{40}$/.test(commit ?? ""))
    throw new Error("Expected a full lowercase Git commit SHA.");
  let consecutive = 0;
  let lastFailure = "No matching build observed.";
  const started = now();
  for (let attempt = 0; attempt < attempts && now() - started < budgetMs; attempt += 1) {
    try {
      for (const origin of ORIGINS) {
        const nonce = `${commit}-${attempt}-${Date.now()}`;
        const options = () => ({
          redirect: "manual",
          cache: "no-store",
          headers: { "Cache-Control": "no-cache, no-store" },
          signal: AbortSignal.timeout(5000),
        });
        const version = await request(`${origin}/version.json?release=${nonce}`, options());
        if (
          version.status !== 200 ||
          !(version.headers.get("cache-control") ?? "").includes("no-store")
        ) {
          throw new Error("Version endpoint must return HTTP 200 without caching.");
        }
        if ((await version.json()).commit !== commit)
          throw new Error("Public version differs from the expected commit.");
        const page = await request(`${origin}/?release=${nonce}`, options());
        const html = await page.text();
        if (page.status !== 200 || !html.toLowerCase().includes(PAGE_MARKER)) {
          throw new Error("The homepage did not serve the expected application.");
        }
        const identities = [
          ...html.matchAll(
            /<meta\b(?=[^>]*\bname=["']build-sha["'])(?=[^>]*\bcontent=["']([a-f0-9]{40})["'])[^>]*>/gi,
          ),
        ];
        if (identities.length !== 1 || identities[0][1] !== commit)
          throw new Error("The homepage and version endpoint differ from the requested build.");
        // The page is only half the release: its entry chunk must answer too,
        // or the HTML is served from a version that lacks its own files.
        const chunk = /["'](\/_next\/static\/[^"'?#]+\.js)/.exec(html)?.[1];
        if (!chunk) throw new Error("The homepage loads no script from /_next/static/.");
        const script = await request(`${origin}${chunk}?release=${nonce}`, options());
        if (script.status !== 200) throw new Error(`The homepage's ${chunk} answered ${script.status}.`);
      }
      consecutive += 1;
      if (consecutive >= stableSamples) return { commit, samples: consecutive, origins: ORIGINS };
    } catch (error) {
      consecutive = 0;
      lastFailure = error instanceof Error ? error.message : "HTTP verification failed.";
    }
    if (attempt + 1 < attempts) await sleep(2000);
  }
  throw new Error(`Release did not remain healthy at ${commit}: ${lastFailure}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await verifyRelease(process.argv[2])));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Release verification failed.");
    process.exitCode = 1;
  }
}

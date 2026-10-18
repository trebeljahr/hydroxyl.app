# Releasing the hosted site (decision 257)

hydroxyl.app, www.hydroxyl.app and chemistry.trebeljahr.com are served by the
Cloudflare Worker `chemistry-sketcher-client`. It has static assets and no
script. One Workers route per hostname (`<host>/*`) sends every request to
it; there is no origin server behind these hosts any more (the Coolify app
retired on 2026-10-18). The routes were made by hand. `wrangler.jsonc` has
no `routes` key, so Wrangler never changes them, and CI's token cannot.

Plain `http://` gets a 301 to `https://` from hatchkit's one HTTP→HTTPS
redirect rule per zone. Change the hosts in it only with
`hatchkit cloudflare https add|remove <host>`. The rule reads `not ssl`,
because a Free zone refuses `http.request.scheme`, and it skips
`/.well-known/`. The zone setting Always Use HTTPS stays off: on
trebeljahr.com it would also redirect other projects' certificate renewals.

## What a release is

`pnpm run build:web` builds the static web export into `packages/client/out/`
(`NEXT_FILE_EXPORT=web`: no asset prefix, `trailingSlash: true`). The
**Build & Release** workflow then:

1. writes `version.json` (`{ "commit": … }`);
2. carries the hashed files of the two newest live releases into `out/`
   (`carry-static.mjs`, copied from hatchkit's client-host template at
   `2006ddb`). It reads the live `/release-assets.json`, downloads the files
   this build lacks, checks each sha256, and refuses a path that holds two
   different contents. A live site without that manifest fails the run;
3. writes `releases.json` from that manifest. These are the releases whose
   chunks this upload holds;
4. checks the upload (`check-web-export.mjs`): nested pages, no native
   `./_next/` prefix, every `/_next/static/` file a page names, run-time
   files present, and the sitemap. It also checks
   the Workers Free limits (20,000 files, 25 MiB per file, 100 `_headers`
   rules, 2,100 `_redirects` rules) and that `wrangler.jsonc` has no `main`,
   `routes`, `cache` or `run_worker_first`;
5. `wrangler versions upload --tag <commit>`. Nothing is live yet.

The deploy job (`worker-release.mjs`) activates that version at 100 %. It then
requires every origin's uncached `/version.json` and homepage to name the
commit, and the homepage's entry chunk to answer 200, 16 samples in a row. If the check fails, it puts the previously live
version back and the job fails anyway.

`CHEMISTRY_SKETCHER_ROLLOUT_MODE` gates activation as before: `automatic`
deploys every green push to main, `manual` only uploads.

## Rollback

- **One release:** set `CHEMISTRY_SKETCHER_ROLLOUT_MODE` to `manual`, then run
  **Build & Release** with operation `deploy` and the earlier commit, and
  check that the run started. GitHub keeps one pending run per concurrency
  group, so with `automatic` the next push can cancel a queued rollback and
  deploy itself. It works while that commit's version is among the Worker's
  last 100. A version keeps its own assets, so the rollback is complete.
There is no Coolify app to fall back to any more. A broken Worker release is
rolled back as above; the routes themselves stay.

## Open tabs across a release

The editor holds unsaved work, so an old tab must keep working or reload only
after its sketch is stored.

- **Chunks.** A Worker version serves only its own files. Without the carry,
  an old tab's next lazy chunk would 404 about a minute after a deploy, once
  the edge cache lets go. The carry keeps the two previous releases. The
  service worker also precaches every chunk of its own release (decision 239).
- **Expiry.** `ReleaseLifetime` reads `/releases.json` on focus, every
  minute, and after a failed chunk load. When the tab's release is not listed,
  it calls `saveBeforeReleaseReload()` and reloads only after the IndexedDB
  write succeeded, into `?doc=<id>` of the sketch it just stored (decision
  258), so the chemist lands back in the same sketch. The list keeps the
  schema-2 shape the old Coolify release volume served.
- **No 409 path.** Under Coolify, `shared-assets.cjs` refused a React Server
  Components request from another release with 409. On a static host nothing
  can refuse it. Nothing needs to: the app makes no client-side router
  navigations (plain anchors, no `next/link` or `next/navigation`). If one is
  added, Next compares the response's `x-nextjs-deployment-id` with the
  build's own. A static host sends no such header, so Next turns every
  flight response into a full navigation.

## Headers

`packages/client/cloudflare/_headers` replaces the server's headers. It sets:

- `/version.json`, `/releases.json`, `/release-assets.json`: `no-store`;
- `/sw.js`: `no-cache`;
- no rule for `/_next/static/*`. A long `immutable` would also cover the 404
  of a missing chunk, and the edge and the browser would keep that 404 for as
  long. The service worker's precache holds chunks for offline use regardless;
- `nosniff` everywhere.

Every other path gets the Worker's default (`max-age=0, must-revalidate`
with an ETag).

## Local check

```bash
pnpm run build:web
npx --yes wrangler@4.145.0 dev --port <free high port>
```

`wrangler dev` serves `out/` with the same `_headers`, trailing-slash and 404
handling as the Worker. The e2e suite runs against exactly this
(`playwright.config.ts`).

## hatchkit

`.hatchkit.json` says `deploymentMode: "cloudflare"`, `clientHost: "cloudflare"`,
`clientWorker: "chemistry-sketcher-client"` and `clientRelease: "repo"`
(hatchkit `9b363d1`). Together they mean: no server, the Worker on the routes
above, and a release workflow that belongs to this repo. hatchkit leaves the
project alone: `sync`, `regen-infra` and `dns publish` do nothing, and
`hatchkit cloudflare` setup and `--undo` refuse to run, so nothing overwrites
`wrangler.jsonc`, `_headers` or this workflow. `hatchkit cloudflare https
add|remove` and `hatchkit cloudflare token` still work. `hatchkit doctor`
checks the routes, the Worker's live version, the HTTPS rule on both zones,
and that each hostname answers 200.

## Retired with the Coolify app (2026-10-18)

The standalone build (`output: "standalone"`), `next start`, the Dockerfile,
`drain.cjs`, `shared-assets.cjs`, `release-entrypoint.sh`,
`docker-compose.yml` and the rolling image release (`scripts/rolling-release.mjs`,
`scripts/shared-asset-releases.mjs`, their tests and contracts) are gone.
Every production build is a static export now: web by default, native with
`NEXT_FILE_EXPORT=1`.

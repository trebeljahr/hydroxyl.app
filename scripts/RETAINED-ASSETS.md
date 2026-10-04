# Browser assets during rolling releases

During a rolling release the old and new web containers serve traffic at the
same time. A tab opened from either release must keep loading its own hashed
chunks from whichever container answers. Next's standalone server only knows
the files of its own build, indexed at startup, so these assets live in a shared
named volume instead.

## Required app-owned volume

Mount Docker named volume `chemistry-sketcher-releases` read/write at
`/var/lib/chemistry-sketcher-releases` in every web container. The host
controller must verify mount type, exact volume name, destination and write
permission. Initialize it for runtime UID/GID 1000 (`node`) with this
`.store-identity.json`:

```json
{"schema":1,"app":"trebeljahr/chemistry-sketcher","volume":"chemistry-sketcher-releases","purpose":"immutable-next-assets"}
```

`release-entrypoint.sh` refuses to start without a real writable mount and that
exact marker. Under one exclusive publication lock it copies this image's
`_next/static` snapshot into `releases/<SHA>`, links every retained hashed file
into a shared `_next/static` union and atomically writes `releases.json`, all
before Next starts or the health check can pass. Same-path files with different
bytes fail closed, as does a store over 256 MiB or 20,000 files.

The server process keeps a shared kernel lease on its own SHA until it exits.
Each image publishes itself, so the store needs no build ancestry: a newly
started release becomes the head, a restart inside the window never rewinds it,
and the three newest releases plus every leased (still running) image stay
available. Older unleased files are pruned. A rollback to an expired release
simply becomes the head again. Only `version.json` and hashed browser files
enter the store; it holds no application data and needs no backup. Do not erase
it while containers serve from it.

## Routing

`shared-assets.cjs` is preloaded before `drain.cjs`. It answers
`/_next/static/…` and `/releases.json` from the volume before Next sees the
request, with strict path validation, ranges and immutable caching. Missing
chunks are real 404s. An RSC request whose `x-deployment-id` names another
release gets 409 before React decodes foreign module references; Next then
loads a full document. The app's own links between the recents grid and the
editor are already full-document navigations.

## Unsaved sketches

`ReleaseLifetime` checks `/releases.json` on focus, every minute and after a
failed chunk load. Once the tab's release has left the retained set it calls
`saveBeforeReleaseReload()`: the pending document goes to the synchronous
journal, then the IndexedDB write is awaited. The tab reloads only after that
write succeeded and no newer edit is pending. On failure, or when another tab
deleted the sketch, it stays open and shows why. The desktop and mobile export
builds never run this check.

## Limits

The current live image predates this store and has no `version.json`. Its tabs
lose their chunks once it retires; they rely on the existing `pagehide` journal,
which recovers an unsaved sketch on the next load. The first adoption is a
controlled step. RDKit files under `/rdkit/` are unversioned public paths; they
are pinned by package version, so a release that changes RDKit must version
them before rolling. Keep automatic mode off until a live replacement proves
asset sharing, expiry and drain on the host.

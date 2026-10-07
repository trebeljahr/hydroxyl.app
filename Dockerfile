# syntax=docker/dockerfile:1
#
# Production image for chemistry-sketcher. There is no server package:
# this repo is a client-only surface, so the image builds exactly one
# thing — the Next.js app at packages/client — and serves it from Next's
# standalone output on PORT (6337 by default).
#
# Why the staged COPY set rather than `COPY . .`: `pnpm install
# --frozen-lockfile` must run at the workspace ROOT with EVERY package
# manifest present. With manifests missing, pnpm's `packages/*` glob
# matches nothing, the install "succeeds" having installed only the root
# devDependencies, and the build then fails far downstream. Copying the
# manifests first also keeps the install layer cached across source-only
# changes.
#
# Why `pnpm run build` and not `pnpm --filter @starter/client build`: the
# root script chains build:deps (chem-core tsc, then shared tsc) before
# `next build`. The client consumes both from their built dist/, so
# skipping the chain leaves @starter/chem-core unresolvable.
#
# The install deliberately keeps devDependencies. `next build` typechecks
# the whole client project, which now includes vitest.config.ts and the
# *.test.tsx files — adding --prod here breaks the build on unresolved
# test imports.
#
# bookworm-slim, not alpine: Next's optional native deps (sharp) ship
# glibc binaries that do not run on musl without a rebuild.
ARG NODE_VERSION=24

# ── Stage 1: install workspace dependencies ─────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS deps
RUN corepack enable
WORKDIR /app
# pnpm-workspace.yaml belongs in this layer: it carries the allowBuilds
# approvals for esbuild / sharp / unrs-resolver.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/chem-core/package.json packages/chem-core/
COPY packages/chem-render/package.json packages/chem-render/
COPY packages/client/package.json packages/client/
# The MCP server is not built into the image, but its manifest must be here
# for the frozen install to match the lockfile's importers.
COPY packages/mcp/package.json packages/mcp/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# ── Stage 2: build ─────────────────────────────────────────────────
FROM deps AS build
# chem-core, chem-render and shared all extend ../../tsconfig.base.json.
# next.config.ts reads the public domain out of .hatchkit.json for
# sitemap.xml and robots.txt, and fails the build without it.
COPY tsconfig.base.json .hatchkit.json ./
COPY packages/chem-core packages/chem-core
COPY packages/chem-render packages/chem-render
COPY packages/shared packages/shared
COPY packages/client packages/client
# Plausible (decisions 136 and 170). Next inlines NEXT_PUBLIC_* into the pages
# at BUILD time, so these must be build args; runtime env on the container
# changes nothing. CI passes them from GitHub repository variables, since the
# copies `hatchkit add` writes into packages/client/.env.production are
# dotenvx ciphertext and this build has no key. A build arg is in the
# environment of the RUN below, and a set-but-empty one outranks that file
# in Next's env loading, so no variables means no analytics.
ARG NEXT_PUBLIC_PLAUSIBLE_DOMAIN
ARG NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL
ARG RELEASE_SHA
ENV NEXT_DEPLOYMENT_ID=${RELEASE_SHA}
ENV NEXT_PUBLIC_BUILD_COMMIT=${RELEASE_SHA}
RUN pnpm run build
COPY scripts/write-version.mjs /tmp/write-version.mjs
RUN node /tmp/write-version.mjs packages/client/public "$RELEASE_SHA"

# ── Stage 3: production runtime ────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
# Coolify probes Docker image deployments with curl or wget.
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=6337
# next standalone's server.js does `process.env.HOSTNAME || "0.0.0.0"`.
# Pin it so an orchestrator that injects a container name cannot make the
# server bind to that name instead of every interface.
ENV HOSTNAME=0.0.0.0
ENV SHUTDOWN_DRAIN_SECONDS=20
ENV HEALTH_CHECK_PATH=/

# next.config.ts sets outputFileTracingRoot to the monorepo root, so the
# standalone tree is re-rooted there: server.js lands at
# packages/client/server.js with its traced deps in node_modules/.pnpm.
# Deliberately NO `COPY --from=build /app/node_modules` — tracing already
# shipped what is needed (~36 MB against 702 MB for the full store), and
# the relative symlinks survive COPY --from intact.
COPY --from=build /app/packages/client/.next/standalone ./
COPY --from=build /app/packages/client/.next/static ./packages/client/.next/static
COPY --from=build /app/packages/client/public ./packages/client/public

COPY drain.cjs /usr/local/lib/drain.cjs
# Browser assets every overlapping container serves from the shared release
# volume; see scripts/RETAINED-ASSETS.md.
COPY --from=build /app/packages/client/.next/static ./release-assets/_next/static
COPY --from=build /app/packages/client/public/version.json ./release-assets/version.json
COPY shared-assets.cjs /usr/local/lib/shared-assets.cjs
COPY scripts/shared-asset-releases.mjs /usr/local/lib/releases/shared-asset-releases.mjs
COPY --chmod=755 release-entrypoint.sh /usr/local/bin/release-entrypoint
ENV CHEMISTRY_SHARED_ASSETS=1

USER node
EXPOSE 6337

HEALTHCHECK --interval=2s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'6337')).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/release-entrypoint"]
# shared-assets.cjs loads first, so the drain probe stays the outer handler.
CMD ["node", "--require", "/usr/local/lib/shared-assets.cjs", "--require", "/usr/local/lib/drain.cjs", "packages/client/server.js"]

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
RUN pnpm run build

# ── Stage 3: production runtime ────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=6337
# next standalone's server.js does `process.env.HOSTNAME || "0.0.0.0"`.
# Pin it so an orchestrator that injects a container name cannot make the
# server bind to that name instead of every interface.
ENV HOSTNAME=0.0.0.0

# next.config.ts sets outputFileTracingRoot to the monorepo root, so the
# standalone tree is re-rooted there: server.js lands at
# packages/client/server.js with its traced deps in node_modules/.pnpm.
# Deliberately NO `COPY --from=build /app/node_modules` — tracing already
# shipped what is needed (~36 MB against 702 MB for the full store), and
# the relative symlinks survive COPY --from intact.
COPY --from=build /app/packages/client/.next/standalone ./
COPY --from=build /app/packages/client/.next/static ./packages/client/.next/static
COPY --from=build /app/packages/client/public ./packages/client/public

USER node
EXPOSE 6337

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'6337')).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "packages/client/server.js"]

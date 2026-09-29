/**
 * THE CONSTRAINT THAT DECIDES HOW NARROW THE DEV WATCH SCOPE CAN BE.
 *
 * Turbopack's `root` is its project directory AND its watch scope, and at the
 * monorepo root that scope is mostly sibling agent worktrees — the count is in
 * `next.config.ts`. It was suspected of the 2 GB `pnpm dev` crash in manual
 * notes 3 and measured innocent on 2026-09-29 (the numbers are there too), so
 * a narrower root would be tidier, not a fix. The obvious narrowing, `root:
 * packages/client`, does not build: Turbopack resolves through symlinks and
 * then refuses anything whose REAL path is outside the root, and pnpm puts
 * every dependency's real path in `<repo>/node_modules/.pnpm/…`. Nor is there
 * a watch exclude to reach for instead: `TurbopackOptions` in 16.2.12 is
 * 16.2.6's list, 16.3.6 and 16.4.0-canary.51 add only `chunkLoadingGlobal`,
 * and `watchOptions` is still `{ pollIntervalMs }` in all of them.
 *
 * Finding that out costs a 65-second build. This file states the rule instead,
 * in the form a future attempt will trip over immediately: every package the
 * app imports must have its real path inside the configured root.
 *
 * It is a claim about the INSTALLED tree, so it is checked against the real
 * `node_modules` rather than against a fixture. If the layout ever changes —
 * a hoisted linker, injected workspace packages, a different package manager —
 * this test is what says the narrower root has become possible.
 */

import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";

const clientDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Where a package really lives, symlinks resolved, as Turbopack sees it.
 *
 * Through `node_modules` rather than `require.resolve`, because that is the
 * path Turbopack itself walks and because the workspace packages publish an
 * `exports` map with no `./package.json` entry — `require.resolve` throws on
 * them, which would make this file fail for a reason that has nothing to do
 * with the root.
 */
function realPackageDir(name: string): string {
  return realpathSync(path.join(clientDir, "node_modules", ...name.split("/")));
}

/** The packages Turbopack has to compile or read from, beyond the app's own
 *  source: the framework, the renderer, and the workspace libraries that
 *  `transpilePackages` pulls in as source rather than as opaque dependencies. */
const MUST_BE_INSIDE_THE_ROOT = [
  "next",
  "react",
  "react-dom",
  "@starter/shared",
  "@starter/chem-core",
  "@starter/chem-render",
];

function inside(root: string, dir: string): boolean {
  const relative = path.relative(root, dir);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** The deepest directory that still contains every path in `needed` — the
 *  narrowest root Turbopack could be given without refusing to compile
 *  something. */
function deepestContaining(needed: readonly string[]): string {
  let directory = clientDir;
  while (!needed.every((dir) => inside(directory, dir))) {
    const parent = path.dirname(directory);
    if (parent === directory) return directory;
    directory = parent;
  }
  return directory;
}

describe("the Turbopack root", () => {
  // `next.config.ts` computes the root from `process.cwd()`, which is this
  // package when the app, the build and this suite are all started the way the
  // scripts start them. Stated rather than assumed: a mismatch here would make
  // every assertion below meaningless in a legible way instead of a confusing
  // one.
  it("is computed from this package's directory", () => {
    expect(realpathSync(process.cwd())).toBe(realpathSync(clientDir));
  });

  const root = nextConfig.turbopack?.root;

  it("is configured, so a dev server in a worktree does not adopt the parent repo", () => {
    expect(typeof root).toBe("string");
    expect(path.isAbsolute(root as string)).toBe(true);
  });

  it("contains the app", () => {
    expect(inside(root as string, clientDir)).toBe(true);
  });

  it.each(MUST_BE_INSIDE_THE_ROOT)("contains the real path of %s", (name) => {
    // THE RULE. Turbopack states it as "files outside of the project directory
    // will not be compiled", and enforces it after resolving symlinks — which
    // is why a root of `packages/client` fails even though
    // `packages/client/node_modules/next` exists as a link.
    expect(inside(root as string, realPackageDir(name))).toBe(true);
  });

  it("is no wider than the rule forces it to be", () => {
    // Today that is the monorepo root, because the pnpm virtual store sits
    // there. If a future layout puts every real path under `packages/client` —
    // a hoisted linker, injected workspace packages, another package manager —
    // this fails, and failing is the good news: the dev watch scope can then
    // shrink from the whole repo, other agents' worktrees included, to the
    // app's own ~2,400 files.
    const needed = [...MUST_BE_INSIDE_THE_ROOT.map(realPackageDir), clientDir];
    expect(root).toBe(deepestContaining(needed));
  });
});

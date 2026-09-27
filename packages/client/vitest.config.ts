import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

// Vitest does not read tsconfig `paths`. Mirror the @/* mapping here.
// A bare "@" key is safe: alias matching is `id === find ||
// id.startsWith(find + "/")`, so @testing-library/react is not caught.
const alias = { "@": path.resolve(import.meta.dirname, "src") };

export default defineConfig({
  test: {
  // Worker cap. Vitest defaults to one worker per core (10 here), and this
  // repo is routinely built by several agent sessions at once, each running
  // its own vitest, next build and Playwright. Uncapped that reaches ~100
  // processes and exhausts a 24 GB machine into swap. Four is still parallel
  // and leaves room for whatever else is running.
  maxWorkers: 4,
    // Two projects, because the editor store must be provable without a
    // browser. Everything under src/state/ is framework-free by design and
    // runs in plain node — if a store test only passes under jsdom, the
    // store has grown a DOM dependency and the split is what catches it.
    projects: [
      {
        resolve: { alias },
        test: {
          name: "dom",
          environment: "jsdom",
          // Not cosmetic: @testing-library/react registers its
          // afterEach(cleanup) and the React act() environment only when
          // afterEach/beforeAll exist as globals. With globals:false a
          // second render() in the same file leaks the first one's DOM
          // into the next assertion.
          globals: true,
          include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
          exclude: [
            ...configDefaults.exclude,
            "src/state/**",
            "src/**/*.node.test.ts",
            "src/**/*.leak.test.ts",
          ],
          setupFiles: ["./test/setup.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          include: ["src/state/**/*.test.ts"],
          // The retention harness lives here too but needs `--expose-gc`, so
          // it belongs to the `leak` project above. Without this exclusion it
          // would be collected twice and pass vacuously in the run that has no
          // collector.
          exclude: [...configDefaults.exclude, "src/**/*.leak.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          // *.leak.test.ts: the retention harness, and the ONLY project that
          // runs with a forced collector.
          //
          // Decision 86: a leak is diagnosed here rather than by profiling a
          // dev server. `WeakRef.deref()` after a FORCED collection is the one
          // observation that can tell a weakly keyed memo from a cache that
          // has kept every document of the session — a size bound cannot,
          // because the newest document has at most one entry either way.
          //
          // The collector is turned on by the test file itself, through
          // `v8.setFlagsFromString("--expose-gc")`, rather than by an
          // `execArgv` here: measured against vitest 4.1.6, a project-level
          // `poolOptions.forks.execArgv` is REPLACED by the runner's own
          // argument list and never reaches the child, so the flag arrived
          // nowhere and the harness skipped itself. Doing it in-process also
          // means `pnpm test` needs no special invocation to get a real
          // measurement.
          //
          // Its own project all the same: forks, so the isolate whose heap is
          // measured runs nothing else, and a separate name so a run that
          // wants only this can ask for it.
          name: "leak",
          environment: "node",
          include: ["src/**/*.leak.test.ts"],
          pool: "forks",
        },
      },
      {
        resolve: { alias },
        test: {
          // *.node.test.ts: everything that needs a real filesystem or the
          // real RDKit wasm. jsdom has no Worker and cannot fetch the wasm,
          // so the fidelity harness runs here instead — against @rdkit/rdkit
          // loaded directly, with the worker treated as the transport shell
          // it is. Slower than the other two projects by an order of
          // magnitude, hence its own name.
          name: "rdkit",
          environment: "node",
          include: ["src/**/*.node.test.ts"],
          testTimeout: 30_000,
        },
      },
    ],
  },
});

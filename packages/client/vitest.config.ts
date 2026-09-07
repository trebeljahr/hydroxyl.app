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
          exclude: [...configDefaults.exclude, "src/state/**", "src/**/*.node.test.ts"],
          setupFiles: ["./test/setup.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          include: ["src/state/**/*.test.ts"],
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

import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

// Vitest does not read tsconfig `paths`. Mirror the @/* mapping here.
// A bare "@" key is safe: alias matching is `id === find ||
// id.startsWith(find + "/")`, so @testing-library/react is not caught.
const alias = { "@": path.resolve(import.meta.dirname, "src") };

export default defineConfig({
  test: {
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
          exclude: [...configDefaults.exclude, "src/state/**"],
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
    ],
  },
});

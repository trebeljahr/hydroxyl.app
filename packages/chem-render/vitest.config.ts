import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
  // Worker cap. Vitest defaults to one worker per core (10 here), and this
  // repo is routinely built by several agent sessions at once, each running
  // its own vitest, next build and Playwright. Uncapped that reaches ~100
  // processes and exhausts a 24 GB machine into swap. Four is still parallel
  // and leaves room for whatever else is running.
  maxWorkers: 4,
    // Unit tests sit beside the source; anything needing fixtures or a larger
    // corpus lives in test/. Both are collected, and neither picks up the
    // Playwright *.spec.ts files at the repo root.
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    benchmark: {
      include: ["test/**/*.bench.ts"],
    },
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
  // Worker cap. Vitest defaults to one worker per core (10 here), and this
  // repo is routinely built by several agent sessions at once, each running
  // its own vitest, next build and Playwright. Uncapped that reaches ~100
  // processes and exhausts a 24 GB machine into swap. Four is still parallel
  // and leaves room for whatever else is running.
  maxWorkers: 4,
    // Unit tests sit beside the source; the projection harness (decision 208)
    // lives in test/harness, beside the fixtures it reads and the goldens it
    // writes, so its layout-to-Molecule builder is never part of src/.
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
  // Worker cap. Vitest defaults to one worker per core (10 here), and this
  // repo is routinely built by several agent sessions at once, each running
  // its own vitest, next build and Playwright. Uncapped that reaches ~100
  // processes and exhausts a 24 GB machine into swap. Four is still parallel
  // and leaves room for whatever else is running.
  maxWorkers: 4,
    // Pure data + zod. No DOM, no globals — the codec must stay loadable
    // from a plain node process (the client's node-environment store tests
    // import this package from its built dist/).
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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

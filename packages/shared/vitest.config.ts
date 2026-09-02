import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure data + zod. No DOM, no globals — the codec must stay loadable
    // from a plain node process (the client's node-environment store tests
    // import this package from its built dist/).
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

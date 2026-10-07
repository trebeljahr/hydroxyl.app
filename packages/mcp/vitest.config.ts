import path from "node:path";
import { defineConfig } from "vitest/config";

// Vitest does not read tsconfig `paths`; mirror the client's `@/` alias, which
// is how the server reaches the editor's export code (decision 246).
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "..", "client", "src") } },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Same cap as the other packages: several sessions build this repo at once.
    maxWorkers: 4,
    // RDKit's wasm takes about a second to initialise.
    testTimeout: 30_000,
  },
});

import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // Not cosmetic: @testing-library/react registers its afterEach(cleanup)
    // and the React act() environment only when afterEach/beforeAll exist
    // as globals. With globals:false a second render() in the same file
    // leaks the first one's DOM into the next assertion.
    globals: true,
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
  },
  resolve: {
    // Vitest does not read tsconfig `paths`. Mirror the @/* mapping here.
    // A bare "@" key is safe: alias matching is `id === find ||
    // id.startsWith(find + "/")`, so @testing-library/react is not caught.
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
});

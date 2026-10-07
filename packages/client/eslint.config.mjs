import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "node_modules/**",
    "eslint.config.mjs",
    // Staged by scripts/copy-rdkit.mjs: RDKit's emscripten glue, the wasm and
    // the esbuild-minified worker. The worker's SOURCE is linted at
    // src/lib/rdkit/worker.ts; linting its bundle would only report on
    // minifier output and on 128 kB of generated C++ shim.
    "public/rdkit/**",
    // Staged by scripts/copy-conformer.mjs: OpenChemLib bundled into the 3D
    // view's worker. Its source is src/lib/conformer/worker.ts.
    "public/conformer/**",
  ]),
]);

export default config;

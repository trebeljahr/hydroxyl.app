/**
 * The executable: a stdio MCP server. Nothing is written to stdout except
 * protocol messages, so diagnostics go to stderr.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadRasterizer } from "./png.js";
import { loadRdkit } from "./rdkit.js";
import { createServer } from "./server.js";

/** The production editor. Overridable for a self-hosted or local build. */
const DEFAULT_EDITOR_URL = "https://hydroxyl.app/editor/";

const server = createServer({
  loadRdkit,
  // Copied beside the bundle by scripts/build.mjs.
  loadRasterizer: () => loadRasterizer(new URL("./arimo.woff", import.meta.url)),
  editorUrl: process.env.HYDROXYL_EDITOR_URL ?? DEFAULT_EDITOR_URL,
});

await server.connect(new StdioServerTransport());
console.error("hydroxyl MCP server running on stdio");

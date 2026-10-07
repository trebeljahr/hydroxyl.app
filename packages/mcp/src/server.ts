/**
 * The MCP wiring: five tools over the handlers in `tools.ts`.
 *
 * Every tool answers with JSON text an assistant can read back, and
 * `render_figure` adds the figure itself — an image block for a PNG, the SVG
 * as text. A refusal is an `isError` result carrying the one sentence that
 * says why, never a thrown JSON-RPC error: the assistant should read it and
 * fix its input, and a protocol error reads as the server being broken.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { VIEW_KINDS } from "@starter/chem-render";
import { z } from "zod";

import { structureShape } from "./structure.js";
import {
  checkStructure,
  convert,
  describe,
  editorLink,
  renderFigure,
  type ToolDeps,
  type ToolResult,
} from "./tools.js";

export const SERVER_NAME = "hydroxyl";
export const SERVER_VERSION = "0.1.0";

function asJson<T>(result: ToolResult<T>): CallToolResult {
  if (!result.ok) return { isError: true, content: [{ type: "text", text: result.message }] };
  return { content: [{ type: "text", text: JSON.stringify(result.value, null, 2) }] };
}

export function createServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "render_figure",
    {
      title: "Render a publication figure",
      description:
        "Draw a structure as a journal figure: one bond prints at the style's standard length " +
        "(5.08 mm for ACS-style Publication), and the width is a maximum the figure is scaled down to fit. " +
        "Returns the figure (PNG or SVG), its printed size, its label size, and a warning for any text " +
        "that prints below the style's minimum (8 pt for Publication).",
      inputSchema: {
        ...structureShape,
        views: z
          .array(z.enum(VIEW_KINDS))
          .optional()
          .describe(
            "One panel per view, in order. skeletal (default), kekule, explicitH, lewis, condensed, sumFormula.",
          ),
        width: z
          .union([z.enum(["single", "double"]), z.number().min(2).max(60)])
          .optional()
          .describe("Maximum width: \"single\" or \"double\" journal column (default single), or a width in cm."),
        style: z
          .enum(["publication", "nature", "screen"])
          .optional()
          .describe("publication (ACS 1996 settings, default), nature (Nature Portfolio), or screen."),
        format: z.enum(["png", "svg"]).optional().describe("png (default) or svg."),
        dpi: z.union([z.literal(300), z.literal(600)]).optional().describe("PNG resolution, 300 (default) or 600."),
        background: z
          .enum(["white", "transparent"])
          .optional()
          .describe("PNG background, white (default) or transparent. The SVG is always transparent."),
      },
    },
    async (input): Promise<CallToolResult> => {
      const result = await renderFigure(input, deps);
      if (!result.ok) return asJson(result);
      const { svg, png, ...summary } = result.value;
      const text = { type: "text" as const, text: JSON.stringify(summary, null, 2) };
      if (png !== undefined) {
        return {
          content: [
            { type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" },
            text,
          ],
        };
      }
      return { content: [{ type: "text", text: svg ?? "" }, text] };
    },
  );

  server.registerTool(
    "check_structure",
    {
      title: "Check a structure",
      description:
        "Report every valence and drawing problem the editor would flag (over-valent atoms, misplaced wedges), " +
        "each with the obvious one-click fixes as corrected molfiles, plus RDKit's refusal if it would refuse it. " +
        "Atoms are numbered 1-based in molfile order.",
      inputSchema: structureShape,
    },
    async (input) => asJson(await checkStructure(input, deps)),
  );

  server.registerTool(
    "describe",
    {
      title: "Describe a structure",
      description:
        "Sum formula (Hill order), average molecular weight, monoisotopic exact mass, net charge, and the CIP " +
        "label of every stereocentre and stereogenic double bond. Atoms are numbered 1-based in molfile order.",
      inputSchema: structureShape,
    },
    async (input) => asJson(await describe(input, deps)),
  );

  server.registerTool(
    "convert",
    {
      title: "Convert between SMILES and molfile",
      description:
        "Convert a structure to a molfile (as the editor saves it) or to RDKit's canonical SMILES. " +
        "By default a SMILES becomes a molfile and anything else becomes a SMILES.",
      inputSchema: {
        ...structureShape,
        to: z.enum(["smiles", "molfile"]).optional().describe("The format to produce."),
      },
    },
    async (input) => asJson(await convert(input, deps)),
  );

  server.registerTool(
    "editor_link",
    {
      title: "Link to the structure in the editor",
      description:
        "A link that opens the structure in the Hydroxyl editor as a new, unsaved sketch. The structure travels " +
        "in the URL fragment, which the browser does not send to the server.",
      inputSchema: structureShape,
    },
    async (input) => asJson(await editorLink(input, deps)),
  );

  return server;
}

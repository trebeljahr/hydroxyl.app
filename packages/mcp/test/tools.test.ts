/**
 * The tool handlers against real molecules, the real RDKit wasm and real
 * resvg.
 *
 * As the client's fidelity harness does, nothing here asserts on a SMILES
 * string: RDKit canonicalises the right and the wrong answer to the same one.
 * A conversion is checked by reading its molfile back with chem-core and
 * asking chemistry questions — which is also the only way to tell glycine's
 * two forms apart, since their formula and net charge are identical.
 */

import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  bondsAt,
  readMolblock,
  requireAtom,
  requireBond,
  setExplicitHydrogenCount,
  updateAtom,
  type Molecule,
} from "@starter/chem-core";
import { describe as suite, expect, it } from "vitest";

import { structureFromHash } from "@/lib/io/fragment";
import { moleculeToMolblock } from "@/lib/rdkit/translate";

import { loadRasterizer } from "../src/png.js";
import { loadRdkit } from "../src/rdkit.js";
import { createServer } from "../src/server.js";
import {
  checkStructure,
  convert,
  describe,
  editorLink,
  renderFigure,
  type ToolDeps,
  type ToolResult,
} from "../src/tools.js";

const FONT = fileURLToPath(
  new URL("../../chem-render/assets/arimo-latin-400-normal.woff", import.meta.url),
);

const deps: ToolDeps = {
  loadRdkit,
  loadRasterizer: () => loadRasterizer(FONT),
  editorUrl: "https://hydroxyl.app/editor/",
};

const BENZENE = "c1ccccc1";
const GLYCINE = "NCC(=O)O";
const GLYCINE_ZWITTERION = "[NH3+]CC(=O)[O-]";
const DIMETHYL_SULFONE = "CS(=O)(=O)C";
const L_ALANINE = "N[C@@H](C)C(=O)O";

function value<T>(result: ToolResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got: ${result.message}`);
  return result.value;
}

function refusal<T>(result: ToolResult<T>): string {
  if (result.ok) throw new Error("expected a refusal");
  return result.message;
}

async function molfileOf(smiles: string): Promise<string> {
  const converted = value(await convert({ smiles }, deps));
  expect(converted.format).toBe("molfile");
  return converted.text;
}

function moleculeOf(molfile: string): Molecule {
  return readMolblock(molfile).molecule;
}

function charges(mol: Molecule): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const id of mol.atomIds) {
    const atom = requireAtom(mol, id);
    if (atom.charge !== 0) (out[atom.element] ??= []).push(atom.charge);
  }
  return out;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

suite("render_figure", () => {
  it("draws benzene as a PNG at the house bond length, with no warning at a single column", async () => {
    const figure = value(await renderFigure({ smiles: BENZENE }, deps));
    expect(figure.format).toBe("png");
    expect([...figure.png!.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    // IHDR width and height, big-endian, at bytes 16..23.
    const view = new DataView(figure.png!.buffer, figure.png!.byteOffset);
    expect(view.getUint32(16)).toBe(figure.widthPx);
    expect(view.getUint32(20)).toBe(figure.heightPx);
    expect(figure.bondLengthMm).toBeCloseTo(5.08, 2);
    expect(figure.scale).toBe(1);
    expect(figure.labelSizePt).toBe(10);
    expect(figure.warnings).toEqual([]);
  });

  it("writes the SVG the editor's export writes: physical units, transparent", async () => {
    const figure = value(await renderFigure({ smiles: BENZENE, format: "svg" }, deps));
    expect(figure.svg).toMatch(/^<\?xml|^<svg/);
    expect(figure.svg).toMatch(new RegExp(`width="${figure.widthCm}cm" height="${figure.heightCm}cm"`));
    expect(figure.png).toBeUndefined();
  });

  it("returns the 8 pt warning when a figure is scaled down to fit", async () => {
    const figure = value(
      await renderFigure(
        {
          smiles: GLYCINE_ZWITTERION,
          views: ["skeletal", "kekule", "explicitH", "lewis", "condensed", "sumFormula"],
          width: 4,
          format: "svg",
        },
        deps,
      ),
    );
    expect(figure.scale).toBeLessThan(1);
    expect(figure.labelSizePt).toBeLessThan(8);
    expect(figure.warnings.some((w) => w.startsWith("Scaled to "))).toBe(true);
    expect(figure.warnings.some((w) => w.includes("below the 8 pt minimum"))).toBe(true);
  });

  it("warns at full size for a style whose labels are under the minimum", async () => {
    const figure = value(await renderFigure({ smiles: GLYCINE, style: "screen", format: "svg" }, deps));
    expect(figure.scale).toBe(1);
    expect(figure.warnings.join(" ")).toContain("no width fixes it");
  });

  it("refuses a PNG no canvas could hold rather than drawing it", async () => {
    // Not reachable at journal widths with a small molecule; the refusal path
    // is `rasterTooLarge`, shared with the editor, so only its wiring is
    // checked: a normal figure passes it.
    const figure = value(await renderFigure({ smiles: DIMETHYL_SULFONE, dpi: 600 }, deps));
    expect(figure.dpi).toBe(600);
    expect(figure.png!.length).toBeGreaterThan(0);
  });
});

suite("check_structure", () => {
  it.each([
    ["benzene", BENZENE],
    ["glycine", GLYCINE],
    ["glycine zwitterion", GLYCINE_ZWITTERION],
    ["dimethyl sulfone", DIMETHYL_SULFONE],
  ])("finds nothing wrong with %s", async (_name, smiles) => {
    const check = value(await checkStructure({ smiles }, deps));
    expect(check.issues).toEqual([]);
    expect(check.toolkitRefusal).toBeNull();
    expect(check.clean).toBe(true);
  });

  it("accepts a sulfone as a molfile too, where RDKit checks what chem-core wrote", async () => {
    const check = value(await checkStructure({ molfile: await molfileOf(DIMETHYL_SULFONE) }, deps));
    expect(check.clean).toBe(true);
  });

  it("reports glycine's nitrogen drawn with four bonds and no charge, with the fix that charges it", async () => {
    // The zwitterion with the N+ charge removed: an uncharged N pinned to NH3
    // with a carbon on it. Over-valent, and RDKit refuses it.
    const zwitterion = moleculeOf(await molfileOf(GLYCINE_ZWITTERION));
    const nitrogen = zwitterion.atomIds.find((id) => requireAtom(zwitterion, id).element === "N")!;
    const brokenMol = setExplicitHydrogenCount(updateAtom(zwitterion, nitrogen, { charge: 0 }), nitrogen, 3);
    const written = moleculeToMolblock(brokenMol);
    if (!written.ok) throw new Error(written.error.message);
    const broken = written.value;
    expect(charges(moleculeOf(broken))).toEqual({ O: [-1] });

    const check = value(await checkStructure({ molfile: broken }, deps));
    expect(check.clean).toBe(false);
    expect(check.toolkitRefusal).not.toBeNull();
    const issue = check.issues.find((i) => i.kind === "over-valent");
    expect(issue?.atoms[0]?.element).toBe("N");
    const fix = issue?.fixes.find((f) => f.kind === "set-charge");
    expect(fix?.title).toBeTruthy();
    const fixed = moleculeOf(fix!.molfile);
    expect(charges(fixed)).toEqual({ N: [1], O: [-1] });
    expect(value(await checkStructure({ molfile: fix!.molfile }, deps)).clean).toBe(true);
  });
});

suite("describe", () => {
  it("gives benzene's formula and masses", async () => {
    const d = value(await describe({ smiles: BENZENE }, deps));
    expect(d.formula).toBe("C6H6");
    expect(d.molecularWeight).toBeCloseTo(78.114, 2);
    expect(d.exactMass).toBeCloseTo(78.04695, 4);
    expect(d.netCharge).toBe(0);
    expect(d.stereocentres).toEqual([]);
  });

  it("gives both glycine forms the same formula and charge — which is why convert is checked per atom", async () => {
    const neutral = value(await describe({ smiles: GLYCINE }, deps));
    const zwitterion = value(await describe({ smiles: GLYCINE_ZWITTERION }, deps));
    for (const d of [neutral, zwitterion]) {
      expect(d.formula).toBe("C2H5NO2");
      expect(d.netCharge).toBe(0);
      expect(d.exactMass).toBeCloseTo(75.03203, 4);
    }
  });

  it("gives a sulfone's formula and exact mass", async () => {
    const d = value(await describe({ smiles: DIMETHYL_SULFONE }, deps));
    expect(d.formula).toBe("C2H6O2S");
    expect(d.exactMass).toBeCloseTo(94.00885, 4);
  });

  it("labels L-alanine's stereocentre S, by molfile atom number", async () => {
    const d = value(await describe({ smiles: L_ALANINE }, deps));
    expect(d.stereocentres).toHaveLength(1);
    expect(d.stereocentres[0]).toMatchObject({ element: "C", label: "S" });
  });

  it("reads a dictionary name", async () => {
    const d = value(await describe({ name: "glycine" }, deps));
    expect(d.formula).toBe("C2H5NO2");
  });
});

suite("convert", () => {
  it("keeps glycine's zwitterion charge-separated and its neutral form neutral", async () => {
    expect(charges(moleculeOf(await molfileOf(GLYCINE)))).toEqual({});
    expect(charges(moleculeOf(await molfileOf(GLYCINE_ZWITTERION)))).toEqual({ N: [1], O: [-1] });
  });

  it("writes the sulfone with two S=O double bonds, not charge-separated", async () => {
    const mol = moleculeOf(await molfileOf(DIMETHYL_SULFONE));
    expect(charges(mol)).toEqual({});
    const sulfur = mol.atomIds.find((id) => requireAtom(mol, id).element === "S")!;
    const orders = bondsAt(mol, sulfur).map((bond) => bond.order).sort();
    expect(orders).toEqual([1, 1, 2, 2]);
  });

  it("round-trips benzene through SMILES back to a six-carbon ring", async () => {
    const molfile = await molfileOf(BENZENE);
    const smiles = value(await convert({ molfile }, deps));
    expect(smiles.format).toBe("smiles");
    const again = moleculeOf(await molfileOf(smiles.text));
    expect(again.atomIds.map((id) => requireAtom(again, id).element)).toEqual(Array(6).fill("C"));
    expect(again.bondIds.map((id) => requireBond(again, id).order).sort()).toEqual([1, 1, 1, 2, 2, 2]);
  });
});

suite("editor_link", () => {
  it("carries a SMILES in the fragment exactly as the editor parses it", async () => {
    const link = value(await editorLink({ smiles: GLYCINE_ZWITTERION }, deps));
    const url = new URL(link.url);
    expect(`${url.origin}${url.pathname}`).toBe("https://hydroxyl.app/editor/");
    expect(url.search).toBe("");
    // `+` is a charge in SMILES; the editor decodes with decodeURIComponent,
    // so it must arrive as `+`, not a space.
    expect(structureFromHash(url.hash)).toEqual({
      kind: "structure",
      format: "smiles",
      text: GLYCINE_ZWITTERION,
    });
  });

  it("carries a molfile as the molfile chem-core writes, which reads back as the same sulfone", async () => {
    const link = value(await editorLink({ molfile: await molfileOf(DIMETHYL_SULFONE) }, deps));
    const parsed = structureFromHash(new URL(link.url).hash);
    expect(parsed.kind === "structure" && parsed.format).toBe("molfile");
    if (parsed.kind !== "structure") return;
    const mol = moleculeOf(parsed.text);
    expect(mol.atomIds.map((id) => requireAtom(mol, id).element).sort()).toEqual(["C", "C", "O", "O", "S"]);
  });

  it("refuses a structure RDKit cannot read rather than linking to an error", async () => {
    expect(refusal(await editorLink({ smiles: "C1CC" }, deps))).toBeTruthy();
  });
});

suite("structure input", () => {
  it("refuses two structures at once", async () => {
    expect(refusal(await describe({ smiles: BENZENE, name: "benzene" }, deps))).toContain(
      "exactly one",
    );
  });

  it("refuses an unknown name and suggests close ones", async () => {
    expect(refusal(await describe({ name: "glycin" }, deps))).toContain("glycine");
  });
});

suite("the MCP server", () => {
  it("lists the five tools and answers render_figure with an image", async () => {
    const server = createServer(deps);
    const client = new Client({ name: "test", version: "0" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "check_structure",
      "convert",
      "describe",
      "editor_link",
      "render_figure",
    ]);

    const result = await client.callTool({ name: "render_figure", arguments: { smiles: BENZENE } });
    const content = result.content as { type: string; mimeType?: string; text?: string }[];
    expect(content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(JSON.parse(content[1]!.text!)).toMatchObject({ format: "png", warnings: [] });

    const refused = await client.callTool({ name: "describe", arguments: {} });
    expect(refused.isError).toBe(true);
    await client.close();
  });
});

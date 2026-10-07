/**
 * The five tool handlers, as plain async functions.
 *
 * Kept apart from the MCP wiring in `server.ts` so the tests call them with
 * real molecules and assert on chemistry, not on JSON-RPC envelopes. Each
 * returns either a value or a one-sentence refusal; none throws for a bad
 * structure, because a bad structure is an ordinary answer to give an
 * assistant.
 *
 * NO NETWORK. Nothing here fetches: RDKit and resvg are local wasm, the
 * dictionary is bundled, and `editor_link` only builds a string. The
 * structure stays on the machine until the user opens the link, and then it
 * travels in the URL fragment, which a browser never sends (decision 230).
 */

import {
  applyIssueFix,
  chemistryIssues,
  cipDescriptor,
  doubleBondDescriptor,
  issueFixes,
  massSummary,
  requireAtom,
  requireBond,
  stereocenterAtoms,
  stereogenicBonds,
  type AtomId,
  type Molecule,
  type StereoDescriptor,
} from "@starter/chem-core";
import type { ViewKind } from "@starter/chem-render";
import { createDocument, createPanel, type StylePresetId } from "@starter/shared";

import {
  annotationSizeNotice,
  bondLengthNotice,
  figureSvgForFile,
  figureSvgForRaster,
  formatPt,
  labelSizeNotice,
  prepareFigure,
  rasterTooLarge,
  scaleNotice,
} from "@/lib/export/figure";
import { MAX_FRAGMENT_LENGTH } from "@/lib/io/fragment";
import { normalizeMolblock, smilesAndMolblock } from "@/lib/rdkit/ops";
import { hasMeaningfulCoordinates, moleculeToMolblock } from "@/lib/rdkit/translate";

import type { Rasterize } from "./png.js";
import { resolveStructure, type LoadRdkit, type StructureInput } from "./structure.js";

/** Read off `prepareFigure` rather than imported from the client's store
 *  types, which would pull the store's middleware typings in with it. */
type FigureExportSettings = Parameters<typeof prepareFigure>[1];

export interface ToolDeps {
  readonly loadRdkit: LoadRdkit;
  readonly loadRasterizer: () => Promise<Rasterize>;
  /** The editor page a link opens, ending in `/`; the fragment is appended. */
  readonly editorUrl: string;
}

export type ToolResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

function refuse(message: string): { readonly ok: false; readonly message: string } {
  return { ok: false, message };
}

/** 1-based position in the molfile the server writes, which is `atomIds` order. */
function atomRef(mol: Molecule, atomId: AtomId): { readonly atom: number; readonly element: string } {
  return { atom: mol.atomIds.indexOf(atomId) + 1, element: requireAtom(mol, atomId).element };
}

function round(value: number, places: number): number {
  return Number(value.toFixed(places));
}

// ---------------------------------------------------------------------------
// render_figure
// ---------------------------------------------------------------------------

export type FigureStyleName = "publication" | "nature" | "screen";

export interface RenderFigureInput extends StructureInput {
  readonly views?: readonly ViewKind[] | undefined;
  /** "single", "double", or a maximum width in cm. */
  readonly width?: "single" | "double" | number | undefined;
  readonly style?: FigureStyleName | undefined;
  readonly format?: "svg" | "png" | undefined;
  readonly dpi?: 300 | 600 | undefined;
  readonly background?: "white" | "transparent" | undefined;
}

export interface RenderedFigure {
  readonly format: "svg" | "png";
  /** The SVG text, or the PNG's bytes. */
  readonly svg?: string;
  readonly png?: Uint8Array;
  readonly widthCm: number;
  readonly heightCm: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly dpi: number;
  /** The atom-label size as printed, after any scaling to fit. */
  readonly labelSizePt: number;
  readonly minimumTextPt: number;
  readonly bondLengthMm: number;
  /** 1 when the figure prints at its natural size. */
  readonly scale: number;
  /** Every printed-size warning the editor's export dialog would show. */
  readonly warnings: readonly string[];
  readonly notes: readonly string[];
}

/**
 * The editor's export, headless: the same document shape, the same
 * `prepareFigure`, the same serialiser and the same warnings. Only the PNG's
 * rasteriser differs (resvg for the browser's canvas).
 */
export async function renderFigure(
  input: RenderFigureInput,
  deps: ToolDeps,
): Promise<ToolResult<RenderedFigure>> {
  const resolved = await resolveStructure(input, deps.loadRdkit);
  if (!resolved.ok) return resolved;
  const { molecule, title, notes } = resolved.value;

  const styleName = input.style ?? "publication";
  const preset: StylePresetId = styleName;
  const views = input.views === undefined || input.views.length === 0 ? ["skeletal" as const] : input.views;
  const doc = createDocument({
    molecule,
    title: title === "" ? "Structure" : title,
    stylePreset: preset,
    panels: views.map((kind) => createPanel(kind, undefined, preset)),
  });

  const width = input.width ?? "single";
  const settings: FigureExportSettings = {
    width: typeof width === "number" ? "custom" : width,
    customWidthCm: typeof width === "number" ? width : 0,
    dpi: input.dpi ?? 300,
    // "publication" is the export default; any other style is the document's
    // own preset, which is what the dialog's "canvas" choice resolves to.
    style: styleName === "publication" ? "publication" : "canvas",
    pngBackground: input.background ?? "white",
  };

  const prepared = prepareFigure(doc, settings);
  if (!prepared.ok) return refuse(prepared.message);
  const figure = prepared.value;

  const warnings: string[] = [];
  const scaled = scaleNotice(figure.size, settings);
  if (scaled !== null) warnings.push(scaled);
  const labels = labelSizeNotice(figure, settings);
  if (labels !== null) warnings.push(`${labels.summary} ${labels.advice}`);
  const annotations = annotationSizeNotice(figure, settings);
  if (annotations !== null) warnings.push(`${annotations.summary} ${annotations.advice}`);
  const bonds = bondLengthNotice(figure);
  if (bonds !== null) warnings.push(bonds);

  const format = input.format ?? "png";
  const common = {
    format,
    // Rounded as the serialiser writes them, so the summary and the SVG's
    // own width/height attributes state the same size.
    widthCm: round(figure.size.widthCm, 4),
    heightCm: round(figure.size.heightCm, 4),
    widthPx: figure.size.widthPx,
    heightPx: figure.size.heightPx,
    dpi: settings.dpi,
    labelSizePt: Number(formatPt(figure.size.fontSizePt)),
    minimumTextPt: figure.figure.style.print.minTextPt,
    bondLengthMm: round(figure.size.bondLengthMm, 2),
    scale: round(figure.size.scale, 4),
    warnings,
    notes,
  } as const;

  if (format === "svg") {
    return { ok: true, value: { ...common, svg: figureSvgForFile(figure) } };
  }
  const tooLarge = rasterTooLarge(figure);
  if (tooLarge !== null) return refuse(tooLarge);
  const rasterize = await deps.loadRasterizer();
  const png = rasterize(figureSvgForRaster(figure, settings.pngBackground));
  return { ok: true, value: { ...common, png } };
}

// ---------------------------------------------------------------------------
// check_structure
// ---------------------------------------------------------------------------

export interface CheckedIssue {
  readonly kind: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  /** Every atom the issue concerns, anchor first. */
  readonly atoms: readonly { readonly atom: number; readonly element: string }[];
  readonly fixes: readonly {
    readonly kind: string;
    readonly title: string;
    /** The structure with this fix applied. */
    readonly molfile: string;
  }[];
}

export interface StructureCheck {
  readonly clean: boolean;
  readonly issues: readonly CheckedIssue[];
  /**
   * RDKit's refusal of a structure chem-core accepts, or null. A SMILES that
   * RDKit refuses never gets this far; a molfile can, and the editor reports
   * the same refusal when "Clean up" or an export reaches RDKit.
   */
  readonly toolkitRefusal: string | null;
  readonly notes: readonly string[];
}

export async function checkStructure(
  input: StructureInput,
  deps: ToolDeps,
): Promise<ToolResult<StructureCheck>> {
  const resolved = await resolveStructure(input, deps.loadRdkit);
  if (!resolved.ok) return resolved;
  const { molecule, source, notes } = resolved.value;

  const issues = chemistryIssues(molecule).map((issue): CheckedIssue => ({
    kind: issue.kind,
    severity: issue.severity,
    message: issue.message,
    atoms: issue.atomIds.map((id) => atomRef(molecule, id)),
    fixes: issueFixes(molecule, issue).flatMap((fix) => {
      const written = moleculeToMolblock(applyIssueFix(molecule, fix));
      return written.ok ? [{ kind: fix.kind, title: fix.title, molfile: written.value }] : [];
    }),
  }));

  let toolkitRefusal: string | null = null;
  if (source.kind !== "smiles") {
    const written = moleculeToMolblock(molecule);
    if (!written.ok) {
      toolkitRefusal = written.error.message;
    } else {
      const { rdkit, log } = await deps.loadRdkit();
      const read = normalizeMolblock(rdkit, written.value, "preserve", log);
      if (!read.ok) toolkitRefusal = read.message;
    }
  }

  return {
    ok: true,
    value: {
      clean: issues.length === 0 && toolkitRefusal === null,
      issues,
      toolkitRefusal,
      notes,
    },
  };
}

// ---------------------------------------------------------------------------
// describe
// ---------------------------------------------------------------------------

export interface StereoLabel {
  /** "R", "S", "r", "s", "E", "Z", "undetermined" or "mixture". */
  readonly label: string;
  /** Why no letter, for an undetermined unit. */
  readonly reason?: string;
}

export interface Description {
  readonly formula: string;
  /** Average molecular weight in g/mol, or null when an isotope's mass is not on record. */
  readonly molecularWeight: number | null;
  /** Monoisotopic mass, or null when it cannot be computed exactly. Never an average stood in. */
  readonly exactMass: number | null;
  readonly netCharge: number;
  readonly heavyAtomCount: number;
  readonly stereocentres: readonly ({ readonly atom: number; readonly element: string } & StereoLabel)[];
  readonly doubleBonds: readonly ({ readonly atoms: readonly [number, number] } & StereoLabel)[];
  readonly notes: readonly string[];
}

function stereoLabel(descriptor: StereoDescriptor | undefined): StereoLabel {
  if (descriptor === undefined) return { label: "undetermined" };
  if (descriptor.kind === "undetermined") return { label: "undetermined", reason: descriptor.reason };
  if (descriptor.kind === "mixture") return { label: "mixture" };
  return { label: descriptor.kind };
}

export async function describe(
  input: StructureInput,
  deps: ToolDeps,
): Promise<ToolResult<Description>> {
  const resolved = await resolveStructure(input, deps.loadRdkit);
  if (!resolved.ok) return resolved;
  const { molecule, notes } = resolved.value;
  const mass = massSummary(molecule);
  return {
    ok: true,
    value: {
      formula: mass.formula,
      molecularWeight: mass.molecularWeight ?? null,
      exactMass: mass.exactMass ?? null,
      netCharge: mass.netCharge,
      heavyAtomCount: mass.heavyAtomCount,
      stereocentres: stereocenterAtoms(molecule).map((id) => ({
        ...atomRef(molecule, id),
        ...stereoLabel(cipDescriptor(molecule, id)),
      })),
      doubleBonds: stereogenicBonds(molecule).map((id) => {
        const bond = requireBond(molecule, id);
        return {
          atoms: [atomRef(molecule, bond.from).atom, atomRef(molecule, bond.to).atom] as const,
          ...stereoLabel(doubleBondDescriptor(molecule, id)),
        };
      }),
      notes,
    },
  };
}

// ---------------------------------------------------------------------------
// convert
// ---------------------------------------------------------------------------

export interface ConvertInput extends StructureInput {
  /** Defaults to the other format: a SMILES becomes a molfile, anything else a SMILES. */
  readonly to?: "smiles" | "molfile" | undefined;
}

export interface Converted {
  readonly format: "smiles" | "molfile";
  readonly text: string;
  readonly notes: readonly string[];
}

/**
 * Molfiles are written by chem-core, as the editor's "Save as MOL" writes
 * them; SMILES is RDKit's canonical SMILES of that molfile, as the editor's
 * "Copy SMILES" computes it.
 */
export async function convert(
  input: ConvertInput,
  deps: ToolDeps,
): Promise<ToolResult<Converted>> {
  const resolved = await resolveStructure(input, deps.loadRdkit);
  if (!resolved.ok) return resolved;
  const { molecule, title, source, notes } = resolved.value;
  const to = input.to ?? (source.kind === "smiles" ? "molfile" : "smiles");

  const written = moleculeToMolblock(molecule, title);
  if (!written.ok) return refuse(written.error.message);
  if (to === "molfile") return { ok: true, value: { format: "molfile", text: written.value, notes } };

  const { rdkit, log } = await deps.loadRdkit();
  const layout = hasMeaningfulCoordinates(molecule) ? "preserve" : "generate";
  const read = smilesAndMolblock(rdkit, written.value, layout, log);
  if (!read.ok) return refuse(read.message);
  return { ok: true, value: { format: "smiles", text: read.value.smiles, notes } };
}

// ---------------------------------------------------------------------------
// editor_link
// ---------------------------------------------------------------------------

export interface EditorLink {
  readonly url: string;
  readonly notes: readonly string[];
}

/**
 * A link that opens the structure in the editor as a new, unsaved sketch.
 *
 * The structure is checked before a link is handed out — a link that opens
 * to an error message is worse than a refusal now. A SMILES (or a dictionary
 * name, through its SMILES) travels as `#smiles=`; a molfile travels as the
 * molfile chem-core writes for it, so a layout generated here arrives too.
 */
export async function editorLink(
  input: StructureInput,
  deps: ToolDeps,
): Promise<ToolResult<EditorLink>> {
  const resolved = await resolveStructure(input, deps.loadRdkit);
  if (!resolved.ok) return resolved;
  const { molecule, title, source, notes } = resolved.value;

  let key: "smiles" | "molfile";
  let text: string;
  if (source.kind === "molfile") {
    const written = moleculeToMolblock(molecule, title);
    if (!written.ok) return refuse(written.error.message);
    key = "molfile";
    text = written.value;
  } else {
    key = "smiles";
    text = source.kind === "smiles" ? source.text : source.smiles;
  }

  const body = `${key}=${encodeURIComponent(text)}`;
  if (body.length > MAX_FRAGMENT_LENGTH) {
    return refuse(
      `The structure needs ${body.length.toLocaleString("en-US")} characters in the link; ` +
        `the editor reads at most ${MAX_FRAGMENT_LENGTH.toLocaleString("en-US")}. ` +
        "Save it as a molfile with convert and open the file in the editor instead.",
    );
  }
  return { ok: true, value: { url: `${deps.editorUrl}#${body}`, notes } };
}

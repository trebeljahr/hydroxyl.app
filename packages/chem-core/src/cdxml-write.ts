/**
 * CDXML writer: the drawn structure as a ChemDraw XML document (decision 241).
 *
 * CDXML is what a co-author on ChemDraw asks for. A molfile carries the
 * chemistry but not the drawing — ChemDraw lays a molfile out again, drops the
 * labels and loses which side a double bond's second line sits on. CDXML
 * carries both: every `<n>` node holds its chemistry as attributes (`Element`,
 * `Charge`, `Isotope`, `NumHydrogens`, `Radical`) and its picture as a `<t>`
 * text label, and every `<b>` bond its order and its wedge.
 *
 * WHAT IS WRITTEN. Atoms, bonds, charges, isotopes, radicals, pinned and
 * derived hydrogen counts, wedges, hashes and wavy bonds, dative and bold
 * bonds (decision 226), a fixed double-bond side, display labels, and enhanced-stereo groups (`EnhancedStereoType`,
 * which ChemDraw and RDKit both read). One `<fragment>` per connected
 * component, because ChemDraw treats a fragment as one connected piece.
 *
 * WHAT IS NOT, and why it is reported rather than silent:
 *
 *   - An `either` double bond. CDXML has no crossed-double display, so the
 *     bond goes out as a plain double bond and the file states a geometry the
 *     drawing left open. The result's `dropped` list says so, and the caller
 *     shows the sentence.
 *
 * Silently dropped, as in the molfile writer, because they change how the
 * structure is drawn and not which structure it is: `lonePairs` and an `auto`
 * double-bond side (ChemDraw picks its own, as our renderer does).
 *
 * A DISPLAY LABEL IS A GENERIC NICKNAME, NOT ITS ELEMENT. The molfile writer
 * refuses a labelled atom, because writing the element under "Ph" would export
 * a methyl. CDXML has a node type for "text that stands for a group whose
 * atoms are not drawn" — `GenericNickname` — so the label goes out as that,
 * with `Element="0"`. The zero is not decoration: CDXML's default element is
 * carbon, and RDKit 2026.03 reads a nickname outside ChemDraw's fixed list
 * (R, X, Ar, …) as a plain carbon with only a log line ("Unhandled generic
 * nickname: Ph"). With the zero it reads a dummy atom. Measured.
 *
 * Aromatic flags are kekulised first. ChemDraw's `Order="1.5"` draws a dashed
 * second line, which is not what the canvas shows, and the hydrogen counts
 * written are the ones the Kekulé form derives (see `writeMolblock` for the
 * thiophene case that makes the order matter).
 *
 * Coordinates are y-down points (CDXML's frame), so y flips here and only
 * here, as it does in the SVG renderer. One model bond is `CDXML_BOND_LENGTH`
 * points: 14.4 pt is ChemDraw's ACS Document 1996 bond length, the style most
 * journals ask for, so the structure opens at the size a co-author expects.
 *
 * DETERMINISM. No timestamp, no random ids, no object-key order: two writes
 * of the same molecule are byte-identical, like the molblock.
 */

import { hasAromaticFlags, kekulize } from "./aromatic.js";
import { elementBySymbol } from "./elements.js";
import { connectedComponents, neighborIds, requireAtom, requireBond } from "./molecule.js";
import { stereoGroupsOf } from "./stereo-groups.js";
import type { Atom, AtomId, BondId, BondStereo, Molecule, StereoGroupKind } from "./types.js";
import { implicitHydrogenCount } from "./valence.js";

/** Points per model bond length. ACS Document 1996: 0.2 inch. */
export const CDXML_BOND_LENGTH = 14.4;

/** ACS 1996 label size, in points. */
const LABEL_SIZE = 10;

/** The one font in the font table: Arial, ChemDraw's ACS default. */
const FONT_ID = 3;

/**
 * `face` bit flags. 96 is ChemDraw's "Formula" face, which subscripts every
 * digit — "NH2" renders as NH₂ — and is what ChemDraw writes for atom labels.
 * Superscript carries charges, isotopes and the radical dot.
 */
const FACE_FORMULA = 96;
const FACE_SUPERSCRIPT = 64;

/** Blank page margin around the structure, in points. */
const MARGIN = 36;

/**
 * Rough Arial advance widths at `LABEL_SIZE`, used only to centre a label's
 * element symbol on its atom. ChemDraw re-measures text when it draws, so
 * an error here moves a label by a fraction of a point, never the chemistry.
 */
const UPPER_WIDTH = 6.7;
const LOWER_WIDTH = 5.6;
const SMALL_WIDTH = 4.2;
/** Baseline offset that centres a capital vertically on the atom. */
const CAP_HALF_HEIGHT = 3.6;

const STEREO_DISPLAY: Readonly<Record<BondStereo, string | undefined>> = {
  none: undefined,
  // "Begin" means the narrow end is at `B`, which is this model's `from`.
  wedge: "WedgeBegin",
  hash: "WedgedHashBegin",
  wavy: "Wavy",
  either: undefined,
};

const ENHANCED_STEREO_TYPE: Readonly<Record<StereoGroupKind, string>> = {
  abs: "Absolute",
  and: "And",
  or: "Or",
};

export interface CdxmlWriteOptions {
  /** `CreationProgram` attribute. Defaults to "chemcore". */
  readonly program?: string | undefined;
}

export interface CdxmlWriteResult {
  readonly cdxml: string;
  /**
   * One sentence per statement the drawing makes that the file cannot.
   * Empty for almost every structure.
   */
  readonly dropped: readonly string[];
}

interface Run {
  readonly text: string;
  readonly face: number;
}

/**
 * Write `mol` as a CDXML document.
 *
 * Never throws for a well-formed molecule: everything CDXML cannot hold is
 * listed in `dropped` instead.
 */
export function writeCdxml(mol: Molecule, options: CdxmlWriteOptions = {}): CdxmlWriteResult {
  const dropped: string[] = [];
  const kekule = hasAromaticFlags(mol) ? kekulize(mol) : mol;

  // Object ids are CDXML's own integers. 1 and 2 are the page and the
  // document's font, so atoms and bonds start after them.
  let nextId = 10;
  const nodeId = new Map<AtomId, number>();
  for (const id of mol.atomIds) nodeId.set(id, nextId++);
  const bondId = new Map<BondId, number>();
  for (const id of mol.bondIds) bondId.set(id, nextId++);

  const groupOf = new Map<AtomId, { kind: StereoGroupKind; index: number }>();
  for (const group of stereoGroupsOf(mol)) {
    for (const id of group.atomIds) groupOf.set(id, { kind: group.kind, index: group.index });
  }

  // Y-up model units to y-down points, shifted so the structure sits a
  // margin in from the page corner.
  let minX = Infinity;
  let maxY = -Infinity;
  for (const id of mol.atomIds) {
    const { pos } = requireAtom(mol, id);
    minX = Math.min(minX, pos.x);
    maxY = Math.max(maxY, pos.y);
  }
  const toPage = (atom: Atom): [number, number] => [
    MARGIN + (atom.pos.x - minX) * CDXML_BOND_LENGTH,
    MARGIN + (maxY - atom.pos.y) * CDXML_BOND_LENGTH,
  ];

  const fragments: string[] = [];
  for (const component of connectedComponents(mol)) {
    const inComponent = new Set(component);
    const lines: string[] = [];
    // Atom order inside a fragment follows the molecule's own order, not the
    // component traversal, so the output does not depend on how
    // `connectedComponents` walks.
    for (const id of mol.atomIds) {
      if (!inComponent.has(id)) continue;
      lines.push(nodeXml(mol, kekule, id, nodeId.get(id) ?? 0, toPage, groupOf.get(id)));
    }
    for (const id of mol.bondIds) {
      const bond = requireBond(mol, id);
      if (!inComponent.has(bond.from)) continue;
      const attrs: string[] = [
        `id="${bondId.get(id) ?? 0}"`,
        `B="${nodeId.get(bond.from) ?? 0}"`,
        `E="${nodeId.get(bond.to) ?? 0}"`,
      ];
      const order = requireBond(kekule, id).order;
      // ChemDraw's dative order draws the arrow from `B` to `E`, which is
      // chem-core's donor-to-acceptor direction (decision 226).
      if (bond.dative) attrs.push(`Order="dative"`);
      else if (order !== 1) attrs.push(`Order="${order}"`);
      const stereoDisplay = order === 1 && !bond.dative ? STEREO_DISPLAY[bond.stereo] : undefined;
      // A wedge already says more than bold would, so it wins.
      const display = stereoDisplay ?? (bond.bold ? "Bold" : undefined);
      if (display !== undefined) attrs.push(`Display="${display}"`);
      if (order === 2) {
        // Left and right are as seen walking from `B` to `E` on the page, the
        // meaning `doubleBondSide` already has (90 degrees counter-clockwise of
        // from->to in y-up space is the viewer's left), so the y flip leaves
        // the word alone.
        if (bond.doubleBondSide === "centered") attrs.push(`DoublePosition="Center"`);
        else if (bond.doubleBondSide === "left") attrs.push(`DoublePosition="Left"`);
        else if (bond.doubleBondSide === "right") attrs.push(`DoublePosition="Right"`);
      }
      if (bond.stereo === "either") {
        dropped.push(
          `Bond ${id} is drawn as a crossed double bond (cis/trans unknown). CDXML has no crossed double bond, ` +
            `so the file draws it as an ordinary double bond with the geometry shown.`,
        );
      }
      lines.push(`<b ${attrs.join(" ")}/>`);
    }
    fragments.push(`<fragment id="${nextId++}">\n${lines.join("\n")}\n</fragment>`);
  }

  const program = escapeXml(options.program ?? "chemcore");
  const cdxml = [
    `<?xml version="1.0" encoding="UTF-8" ?>`,
    `<!DOCTYPE CDXML SYSTEM "http://www.cambridgesoft.com/xml/cdxml.dtd" >`,
    `<CDXML CreationProgram="${program}" BondLength="${fmt(CDXML_BOND_LENGTH)}" ` +
      `LabelFont="${FONT_ID}" LabelSize="${LABEL_SIZE}" LabelFace="${FACE_FORMULA}" ` +
      `CaptionFont="${FONT_ID}" CaptionSize="${LABEL_SIZE}">`,
    `<fonttable>\n<font id="${FONT_ID}" charset="iso-8859-1" name="Arial"/>\n</fonttable>`,
    `<page id="1">`,
    ...fragments,
    `</page>`,
    `</CDXML>`,
    ``,
  ].join("\n");
  return { cdxml, dropped };
}

function nodeXml(
  mol: Molecule,
  kekule: Molecule,
  id: AtomId,
  cdxId: number,
  toPage: (atom: Atom) => [number, number],
  group: { kind: StereoGroupKind; index: number } | undefined,
): string {
  const atom = requireAtom(mol, id);
  const [x, y] = toPage(atom);
  const attrs: string[] = [`id="${cdxId}"`, `p="${fmt(x)} ${fmt(y)}"`];

  if (group !== undefined) {
    attrs.push(`EnhancedStereoType="${ENHANCED_STEREO_TYPE[group.kind]}"`);
    // ChemDraw numbers And and Or groups; an Absolute group has no number.
    if (group.kind !== "abs") attrs.push(`EnhancedStereoGroupNum="${group.index}"`);
  }

  if (atom.label !== undefined) {
    attrs.push(
      `NodeType="GenericNickname"`,
      `GenericNickname="${escapeXml(atom.label)}"`,
      `Element="0"`,
    );
    return withText(attrs, x, y, [{ text: atom.label, face: FACE_FORMULA }], 0, atom.label.charAt(0));
  }

  const z = elementBySymbol(atom.element)?.z;
  // Carbon is CDXML's default element and is left implicit, as ChemDraw does.
  if (z !== undefined && z !== 6) attrs.push(`Element="${z}"`);
  const charge = Math.trunc(atom.charge);
  if (charge !== 0) attrs.push(`Charge="${charge}"`);
  if (atom.isotope !== undefined) attrs.push(`Isotope="${atom.isotope}"`);
  const radical = Math.trunc(atom.radicalElectrons);
  // A spin multiplicity, as in a molfile: one electron a doublet, two a
  // triplet (the code RDKit writes for a carbene).
  if (radical > 0) attrs.push(`Radical="${radical >= 2 ? "Triplet" : "Doublet"}"`);

  if (!showsLabel(mol, id, atom)) return `<n ${attrs.join(" ")}/>`;

  const hydrogens = implicitHydrogenCount(kekule, id);
  attrs.push(`NumHydrogens="${hydrogens}"`);

  const runs: Run[] = [];
  if (atom.isotope !== undefined) runs.push({ text: String(atom.isotope), face: FACE_SUPERSCRIPT });
  const symbolStart = runs.reduce((sum, run) => sum + run.text.length, 0);
  const hText = hydrogens === 0 ? "" : hydrogens === 1 ? "H" : `H${hydrogens}`;
  // Hydrogens go on the side away from the bonds, as on the canvas: HO-R
  // when every neighbour is to the right, R-OH otherwise.
  const hLeft = hText !== "" && neighboursAllToTheRight(mol, id, atom);
  const formula = hLeft ? `${hText}${atom.element}` : `${atom.element}${hText}`;
  runs.push({ text: formula, face: FACE_FORMULA });
  let suffix = "";
  if (charge !== 0) {
    const magnitude = Math.abs(charge) === 1 ? "" : String(Math.abs(charge));
    suffix += `${magnitude}${charge > 0 ? "+" : "-"}`;
  }
  if (radical > 0) suffix += "•".repeat(Math.min(radical, 2));
  if (suffix !== "") runs.push({ text: suffix, face: FACE_SUPERSCRIPT });

  // Width of everything before the element symbol, so the symbol is what
  // sits on the atom.
  const before = hLeft ? textWidth(hText) : 0;
  return withText(attrs, x, y, runs, widthOfPrefix(runs, symbolStart) + before, atom.element.charAt(0));
}

function withText(
  attrs: readonly string[],
  x: number,
  y: number,
  runs: readonly Run[],
  offsetBeforeSymbol: number,
  anchorChar: string,
): string {
  // The text's origin is its left baseline; shift it so `anchorChar` — the
  // element symbol's first letter — is centred on the atom.
  const tx = x - offsetBeforeSymbol - charWidth(anchorChar) / 2;
  const ty = y + CAP_HALF_HEIGHT;
  const spans = runs
    .map(
      (run) =>
        `<s font="${FONT_ID}" size="${LABEL_SIZE}" face="${run.face}">${escapeXml(run.text)}</s>`,
    )
    .join("");
  return `<n ${attrs.join(" ")}>\n<t p="${fmt(tx)} ${fmt(ty)}" LabelJustification="Left">${spans}</t>\n</n>`;
}

/**
 * Whether ChemDraw should draw a text label here. The same rule the canvas
 * follows: skeletal carbon stays a bare vertex unless something about it has
 * to be read — a charge, an isotope, a radical, a pinned hydrogen count, or no
 * bonds at all (methane is "CH4", not an empty page).
 */
function showsLabel(mol: Molecule, id: AtomId, atom: Atom): boolean {
  if (atom.element !== "C") return true;
  return (
    atom.charge !== 0 ||
    atom.isotope !== undefined ||
    atom.radicalElectrons !== 0 ||
    atom.explicitHydrogenCount !== undefined ||
    neighborIds(mol, id).length === 0
  );
}

function neighboursAllToTheRight(mol: Molecule, id: AtomId, atom: Atom): boolean {
  const others = neighborIds(mol, id);
  if (others.length === 0) return false;
  return others.every((other) => requireAtom(mol, other).pos.x > atom.pos.x + 1e-6);
}

function charWidth(ch: string): number {
  if (/[0-9]/.test(ch)) return SMALL_WIDTH;
  if (/[a-z]/.test(ch)) return LOWER_WIDTH;
  return UPPER_WIDTH;
}

function textWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += charWidth(ch);
  return width;
}

/** Width of the first `chars` characters across the runs. */
function widthOfPrefix(runs: readonly Run[], chars: number): number {
  let width = 0;
  let left = chars;
  for (const run of runs) {
    if (left <= 0) break;
    const part = run.text.slice(0, left);
    width += run.face === FACE_SUPERSCRIPT ? part.length * SMALL_WIDTH : textWidth(part);
    left -= part.length;
  }
  return width;
}

/** Two decimals, trailing zeros trimmed: stable and readable. */
function fmt(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

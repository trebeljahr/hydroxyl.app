/**
 * Derived depiction nodes: their ids, their provenance, and the text of a
 * condensed group.
 *
 * THE ID SPACE (decision 147). A node a projection draws that is not one atom
 * of the molecule — a Fischer arm's synthetic hydrogen, a condensed CH2OH —
 * is named `<root atom id>.<tag>`: `a3.H`, `a3.H.2`, `a7.CH2OH`. The id is
 * DERIVED from the atom it hangs off and what it is, so the same molecule
 * projects to the same ids every run and scene ids built from them are
 * byte-stable. It is NEVER minted from the document's `nextId`: that would
 * turn a view into a model edit, break the store's reference-identity
 * history, and break `checkMoleculeIntegrity`'s rule that `nextId` exceeds
 * every id suffix. Ids this app mints never contain a ".", so the two spaces
 * are disjoint; a hand-edited document that breaks that makes the projection
 * `unavailable: id-conflict` rather than collide (checked by the engine).
 *
 * PROVENANCE is total over a layout's nodes and many-to-one: a synthetic H
 * leads back to its centre, a condensed node to every atom it folds. It is
 * how a click on a condensed CH2OH selects its carbon AND its oxygen. Lookups
 * go through `Object.hasOwn`, so a node id of "constructor" cannot resolve up
 * the prototype chain.
 */

import { bondBetween, neighborIds, requireAtom } from "../molecule.js";
import { compareIds } from "../selection.js";
import type { AtomId, Molecule } from "../types.js";
import { implicitHydrogenCount, isProtiumAtom } from "../valence.js";
import type { DerivedLabelPart, LayoutBondId, LayoutNodeId, ProjectedLayout } from "./types.js";

/** Joins a root atom id to the tag naming what hangs off it. */
const DERIVED_SEPARATOR = ".";

/** `<root>.<tag>`. The tag keeps only letters and digits. */
export function derivedNodeId(rootAtomId: AtomId, tag: string): LayoutNodeId {
  return `${rootAtomId}${DERIVED_SEPARATOR}${tag.replace(/[^A-Za-z0-9]/g, "")}`;
}

/**
 * The id of `host`'s `index`-th synthetic hydrogen: `a3.H`, then `a3.H.2`.
 * One-based past the first, because "a3.H.1" beside "a3.H" would read as two
 * names for the first hydrogen.
 */
export function hydrogenNodeId(host: AtomId, index: number): LayoutNodeId {
  const first = derivedNodeId(host, "H");
  return index === 0 ? first : `${first}${DERIVED_SEPARATOR}${index + 1}`;
}

/** The line from a synthetic hydrogen to its host: `a3.H.bond`. */
export function derivedBondId(nodeId: LayoutNodeId): LayoutBondId {
  return `${nodeId}${DERIVED_SEPARATOR}bond`;
}

/**
 * The source atoms a layout node stands for; empty for an id the layout does
 * not have. Total over the layout's nodes by construction.
 */
export function sourceAtomsOf(layout: ProjectedLayout, nodeId: LayoutNodeId): readonly AtomId[] {
  return Object.hasOwn(layout.provenance, nodeId) ? layout.provenance[nodeId]! : NO_ATOMS;
}

/** The node that draws `atomId` in this layout, or undefined if it is not shown. */
export function layoutNodeOf(layout: ProjectedLayout, atomId: AtomId): LayoutNodeId | undefined {
  return Object.hasOwn(layout.drawnAs, atomId) ? layout.drawnAs[atomId] : undefined;
}

const NO_ATOMS: readonly AtomId[] = Object.freeze([]);

// ---------------------------------------------------------------------------
// Condensed groups
// ---------------------------------------------------------------------------

/**
 * A group of atoms written as one label, hanging off the rest of a layout at
 * `root`.
 *
 * `east` reads away from the attachment to the right ("CH2OH", "COOH"),
 * `west` to the left ("HOH2C", "HOOC"): chemists reverse the main chain and
 * put each atom's hydrogens before its symbol when the label hangs off the
 * left, and a template knows which side it is drawing on. `tag` is the east
 * text with letters and digits only, for the node id.
 */
export interface CondensedGroup {
  readonly root: AtomId;
  /** Every atom the label stands for, in `mol.atomIds` order, root included. */
  readonly atomIds: readonly AtomId[];
  readonly east: readonly DerivedLabelPart[];
  readonly west: readonly DerivedLabelPart[];
  /**
   * The root's own symbol within `east`: 0, or 1 behind a mass number
   * ("¹³CH2OH").
   */
  readonly eastAnchor: number;
  /** The root's own symbol within `west` ("HOH2C": the C, index 4). */
  readonly westAnchor: number;
  readonly tag: string;
}

export type CondensedGroupResult =
  | { readonly kind: "group"; readonly group: CondensedGroup }
  /** The group contains a ring, which has no linear spelling. */
  | { readonly kind: "cyclic" }
  /** The group reaches an atom the caller fenced off (a backbone atom). */
  | { readonly kind: "reaches"; readonly atomId: AtomId };

/**
 * The group of atoms reachable from `root` without passing through `parent`,
 * spelled as a condensed label, or why it cannot be.
 *
 * `fence` holds atoms the group must not reach — a Fischer's other backbone
 * atoms, so a substituent that loops back into the backbone is refused
 * rather than drawn twice.
 *
 * THE SPELLING. Each atom is one block: its mass number if it carries one,
 * its symbol, then its hydrogens (implicit ones, plus explicit protium atoms
 * folded in), then its charge. A deuterium or tritium atom is NOT protium, so
 * it stays a child block of its own and reads "²H": a CD3 is "C²H3", a
 * 13C-labelled terminus "¹³CH2OH". The label is the only place a folded atom
 * is drawn, so dropping the mass would state the wrong nuclide.
 * Children follow in a fixed order — hydrogen-free terminal atoms first (the
 * =O of COOH and CHO), then by bond order, higher first, then by id — and a
 * run of identical children collapses to a count: CCl3, CH(CH3)2, C(CH3)3.
 * Every child but the last is bracketed unless it is one bare symbol, which
 * is what makes COOH read COOH and not C(O)OH.
 */
export function condensedGroup(
  mol: Molecule,
  root: AtomId,
  parent: AtomId | undefined,
  fence: ReadonlySet<AtomId> = EMPTY_FENCE,
): CondensedGroupResult {
  // Walk first, so a ring or a fence crossing is found before any spelling.
  const members = new Set<AtomId>([root]);
  const order: AtomId[] = [root];
  const cameFrom = new Map<AtomId, AtomId | undefined>([[root, parent]]);
  for (let i = 0; i < order.length; i++) {
    const atomId = order[i]!;
    for (const next of neighborIds(mol, atomId)) {
      // The way in, which for the root is the attachment it hangs off.
      if (next === cameFrom.get(atomId)) continue;
      if (fence.has(next)) return { kind: "reaches", atomId: next };
      if (members.has(next)) return { kind: "cyclic" };
      members.add(next);
      order.push(next);
      cameFrom.set(next, atomId);
    }
  }

  const spelled = spell(mol, root, parent, cameFrom);
  const atomIds = mol.atomIds.filter((id) => members.has(id));
  const tag = spelled.east
    .map((part) => part.text)
    .join("")
    .replace(/[^A-Za-z0-9]/g, "");
  return {
    kind: "group",
    group: Object.freeze({
      root,
      atomIds: Object.freeze(atomIds),
      east: Object.freeze(spelled.east),
      west: Object.freeze(spelled.west),
      eastAnchor: spelled.eastAnchor,
      westAnchor: spelled.westAnchor,
      tag,
    }),
  };
}

const EMPTY_FENCE: ReadonlySet<AtomId> = new Set();

interface Spelling {
  readonly east: DerivedLabelPart[];
  readonly west: DerivedLabelPart[];
  /** Where this atom's own symbol is in `east`: after its mass number, if any. */
  readonly eastAnchor: number;
  /** Where this atom's own symbol is in `west`. */
  readonly westAnchor: number;
  /** One block with no hydrogens and no children: "O", "Cl", "N". */
  readonly bare: boolean;
}

function spell(
  mol: Molecule,
  atomId: AtomId,
  parent: AtomId | undefined,
  cameFrom: ReadonlyMap<AtomId, AtomId | undefined>,
): Spelling {
  const children: AtomId[] = [];
  let hydrogens = implicitHydrogenCount(mol, atomId);
  for (const next of neighborIds(mol, atomId)) {
    if (next === parent || cameFrom.get(next) !== atomId) continue;
    // An explicit protium atom with nothing else on it is written as one of
    // its host's hydrogens, exactly as an implicit one would be.
    if (isProtiumAtom(mol, next) && neighborIds(mol, next).length === 1) {
      hydrogens += 1;
      continue;
    }
    children.push(next);
  }

  const atom = requireAtom(mol, atomId);
  const massParts = massPart(atom.isotope);
  const symbol: DerivedLabelPart = { kind: "symbol", text: atom.element };
  const hydrogenParts: DerivedLabelPart[] =
    hydrogens <= 0
      ? []
      : hydrogens === 1
        ? [{ kind: "symbol", text: "H" }]
        : [{ kind: "symbol", text: "H" }, { kind: "count", text: String(hydrogens) }];
  const chargeParts: DerivedLabelPart[] = chargePart(atom.charge);

  const spelledChildren = children
    .map((child) => ({ child, spelling: spell(mol, child, atomId, cameFrom) }))
    .sort((p, q) => {
      if (p.spelling.bare !== q.spelling.bare) return p.spelling.bare ? -1 : 1;
      const orderP = bondBetween(mol, atomId, p.child)?.order ?? 1;
      const orderQ = bondBetween(mol, atomId, q.child)?.order ?? 1;
      if (orderP !== orderQ) return orderQ - orderP;
      return compareIds(p.child, q.child);
    })
    .map((entry) => entry.spelling);

  // Runs of identical spellings collapse to one bracketed or bare group and a count.
  const groups: { spelling: Spelling; count: number }[] = [];
  for (const spelling of spelledChildren) {
    const last = groups[groups.length - 1];
    if (last !== undefined && textOf(last.spelling.east) === textOf(spelling.east)) last.count++;
    else groups.push({ spelling, count: 1 });
  }

  const east: DerivedLabelPart[] = [...massParts, symbol, ...hydrogenParts, ...chargeParts];
  // West: the last group's west spelling leads, the rest follow in reverse,
  // and this atom closes with its hydrogens BEFORE its symbol ("HO", "H2C").
  // The mass number stays glued to the symbol it labels ("HOH2¹³C").
  const west: DerivedLabelPart[] = [];
  groups.forEach((entry, index) => {
    const final = index === groups.length - 1;
    east.push(...grouped(entry.spelling.east, entry.spelling.bare, entry.count, final));
  });
  for (let index = groups.length - 1; index >= 0; index--) {
    const entry = groups[index]!;
    const final = index === groups.length - 1;
    west.push(...grouped(final ? entry.spelling.west : entry.spelling.east, entry.spelling.bare, entry.count, final));
  }
  west.push(...hydrogenParts);
  const westAnchor = west.length + massParts.length;
  west.push(...massParts, symbol, ...chargeParts);

  return {
    east,
    west,
    eastAnchor: massParts.length,
    westAnchor,
    bare: hydrogenParts.length === 0 && chargeParts.length === 0 && groups.length === 0,
  };
}

function grouped(
  parts: readonly DerivedLabelPart[],
  bare: boolean,
  count: number,
  final: boolean,
): DerivedLabelPart[] {
  const counted: DerivedLabelPart[] = count > 1 ? [{ kind: "count", text: String(count) }] : [];
  if (bare) return [...parts, ...counted];
  if (final && count === 1) return [...parts];
  return [{ kind: "symbol", text: "(" }, ...parts, { kind: "symbol", text: ")" }, ...counted];
}

/**
 * The mass-number prefix, by the rule chem-render's atom labels use: a finite
 * positive number is printed, anything else is no label.
 */
function massPart(isotope: number | undefined): DerivedLabelPart[] {
  if (isotope === undefined || !Number.isFinite(isotope) || isotope <= 0) return [];
  return [{ kind: "mass", text: String(isotope) }];
}

function chargePart(charge: number): DerivedLabelPart[] {
  if (!Number.isFinite(charge) || charge === 0) return [];
  const magnitude = Math.abs(Math.round(charge));
  if (magnitude === 0) return [];
  return [{ kind: "charge", text: `${magnitude > 1 ? magnitude : ""}${charge > 0 ? "+" : "-"}` }];
}

function textOf(parts: readonly DerivedLabelPart[]): string {
  return parts.map((part) => `${part.kind}:${part.text}`).join("|");
}

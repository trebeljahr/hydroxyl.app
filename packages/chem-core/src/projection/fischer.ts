/**
 * The chain frame's Fischer template: the engine's reference for a projection
 * that invents its own coordinates (decision 148).
 *
 * THE PICTURE. The backbone runs down the page's y axis, top end first, one
 * rung (`CHARACTERISTIC_LENGTHS.chain.rung` bond lengths) per atom. Every
 * interior backbone atom is a crossing with two strictly horizontal arms of
 * `chain.arm` bond lengths. Both termini are condensed groups ("CHO",
 * "CH2OH") on the vertical line. Horizontal bonds have depth `front` and
 * vertical ones `back`, which IS the Fischer convention, carried rather than
 * re-derived.
 *
 * WHAT GOES ON AN ARM:
 *
 *   a lone heteroatom     drawn as itself (its own node, its own label and
 *                         pick target): the O of an OH, an N, a halogen
 *   anything larger, or   condensed into one derived node at the arm's end,
 *   any carbon            spelled away from the crossing ("OH" on the right,
 *                         "HO" on the left, "CH3" / "H3C"): a Fischer names
 *                         its carbons, where a skeletal drawing leaves a
 *                         terminal methyl bare
 *   an implicit hydrogen  a synthetic hydrogen node, `a3.H`, whose
 *                         provenance is its centre
 *
 * A substituent containing a ring has no condensed spelling and is refused
 * (`substituent-too-large`); drawing it sideways off the cross is never an
 * option.
 *
 * PLACEMENT IS ASKED, NOT DERIVED. Every centre is first drawn with its
 * explicit ligands in id order, the first on the left arm. The draft is read
 * back through the fischer convention — horizontals toward the viewer — and
 * every centre whose parity disagrees with the configuration has its two
 * arms exchanged. Exchanging two ligands is one transposition, so it inverts
 * that centre and no other. No left/right rule restating the convention is
 * written anywhere, so this template cannot disagree with the reader.
 *
 * WHAT IT CANNOT DRAW. A cross always states a configuration, so a centre
 * the configuration leaves unspecified gets the default arms and is listed
 * `unspecified-in-config` (decision 146). A mixture gets a wavy mark on its
 * explicit arm, which the convention reads as the mixture it is.
 *
 * OWED ELSEWHERE: which backbone a sugar has and which end goes up for D/L
 * (`sugar-perception-numbering-and-ring-chain-op`), and the crossing drawn
 * without a vertex dot or a carbon label (`fischer-and-haworth-projections`).
 */

import { bondBetween, neighborIds, requireAtom } from "../molecule.js";
import { compareIds } from "../selection.js";
import { readConfig, type DepthConvention } from "../stereo-config.js";
import type { AtomId, BondId, Molecule } from "../types.js";
import { implicitHydrogenCount } from "../valence.js";
import { projectionUnavailable } from "./frames.js";
import { condensedGroup, derivedBondId, derivedNodeId, hydrogenNodeId, type CondensedGroup } from "./nodes.js";
import {
  draftLayoutAccess,
  emptyPlacedLayout,
  placeLayoutAtom,
  placeLayoutBond,
  placeLayoutDerivedNode,
  placementOfLayout,
  projectionBondLength,
  type PlacedLayout,
  type ProjectionTemplateImplementation,
  type ProjectionTemplateResolution,
} from "./template.js";
import { CHARACTERISTIC_LENGTHS, type ChainView, type ProjectionUnavailable } from "./types.js";

const FISCHER: DepthConvention = Object.freeze({ kind: "fischer" });

type Arm =
  | { readonly kind: "atom"; readonly atomId: AtomId; readonly bondId: BondId }
  | {
      readonly kind: "group";
      readonly group: CondensedGroup;
      readonly nodeId: string;
      readonly bondId: BondId;
    }
  | { readonly kind: "hydrogen"; readonly nodeId: string };

interface Crossing {
  readonly atomId: AtomId;
  /** Explicit ligands by id, then synthetic hydrogens. At most two. */
  readonly arms: readonly Arm[];
}

interface Terminus {
  readonly group: CondensedGroup;
  readonly nodeId: string;
  /** The backbone bond into the terminus. */
  readonly bondId: BondId;
}

interface Skeleton {
  /** The backbone, top of the page first. */
  readonly order: readonly AtomId[];
  readonly crossings: readonly Crossing[];
  readonly top: Terminus;
  readonly bottom: Terminus;
}

export const chainFischerTemplate: ProjectionTemplateImplementation<ChainView, Skeleton> = {
  resolve(mol, view, frame) {
    if (frame.kind !== "chain") return projectionUnavailable("template-not-built");
    const order = view.params.top === "last" ? [...frame.backbone].reverse() : [...frame.backbone];
    return resolveFischer(mol, order);
  },
  place(mol, config, _view, skeleton, toPlace) {
    const wanted = new Map(config.centres.map((c) => [c.atomId, c.reading]));
    const covered = new Set(toPlace.centres);
    const wavy = new Set<AtomId>();
    const unplaced: AtomId[] = [];
    for (const crossing of skeleton.crossings) {
      if (!covered.has(crossing.atomId)) continue;
      const want = wanted.get(crossing.atomId);
      if (want?.kind === "mixture") {
        if (crossing.arms.some((arm) => arm.kind !== "hydrogen")) wavy.add(crossing.atomId);
        else unplaced.push(crossing.atomId);
      } else if (want?.kind !== "specified") {
        unplaced.push(crossing.atomId);
      }
    }

    const first = drawFischer(mol, skeleton, new Set(), wavy);
    const read = readConfig(placementOfLayout(mol, draftLayoutAccess(first)), FISCHER);
    const flips = new Set<AtomId>();
    if (read.kind === "read") {
      for (const centre of read.config.centres) {
        const want = wanted.get(centre.atomId);
        if (!covered.has(centre.atomId) || want?.kind !== "specified") continue;
        if (centre.reading.kind === "specified" && centre.reading.parity !== want.parity) {
          flips.add(centre.atomId);
        }
      }
    }
    const draft = flips.size === 0 ? first : drawFischer(mol, skeleton, flips, wavy);
    for (const atomId of unplaced) {
      draft.unplaced.push({ unit: { kind: "centre", atomId }, reason: "unspecified-in-config" });
    }
    return draft;
  },
};

function resolveFischer(mol: Molecule, order: readonly AtomId[]): ProjectionTemplateResolution<Skeleton> {
  const fence = new Set(order);
  const crossings: Crossing[] = [];
  for (let i = 1; i + 1 < order.length; i++) {
    const host = order[i]!;
    const explicit = neighborIds(mol, host)
      .filter((id) => !fence.has(id))
      .sort(compareIds);
    const hydrogens = implicitHydrogenCount(mol, host);
    if (explicit.length + hydrogens > 2) return projectionUnavailable("too-many-substituents", [host]);
    const arms: Arm[] = [];
    for (const atomId of explicit) {
      const bondId = bondBetween(mol, host, atomId)!.id;
      const element = requireAtom(mol, atomId).element;
      if (element !== "C" && neighborIds(mol, atomId).length === 1) {
        arms.push({ kind: "atom", atomId, bondId });
        continue;
      }
      const group = groupAt(mol, atomId, host, fence);
      if (group.kind === "unavailable") return group;
      arms.push({ kind: "group", group: group.group, nodeId: derivedNodeId(atomId, group.group.tag), bondId });
    }
    for (let k = 0; k < hydrogens; k++) arms.push({ kind: "hydrogen", nodeId: hydrogenNodeId(host, k) });
    crossings.push({ atomId: host, arms });
  }

  const termini: Terminus[] = [];
  for (const [end, inward] of [
    [order[0]!, order[1]!],
    [order[order.length - 1]!, order[order.length - 2]!],
  ] as const) {
    const group = groupAt(mol, end, inward, fence);
    if (group.kind === "unavailable") return group;
    termini.push({
      group: group.group,
      nodeId: derivedNodeId(end, group.group.tag),
      bondId: bondBetween(mol, inward, end)!.id,
    });
  }

  // Derived ids must not be ids the document already uses (decision 147).
  const derived: string[] = termini.map((t) => t.nodeId);
  for (const crossing of crossings) {
    for (const arm of crossing.arms) {
      if (arm.kind === "group") derived.push(arm.nodeId);
      if (arm.kind === "hydrogen") derived.push(arm.nodeId, derivedBondId(arm.nodeId));
    }
  }
  const clashes = derived.filter((id) => Object.hasOwn(mol.atoms, id) || Object.hasOwn(mol.bonds, id));
  if (clashes.length > 0) {
    return projectionUnavailable(
      "id-conflict",
      clashes.filter((id) => Object.hasOwn(mol.atoms, id)),
      clashes.filter((id) => Object.hasOwn(mol.bonds, id)),
    );
  }

  return {
    kind: "available",
    skeleton: { order, crossings, top: termini[0]!, bottom: termini[1]! },
  };
}

function groupAt(
  mol: Molecule,
  root: AtomId,
  parent: AtomId,
  fence: ReadonlySet<AtomId>,
): { readonly kind: "group"; readonly group: CondensedGroup } | ProjectionUnavailable {
  const result = condensedGroup(mol, root, parent, fence);
  if (result.kind === "reaches") {
    return projectionUnavailable("backbone-in-ring", [root, result.atomId].sort(compareIds));
  }
  if (result.kind === "cyclic") return projectionUnavailable("substituent-too-large", [root]);
  return result;
}

/**
 * The picture, with the arms at the centres in `flips` exchanged and a wavy
 * mark on the first explicit arm of each centre in `wavy`.
 */
function drawFischer(
  mol: Molecule,
  skeleton: Skeleton,
  flips: ReadonlySet<AtomId>,
  wavy: ReadonlySet<AtomId>,
): PlacedLayout {
  const b = projectionBondLength(mol);
  const rung = CHARACTERISTIC_LENGTHS.chain.rung * b;
  const armLength = CHARACTERISTIC_LENGTHS.chain.arm * b;
  const draft = emptyPlacedLayout(FISCHER, b);
  const n = skeleton.order.length;
  const yAt = (index: number): number => ((n - 1) / 2 - index) * rung;

  const nodeOf = (atomId: AtomId): string => {
    if (atomId === skeleton.top.group.root) return skeleton.top.nodeId;
    if (atomId === skeleton.bottom.group.root) return skeleton.bottom.nodeId;
    return atomId;
  };

  skeleton.crossings.forEach((crossing, k) => {
    const host = crossing.atomId;
    const y = yAt(k + 1);
    placeLayoutAtom(draft, host, { x: 0, y });
    // One arm alone goes right; two go first-left, second-right, unless flipped.
    const sides = crossing.arms.length === 1 ? [1] : [-1, 1];
    if (flips.has(host)) sides.reverse();
    crossing.arms.forEach((arm, index) => {
      const side = sides[index]!;
      const pos = { x: side * armLength, y };
      switch (arm.kind) {
        case "atom":
          placeLayoutAtom(draft, arm.atomId, pos);
          placeLayoutBond(draft, sourceBond(mol, arm.bondId, host, arm.atomId), "front");
          break;
        case "group":
          placeLayoutDerivedNode(
            draft,
            {
              id: arm.nodeId,
              kind: "condensed",
              host: arm.group.root,
              label: side < 0 ? arm.group.west : arm.group.east,
              anchor: side < 0 ? arm.group.westAnchor : 0,
            },
            pos,
            arm.group.atomIds,
          );
          placeLayoutBond(draft, sourceBond(mol, arm.bondId, host, arm.nodeId), "front");
          break;
        case "hydrogen":
          placeLayoutDerivedNode(
            draft,
            { id: arm.nodeId, kind: "hydrogen", host, label: HYDROGEN_LABEL, anchor: 0 },
            pos,
            [host],
          );
          placeLayoutBond(draft, { id: derivedBondId(arm.nodeId), from: host, to: arm.nodeId, order: 1 }, "front");
          break;
      }
    });
    if (wavy.has(host)) {
      for (const arm of crossing.arms) {
        if (arm.kind === "hydrogen") continue;
        draft.marks.set(arm.bondId, { stereo: "wavy", narrowEnd: host });
        break;
      }
    }
  });

  for (const [terminus, index] of [
    [skeleton.top, 0],
    [skeleton.bottom, n - 1],
  ] as const) {
    placeLayoutDerivedNode(
      draft,
      { id: terminus.nodeId, kind: "condensed", host: terminus.group.root, label: terminus.group.east, anchor: 0 },
      { x: 0, y: yAt(index) },
      terminus.group.atomIds,
    );
  }

  for (let i = 0; i + 1 < n; i++) {
    const upper = skeleton.order[i]!;
    const lower = skeleton.order[i + 1]!;
    const bond = bondBetween(mol, upper, lower)!;
    placeLayoutBond(draft, sourceBond(mol, bond.id, nodeOf(upper), nodeOf(lower)), "back");
  }
  return draft;
}

const HYDROGEN_LABEL = Object.freeze([Object.freeze({ kind: "symbol" as const, text: "H" })]);

/** A source bond drawn between two layout nodes, `from` first as the layout reads. */
function sourceBond(mol: Molecule, bondId: BondId, from: string, to: string) {
  const bond = mol.bonds[bondId]!;
  return { id: bondId, from, to, order: bond.order, sourceBondId: bondId };
}

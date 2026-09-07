/**
 * Keyboard traversal of the structure: which atom an arrow key moves to.
 *
 * Pure, over model coordinates, so it is provable in a plain node process
 * against real molecules rather than through a rendered canvas that jsdom
 * gives no layout to.
 *
 * ── TWO MODES, BECAUSE ONE KEY CANNOT HONOUR BOTH REQUIREMENTS ────────────
 *
 * "Arrow keys move focus atom-to-atom ALONG BONDS" and "keyboard traversal
 * REACHES EVERY ATOM" are both required, and no single rule delivers both.
 * Following bonds means the walk is a walk on the graph, and a graph walk
 * driven by one direction gets stuck: on a hexagon, pressing Right from the
 * bottom vertex takes the bond to the lower-right vertex, from which no bond
 * points right — so the fallback steps back to the bottom vertex and the two
 * trade the focus forever. Two of the six are never seen. Any preference for
 * a bonded neighbour can skip an atom, and any rule that cannot skip is not
 * following bonds.
 *
 * So they are two modes on two keys:
 *
 *   ARROW           the bonded neighbour lying most nearly that way, else the
 *                   next atom in the molecule's own order — which is what
 *                   lets an arrow cross into a disconnected fragment at all.
 *   SHIFT + ARROW   the next atom in `atomIds` order, bonds ignored. Visits
 *                   every atom in the document in a fixed number of presses,
 *                   by construction, and that is the completeness guarantee
 *                   a screen-reader user's access rests on.
 *
 * MODEL COORDINATES ARE Y-UP, so ArrowUp is +y. The renderer flips; nothing
 * here does, and nothing here converts to pixels — a traversal that depended
 * on the zoom would change its answer when the user scrolled.
 */

import { neighborIds } from "@starter/chem-core";
import type { AtomId, Molecule, Vec2 } from "@starter/chem-core";

export type ArrowDirection = "up" | "down" | "left" | "right";

/** Y-UP: this is the model plane, not the screen. */
export const ARROW_VECTORS: Readonly<Record<ArrowDirection, Vec2>> =
  Object.freeze({
    up: Object.freeze({ x: 0, y: 1 }),
    down: Object.freeze({ x: 0, y: -1 }),
    left: Object.freeze({ x: -1, y: 0 }),
    right: Object.freeze({ x: 1, y: 0 }),
  });

/**
 * How far off the arrow a bond may point and still count, as a dot product
 * against the unit arrow.
 *
 * `cos(75°)`. Wider than a quadrant, because a hexagon's bonds sit at 60° and
 * 120° from vertical and a strict 90° cone would make "up" ambiguous at every
 * ring vertex; narrow enough that "right" never walks a bond going left.
 */
const DIRECTION_THRESHOLD = 0.2588;

function positionOf(mol: Molecule, id: AtomId): Vec2 | undefined {
  return Object.hasOwn(mol.atoms, id) ? mol.atoms[id]?.pos : undefined;
}

/**
 * How an arrow moves the focus: along a bond where it can, or straight
 * through the document's atom order.
 */
export type TraversalMode = "bonded" | "sequential";

/**
 * The bonded neighbour of `from` that lies most nearly in `direction`, or
 * undefined when no bond points that way.
 */
export function neighbourInDirection(
  mol: Molecule,
  from: AtomId,
  direction: ArrowDirection,
): AtomId | undefined {
  const origin = positionOf(mol, from);
  if (origin === undefined) return undefined;
  const arrow = ARROW_VECTORS[direction];

  let best: AtomId | undefined;
  let bestScore = DIRECTION_THRESHOLD;
  for (const id of neighborIds(mol, from)) {
    const pos = positionOf(mol, id);
    if (pos === undefined) continue;
    const dx = pos.x - origin.x;
    const dy = pos.y - origin.y;
    const length = Math.hypot(dx, dy);
    // A zero-length bond (two atoms left coincident by an import) has no
    // direction to compare; skipping it beats dividing by zero and picking it
    // every time.
    if (!Number.isFinite(length) || length === 0) continue;
    const score = (dx * arrow.x + dy * arrow.y) / length;
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

/**
 * Where an arrow key moves the canvas focus.
 *
 * `undefined` in and the first atom comes out, so the first arrow press after
 * focusing an empty-focus canvas lands somewhere rather than doing nothing.
 * `undefined` out only for a molecule with no atoms.
 */
export function nextFocusAtom(
  mol: Molecule,
  from: AtomId | undefined,
  direction: ArrowDirection,
  mode: TraversalMode = "bonded",
): AtomId | undefined {
  if (mol.atomIds.length === 0) return undefined;
  if (from === undefined || !Object.hasOwn(mol.atoms, from)) {
    return mol.atomIds[0];
  }

  if (mode === "bonded") {
    const bonded = neighbourInDirection(mol, from, direction);
    if (bonded !== undefined) return bonded;
  }

  // Forwards for up/right, backwards for down/left, so the walk is reversible
  // and a user who overshoots can come straight back. Wrapping is what makes
  // the sequential mode's completeness a guarantee rather than a hope: from
  // any atom, `atomIds.length - 1` presses visit every other one.
  const step = direction === "up" || direction === "right" ? 1 : -1;
  const index = mol.atomIds.indexOf(from);
  if (index < 0) return mol.atomIds[0];
  const count = mol.atomIds.length;
  const next = (index + step + count) % count;
  return mol.atomIds[next];
}

/**
 * What a screen reader should say when focus lands on an atom.
 *
 * Element, charge, and how many bonds it carries — the three facts that
 * distinguish one vertex from the next in a skeletal drawing, where every
 * carbon is an unlabelled corner. The bond COUNT rather than the valence:
 * "three bonds" is what the picture shows, and the implicit hydrogens are
 * derived rather than drawn.
 */
export function describeAtom(mol: Molecule, id: AtomId): string {
  const atom = Object.hasOwn(mol.atoms, id) ? mol.atoms[id] : undefined;
  if (atom === undefined) return "No atom";
  const bonds = neighborIds(mol, id).length;
  const charge =
    atom.charge === 0
      ? ""
      : `, charge ${atom.charge > 0 ? "+" : ""}${String(atom.charge)}`;
  const label = atom.label === undefined ? "" : `, labelled ${atom.label}`;
  return `${atom.element}${charge}${label}, ${String(bonds)} ${bonds === 1 ? "bond" : "bonds"}`;
}

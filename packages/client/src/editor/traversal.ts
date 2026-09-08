/**
 * Keyboard traversal of the structure: which atom an arrow key moves to.
 *
 * Pure, over model coordinates, so it is provable in a plain node process
 * against real molecules rather than through a rendered canvas that jsdom
 * gives no layout to.
 *
 * ── TWO MODES, AND WHY THE BONDED ONE NEEDS ONE BIT OF MEMORY ─────────────
 *
 * "Arrow keys move focus atom-to-atom ALONG BONDS" and "keyboard traversal
 * REACHES EVERY ATOM" pull in different directions, and the first attempt at
 * reconciling them was stateless: follow a bond where one points the right
 * way, else step through `atomIds`. That oscillates, and measurably — on
 * benzene it visited FOUR of six atoms pressing Right and TWO of six pressing
 * Down, trading the focus back and forth between one pair forever. The cycle
 * is always the same shape: the ordered fallback steps forward to an atom
 * whose bond points straight back where it came from.
 *
 * So the bonded walk is given the one fact that breaks it — WHERE IT CAME
 * FROM. `previous` is rejected as a destination, by the bonded step and by
 * the ordered fallback alike, which turns every 2-cycle into a step onwards.
 * With it, Right and Down each visit all six atoms of benzene. That is not a
 * proof of completeness for every graph (a preference for a bonded neighbour
 * can still skip an atom, and a rule that cannot skip is not following
 * bonds), which is why the second mode still exists and still carries the
 * guarantee:
 *
 *   ARROW           the bonded neighbour lying most nearly that way and not
 *                   the atom just left, else the next atom in the molecule's
 *                   own order — which is what lets an arrow cross into a
 *                   disconnected fragment at all.
 *   SHIFT + ARROW   the next atom in `atomIds` order, bonds and history
 *                   ignored. Visits every atom in the document in a fixed
 *                   number of presses, BY CONSTRUCTION, and that is the
 *                   completeness guarantee a screen-reader user's access
 *                   rests on. It is advertised on the canvas element's
 *                   `aria-keyshortcuts` so it is not folklore.
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
 *
 * `exclude` is the atom the focus just came from. Skipping it is what stops
 * the walk trading focus back and forth across one bond — see the header —
 * and it is a parameter rather than a module variable so this stays a pure
 * function a test can drive one press at a time.
 */
export function neighbourInDirection(
  mol: Molecule,
  from: AtomId,
  direction: ArrowDirection,
  exclude?: AtomId | undefined,
): AtomId | undefined {
  const origin = positionOf(mol, from);
  if (origin === undefined) return undefined;
  const arrow = ARROW_VECTORS[direction];

  let best: AtomId | undefined;
  let bestScore = DIRECTION_THRESHOLD;
  for (const id of neighborIds(mol, from)) {
    if (id === exclude) continue;
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
  previous?: AtomId | undefined,
): AtomId | undefined {
  if (mol.atomIds.length === 0) return undefined;
  if (from === undefined || !Object.hasOwn(mol.atoms, from)) {
    return mol.atomIds[0];
  }

  // SEQUENTIAL IGNORES `previous` DELIBERATELY. Its completeness is an
  // arithmetic property of stepping through `atomIds` and wrapping; skipping
  // an entry to avoid a repeat would break the arithmetic and, with it, the
  // one guarantee this file makes.
  const avoid = mode === "bonded" ? previous : undefined;

  if (mode === "bonded") {
    const bonded = neighbourInDirection(mol, from, direction, avoid);
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
  // Bounded, and the plain step is the answer when the search finds nothing:
  // in a two-atom molecule the only place to go IS the atom just left, and
  // going back beats standing still. Skipping `from` as well as `avoid` is
  // what keeps that case from resolving to a no-op.
  for (let hop = 1; hop <= count; hop++) {
    const candidate = mol.atomIds[(((index + step * hop) % count) + count) % count];
    if (candidate === undefined) continue;
    if (candidate === avoid || candidate === from) continue;
    return candidate;
  }
  return mol.atomIds[(((index + step) % count) + count) % count];
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
  const index = mol.atomIds.indexOf(id);
  // THE ORDINAL IS NOT DECORATION — it is what makes the announcement CHANGE.
  // A live region is announced when its text mutates, and on benzene every
  // one of the six carbons described to "C, 2 bonds": React wrote the same
  // string on every arrow press, the DOM never changed, and a screen-reader
  // user heard the first move and then silence for the rest of the ring.
  // Position in the document is the one fact that distinguishes chemically
  // identical atoms, and it doubles as orientation ("atom 3 of 6").
  const place =
    index < 0
      ? ""
      : `, atom ${String(index + 1)} of ${String(mol.atomIds.length)}`;
  return `${atom.element}${charge}${label}, ${String(bonds)} ${bonds === 1 ? "bond" : "bonds"}${place}`;
}

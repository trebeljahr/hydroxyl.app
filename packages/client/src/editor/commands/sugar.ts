/**
 * The ring-chain edit on the palette (decision 169): close the selected
 * open-chain sugar as an alpha or beta anomer or an alpha/beta mixture, as a
 * pyranose or a furanose, and open the selected sugar ring again.
 *
 * Kept out of `registry.ts` for the reason `stereo-groups.ts` is: the registry
 * stays a table of entries and the behaviour lives beside its own test. Like
 * that module it touches no DOM, storage or RDKit, so a plain-node test can
 * import it.
 *
 * WHAT A COMMAND DECIDES AND WHAT IT DOES NOT. Which atoms form an open-chain
 * sugar, which hydroxyl closes a pyranose, what the anomer is and whether the
 * edit is refused are all chem-core's answers (`carbohydrates`,
 * `sugarRingClosures`, `cycliseSugar`, `openRing`). This file finds the sugar
 * the selection means, calls one chem-core edit, commits it as ONE undo entry
 * (decision 104) and says in a sentence what happened.
 *
 * ONE ROW PER ANOMER, because chem-core requires one (decision 143) and a row
 * that defaulted to alpha would be the silent default that decision rules
 * out. The ring form picks the hydroxyl: a chemist asks for "the pyranose",
 * and turning that into C5–OH of an aldose or C6–OH of a 2-ketose is
 * `sugarRingClosures`' job, never a count of chain positions done here.
 *
 * WHICH SUGAR. The open chains whose carbonyl carbon lies in a connected
 * structure the selection touches, so one clicked atom is enough — the same
 * unit "Select connected structure" grows to. When a structure holds two
 * (a rare molecule, or a selection over two copies of one), the ones with a
 * selected chain atom win; still two, and the row is disabled and says so.
 *
 * WHAT THE STATUS LINE SAYS IS READ BACK. After a cyclisation the new ring is
 * perceived again and its D/L and alpha/beta read by chem-core, so the line
 * reports what was drawn rather than repeating the row's title. What the edit
 * could not do well is never hidden: centres it could not mark (`unmarked`)
 * and atoms or bonds it left on top of each other (`collisions`) are named and
 * selected. A refusal changes nothing, is held as `ui.refusal` so the canvas
 * rings the atoms it names (the way "Clean up" shows RDKit's), and selects
 * them.
 */

import {
  anomericConfiguration,
  carbohydrateLocant,
  carbohydrateOfRing,
  carbohydrateSeries,
  carbohydrates,
  reachableFrom,
  sugarRingClosures,
  sugarRings,
} from "@starter/chem-core";
import type {
  Anomer,
  AtomId,
  BondId,
  Carbohydrate,
  CycliseRefusalReason,
  Molecule,
  OpenRingRefusalReason,
  SugarRing,
  SugarRingClosure,
  SugarRingForm,
} from "@starter/chem-core";

import { movingAtomIds } from "@/editor/interaction/machine";
import { weakCache } from "@/lib/weak-cache";
import { guardedOps } from "@/state/chem-guard";
import type { EditorState, EditorStore, Selection } from "@/state";

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

/** Pyranose first: the form most figures want, and the palette's order. */
export const SUGAR_RING_FORMS: readonly SugarRingForm[] = ["pyranose", "furanose"];
export const ANOMERS: readonly Anomer[] = ["alpha", "beta", "mixture"];

/**
 * How a ring form reads in a title and a sentence. A `Record` over the union,
 * so a third form is a compile error here rather than a row with no words.
 */
const FORM_WORDS: Record<SugarRingForm, { readonly size: string; readonly keywords: readonly string[] }> = {
  pyranose: { size: "six-membered", keywords: ["pyranose", "six", "6"] },
  furanose: { size: "five-membered", keywords: ["furanose", "five", "5"] },
};

const ANOMER_WORDS: Record<Anomer, { readonly keywords: readonly string[] }> = {
  alpha: { keywords: ["alpha", "α", "anomer"] },
  beta: { keywords: ["beta", "β", "anomer"] },
  mixture: { keywords: ["mixture", "wavy", "alpha", "beta", "α", "β", "mutarotation", "equilibrium", "unknown"] },
};

export function cycliseCommandId(form: SugarRingForm, anomer: Anomer): string {
  return `structure.cyclise-sugar-${form}-${anomer}`;
}

/** "Cyclise sugar to α-pyranose", "… to pyranose, α/β mixture". */
export function cycliseTitle(form: SugarRingForm, anomer: Anomer): string {
  return anomer === "mixture"
    ? `Cyclise sugar to ${form}, α/β mixture`
    : `Cyclise sugar to ${anomer === "alpha" ? "α" : "β"}-${form}`;
}

export function cycliseKeywords(form: SugarRingForm, anomer: Anomer): readonly string[] {
  return [
    "sugar",
    "carbohydrate",
    "cyclise",
    "cyclize",
    "close",
    "ring",
    "hemiacetal",
    "hemiketal",
    ...FORM_WORDS[form].keywords,
    ...ANOMER_WORDS[anomer].keywords,
  ];
}

export const OPEN_RING_ID = "structure.open-sugar-ring";
export const OPEN_RING_TITLE = "Open sugar ring to the open chain";
export const OPEN_RING_KEYWORDS: readonly string[] = [
  "sugar",
  "carbohydrate",
  "open",
  "ring",
  "chain",
  "aldehydo",
  "keto",
  "hemiacetal",
  "linear",
  "mutarotation",
];

// ---------------------------------------------------------------------------
// Which sugar the selection means
// ---------------------------------------------------------------------------

type Resolved<T> =
  | { readonly kind: "one"; readonly value: T }
  | { readonly kind: "none" }
  | { readonly kind: "several"; readonly count: number };

interface Reach {
  readonly selected: ReadonlySet<AtomId>;
  readonly reach: ReadonlySet<AtomId>;
}

/**
 * The last answer per molecule INSTANCE, for the selection it was computed
 * for. The open palette asks all seven rows `enabled` and then
 * `disabledReason` against one state on every render, and each would
 * otherwise walk the same structures. Weak on the molecule, so a closed
 * document is not kept alive by it, and built by `weakCache` so the
 * retention count sees it.
 */
const REACH = weakCache<Molecule, { readonly selection: Selection; readonly value: Reach }>("molecule");

/**
 * The selected atoms (bond ends included) and every atom connected to one.
 * Each structure is walked once however many of its atoms are selected.
 */
function selectionReach(state: EditorState): Reach {
  const mol = state.document.molecule;
  const hit = REACH.get(mol);
  if (hit?.selection === state.selection) return hit.value;
  const selected = new Set<AtomId>(movingAtomIds(mol, state.selection));
  const reach = new Set<AtomId>();
  for (const id of selected) {
    if (reach.has(id)) continue;
    for (const atom of reachableFrom(mol, id)) reach.add(atom);
  }
  const value = { selected, reach };
  REACH.set(mol, { selection: state.selection, value });
  return value;
}

/** One candidate, or the directly selected ones among several, or a count. */
function narrowed<T>(
  candidates: readonly T[],
  atomsOf: (candidate: T) => readonly AtomId[],
  selected: ReadonlySet<AtomId>,
): Resolved<T> {
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "one", value: candidates[0]! };
  const direct = candidates.filter((c) => atomsOf(c).some((id) => selected.has(id)));
  if (direct.length === 1) return { kind: "one", value: direct[0]! };
  return { kind: "several", count: direct.length > 1 ? direct.length : candidates.length };
}

/** The open-chain sugar the selection means. */
export function selectedOpenSugar(state: EditorState): Resolved<Carbohydrate> {
  const mol = state.document.molecule;
  if (state.selection.atomIds.length === 0 && state.selection.bondIds.length === 0) {
    return { kind: "none" };
  }
  const { selected, reach } = selectionReach(state);
  const open = carbohydrates(mol).filter((unit) => unit.form === "open" && reach.has(unit.anchor));
  return narrowed(open, (unit) => [unit.anchor, ...unit.backbone, ...unit.beyondTie], selected);
}

/** The sugar ring the selection means, by its anomeric carbon. */
export function selectedSugarRing(state: EditorState): Resolved<SugarRing> {
  const mol = state.document.molecule;
  if (state.selection.atomIds.length === 0 && state.selection.bondIds.length === 0) {
    return { kind: "none" };
  }
  const { selected, reach } = selectionReach(state);
  const found: SugarRing[] = [];
  for (const perceived of sugarRings(mol)) {
    if (perceived.kind === "sugarRing" && reach.has(perceived.ring.anomericCarbon)) {
      found.push(perceived.ring);
    }
  }
  return narrowed(found, (ring) => [...ring.ringAtomIds, ring.anomericSubstituent], selected);
}

/**
 * The hydroxyl that closes `form` on `unit`: the only one, or the one the
 * selection names among several. Several are possible only for a carbonyl at
 * C4 or beyond, which can reach a hydroxyl of one ring size either way.
 */
function closureFor(
  state: EditorState,
  unit: Carbohydrate,
  form: SugarRingForm,
): Resolved<SugarRingClosure> {
  const closures = sugarRingClosures(state.document.molecule, unit.anchor).filter(
    (closure) => closure.form === form,
  );
  const { selected } = selectionReach(state);
  return narrowed(closures, (closure) => [closure.hydroxylOxygen, closure.closingCarbon], selected);
}

// ---------------------------------------------------------------------------
// Enabled, and why not
// ---------------------------------------------------------------------------

export const NO_OPEN_SUGAR_REASON =
  "Select an open-chain sugar: an aldose or ketose drawn with its C=O, not as a ring.";
export const NO_SUGAR_RING_REASON =
  "Select a sugar ring: a five- or six-membered ring with one oxygen and an anomeric carbon.";

function severalReason(count: number, what: string): string {
  return `The selection touches ${String(count)} ${what}. Select atoms of one of them.`;
}

/** Why a cyclise row is off, or undefined when it is on. */
export function cycliseDisabledReason(state: EditorState, form: SugarRingForm): string | undefined {
  const sugar = selectedOpenSugar(state);
  if (sugar.kind === "none") return NO_OPEN_SUGAR_REASON;
  if (sugar.kind === "several") return severalReason(sugar.count, "open-chain sugars");
  const closure = closureFor(state, sugar.value, form);
  if (closure.kind === "none") {
    return `No hydroxyl on this sugar's numbered chain closes a ${FORM_WORDS[form].size} ring (a ${form}).`;
  }
  if (closure.kind === "several") {
    return `${String(closure.count)} hydroxyls close a ${form} on this sugar. Select the one to use.`;
  }
  return undefined;
}

export function canCyclise(state: EditorState, form: SugarRingForm): boolean {
  return cycliseDisabledReason(state, form) === undefined;
}

export function openRingDisabledReason(state: EditorState): string | undefined {
  const ring = selectedSugarRing(state);
  if (ring.kind === "none") return NO_SUGAR_RING_REASON;
  if (ring.kind === "several") return severalReason(ring.count, "sugar rings");
  return undefined;
}

export function canOpenRing(state: EditorState): boolean {
  return openRingDisabledReason(state) === undefined;
}

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

/** chem-core's refusal reasons, each as the sentence a chemist reads. */
export const CYCLISE_REFUSALS: Record<CycliseRefusalReason, string> = {
  "no-such-atom": "the sugar's atoms are no longer in the drawing.",
  "not-a-carbonyl": "only an aldehyde or ketone carbon on an open chain can become the anomeric carbon.",
  "not-a-sugar": "this carbonyl's chain is not a carbohydrate chain.",
  "numbering-tied": "the chain numbers the same from both ends, so there is no C1 to close at.",
  "not-a-hydroxyl": "only a hydroxyl can become the ring oxygen, not an ether, ester or ring oxygen.",
  "not-on-the-chain": "that hydroxyl is not on the sugar's numbered chain.",
  "ring-size": "that hydroxyl closes neither a five- nor a six-membered ring.",
  "reference-undetermined":
    "α and β are stated against the reference centre, and its configuration is not drawn. " +
    "Draw its wedge or hash, or close the ring as an α/β mixture.",
};

export const OPEN_RING_REFUSALS: Record<OpenRingRefusalReason, string> = {
  "no-such-atom": "the ring's atoms are no longer in the drawing.",
  "not-a-sugar-ring": "no sugar ring has this anomeric carbon.",
  "ambiguous-ring": "two sugar rings share this anomeric carbon, so which one to open is not clear.",
  glycoside:
    "this is a glycoside, not a hemiacetal. Its anomeric carbon carries an OR, NR or SR group " +
    "instead of an OH, and opening it would mean deleting the aglycone.",
  lactone: "this ring is a lactone, an ester, which no ring-chain edit opens.",
};

function list(ids: readonly string[]): string {
  return ids.join(", ");
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** "C5", or the atom id where the numbering does not reach. */
function locantName(unit: Carbohydrate | undefined, atomId: AtomId): string {
  const locant = unit === undefined ? undefined : carbohydrateLocant(unit, atomId);
  return locant === undefined ? atomId : `C${locant}`;
}

/**
 * "β-D-pyranose", "D-furanose, α/β mixture": what chem-core reads off the
 * ring just drawn. D or L only when the series reads as one.
 */
function describeRing(mol: Molecule, ring: SugarRing, unit: Carbohydrate | undefined): string {
  if (unit === undefined) return ring.form;
  const series = carbohydrateSeries(mol, unit).kind;
  const prefix = series === "D" || series === "L" ? `${series}-` : "";
  const anomer = anomericConfiguration(mol, unit);
  switch (anomer.kind) {
    case "alpha":
      return `α-${prefix}${ring.form}`;
    case "beta":
      return `β-${prefix}${ring.form}`;
    case "mixture":
      return `${prefix}${ring.form}, α/β mixture`;
    default:
      return `${prefix}${ring.form}, anomer not stated`;
  }
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

/**
 * Hold a refusal where the canvas rings its atoms, select them, and say why.
 * Nothing was edited, so the refusal stays until the molecule next changes.
 */
function refuse(store: EditorStore, source: string, message: string, atomIds: readonly AtomId[]): void {
  const state = store.getState();
  const present = atomIds.filter((id) => Object.hasOwn(state.document.molecule.atoms, id));
  if (present.length > 0) {
    state.setRefusal({ source, atomIds: present, message });
    state.selectAtoms(present);
  }
  state.setStatusMessage(`${source} refused: ${message}`);
}

export function cycliseSelectedSugar(store: EditorStore, form: SugarRingForm, anomer: Anomer): void {
  const state = store.getState();
  const reason = cycliseDisabledReason(state, form);
  const sugar = selectedOpenSugar(state);
  const closure = sugar.kind === "one" ? closureFor(state, sugar.value, form) : undefined;
  if (reason !== undefined || sugar.kind !== "one" || closure?.kind !== "one") {
    state.setStatusMessage(reason ?? NO_OPEN_SUGAR_REASON);
    return;
  }
  const chain = sugar.value;
  const { carbonylCarbon, hydroxylOxygen, closingCarbon } = closure.value;
  const mol = state.document.molecule;
  const result = guardedOps.cycliseSugar(mol, { carbonylCarbon, hydroxylOxygen, anomer });
  if (result.kind === "refused") {
    refuse(store, "Cyclise", CYCLISE_REFUSALS[result.reason], result.atomIds);
    return;
  }

  const next = result.molecule;
  // Built from the product: it is the molecule the line describes.
  const unit = carbohydrateOfRing(next, result.ring);
  let message =
    `Closed ${locantName(chain, carbonylCarbon)} onto the ${locantName(chain, closingCarbon)} ` +
    `hydroxyl: ${describeRing(next, result.ring, unit)}`;

  const flagged: AtomId[] = [];
  const flaggedBonds: BondId[] = [];
  if (result.unmarked.length > 0) {
    message += `. Could not draw the configuration at ${list(result.unmarked)}`;
    flagged.push(...result.unmarked);
  }
  const { atoms, bonds } = result.collisions;
  if (atoms.length > 0 || bonds.length > 0) {
    const parts: string[] = [];
    if (atoms.length > 0) {
      parts.push(
        `${plural(atoms.length, "atom pair lies", "atom pairs lie")} on top of each other ` +
          `(${list(atoms.map(([p, q]) => `${p}/${q}`))})`,
      );
    }
    if (bonds.length > 0) {
      parts.push(
        `${plural(bonds.length, "pair of bonds crosses", "pairs of bonds cross")} ` +
          `(${list(bonds.map(([p, q]) => `${p}/${q}`))})`,
      );
    }
    message += `. The new layout could not clear everything: ${parts.join(" and ")}`;
    for (const [p, q] of atoms) flagged.push(p, q);
    for (const [p, q] of bonds) flaggedBonds.push(p, q);
  }
  if (flagged.length > 0 || flaggedBonds.length > 0) message += " (selected)";

  state.applyMoleculeEdit(cycliseTitle(form, anomer), () => next);
  if (flagged.length > 0 || flaggedBonds.length > 0) {
    store.getState().setSelection({
      atomIds: [...new Set(flagged)],
      bondIds: [...new Set(flaggedBonds)],
      annotationIds: [],
    });
  }
  store.getState().setStatusMessage(message);
}

export function openSelectedSugarRing(store: EditorStore): void {
  const state = store.getState();
  const resolved = selectedSugarRing(state);
  if (resolved.kind !== "one") {
    state.setStatusMessage(openRingDisabledReason(state) ?? NO_SUGAR_RING_REASON);
    return;
  }
  const ring = resolved.value;
  const mol = state.document.molecule;
  const result = guardedOps.openRing(mol, ring.anomericCarbon);
  if (result.kind === "refused") {
    refuse(store, "Open ring", OPEN_RING_REFUSALS[result.reason], result.atomIds);
    return;
  }
  // Named by the RING's numbering, before the edit: "the pyranose at C1".
  const unit = carbohydrateOfRing(mol, ring);
  const message =
    `Opened the ${ring.form} at ${locantName(unit, ring.anomericCarbon)}; ` +
    `the ${locantName(unit, ring.ringClosingCarbon)} hydroxyl is free again`;
  state.applyMoleculeEdit("Open sugar ring", () => result.molecule);
  store.getState().setStatusMessage(message);
}

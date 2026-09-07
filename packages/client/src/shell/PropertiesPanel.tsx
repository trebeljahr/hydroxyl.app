"use client";

/**
 * The right-hand properties panel: everything about the selection that is not
 * geometry.
 *
 * ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────────
 *
 * `Atom.aromatic` and `Bond.aromatic` get no control, and that is a rule
 * rather than an omission. Kekule is the STORAGE form and aromaticity is a
 * derived query; those two flags exist only to carry an importer's perception
 * until `kekulize()` normalises it. A checkbox that let a chemist declare a
 * cyclohexane aromatic would put a lie into the model that every downstream
 * pass — formula, valence, the renderer's circle — would then have to honour.
 *
 * ── AND ONE CONTROL THAT COMES WITH A WARNING ──────────────────────────────
 *
 * The atom LABEL. A display label ("Ph", "Boc", "R") is purely cosmetic —
 * valence and formula still read `element` — but `writeMolblock` THROWS
 * `MolblockLabelError` on any atom carrying one (decision 8: a Ph is never
 * silently written as a methyl). "Clean up structure" goes through a molblock,
 * so a labelled atom disables it. The field says so, in the panel, rather than
 * letting the user discover it from a status message twenty minutes later.
 *
 * ── THE VALUE LISTS COME FROM `@starter/shared` ────────────────────────────
 *
 * `BOND_ORDER_VALUES`, `BOND_STEREO_VALUES` and `DOUBLE_BOND_SIDE_VALUES` are
 * the same arrays the zod schema is generated from, exported for exactly this.
 * A literal `["none","wedge",...]` typed here would be a third copy of a union
 * that has already gone stale once — the `either` member encoded and then
 * failed to decode, which made one imported bond enough to render a saved
 * sketch unopenable.
 */

import { useState } from "react";
import type { ReactElement, ReactNode } from "react";

import type { Atom, Bond } from "@starter/chem-core";
import {
  BOND_ORDER_VALUES,
  BOND_STEREO_VALUES,
  DOUBLE_BOND_SIDE_VALUES,
} from "@starter/shared";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { commandById } from "@/editor/commands/registry";
import { cn } from "@/lib/utils";
import { guardedOps } from "@/state/chem-guard";
import { editorStore, useEditorStore } from "@/state";

function Field({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      {children}
      {hint === undefined ? null : (
        <span className="text-muted-foreground text-[11px] leading-tight">
          {hint}
        </span>
      )}
    </label>
  );
}

const inputClass =
  "border-input bg-background focus:ring-ring h-8 rounded-md border px-2 text-xs focus:outline-none focus:ring-2";

/**
 * A number field that keeps its own draft string.
 *
 * Writing the store on every keystroke would make "-1" unreachable: the "-"
 * alone parses as NaN, the field would reject it, and the minus sign would
 * never survive long enough to be followed by a digit. The draft commits on
 * blur and on Enter.
 *
 * THE RESET IS DONE DURING RENDER, not in an effect. Syncing a derived draft
 * with `useEffect(() => setDraft(...), [value])` renders the stale value
 * first and the fresh one a frame later, which for a field the user may be
 * typing into is a visible flicker; comparing against the last value seen is
 * React's own answer for exactly this shape.
 */
function NumberField({
  label,
  hint,
  value,
  allowEmpty,
  onCommit,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly value: number | undefined;
  readonly allowEmpty?: boolean;
  readonly onCommit: (value: number | undefined) => void;
}): ReactElement {
  const asText = value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(asText);
  const [lastSeen, setLastSeen] = useState(value);
  if (lastSeen !== value) {
    setLastSeen(value);
    setDraft(asText);
  }

  const commit = (): void => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (allowEmpty === true) onCommit(undefined);
      else setDraft(asText);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setDraft(asText);
      return;
    }
    onCommit(Math.trunc(parsed));
  };

  return (
    <Field label={label} {...(hint === undefined ? {} : { hint })}>
      <input
        type="text"
        inputMode="numeric"
        className={inputClass}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    </Field>
  );
}

function AtomProperties({ atom }: { readonly atom: Atom }): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Element">
        <input
          type="text"
          className={cn(inputClass, "font-mono")}
          defaultValue={atom.element}
          key={`${atom.id}:${atom.element}`}
          onBlur={(event) => {
            const raw = event.target.value.trim();
            if (raw === "" || raw === atom.element) return;
            // Through the same command the palette and the hotkey buffer use,
            // so all three normalise "cl" to "Cl" the one way.
            editorStore.getState().applyMoleculeEdit(
              `Set element to ${raw}`,
              (mol) => guardedOps.setElement(mol, atom.id, raw),
            );
          }}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Charge"
          value={atom.charge}
          onCommit={(next) => {
            if (next === undefined) return;
            editorStore
              .getState()
              .applyMoleculeEdit("Set charge", (mol) =>
                guardedOps.setCharge(mol, atom.id, next),
              );
          }}
        />
        <NumberField
          label="Radical e−"
          hint="0 normal, 1 radical, 2 carbene"
          value={atom.radicalElectrons}
          onCommit={(next) => {
            if (next === undefined) return;
            editorStore
              .getState()
              .applyMoleculeEdit("Set radical electrons", (mol) =>
                guardedOps.updateAtom(mol, atom.id, {
                  radicalElectrons: Math.max(0, next),
                }),
              );
          }}
        />
        <NumberField
          label="Isotope"
          hint="Blank for natural abundance"
          allowEmpty
          value={atom.isotope}
          onCommit={(next) => {
            editorStore
              .getState()
              .applyMoleculeEdit("Set isotope", (mol) =>
                guardedOps.setIsotope(mol, atom.id, next),
              );
          }}
        />
        <NumberField
          label="Explicit H"
          hint="Blank derives it from valence"
          allowEmpty
          value={atom.explicitHydrogenCount}
          onCommit={(next) => {
            editorStore
              .getState()
              .applyMoleculeEdit("Set explicit hydrogens", (mol) =>
                guardedOps.setExplicitHydrogenCount(mol, atom.id, next),
              );
          }}
        />
      </div>

      <Field
        label="Display label"
        hint="Cosmetic only — valence and formula still use the element. A labelled atom cannot be written to a molfile, so Clean up structure will refuse."
      >
        <input
          type="text"
          className={inputClass}
          key={`${atom.id}:label`}
          defaultValue={atom.label ?? ""}
          onBlur={(event) => {
            const raw = event.target.value.trim();
            const next = raw === "" ? undefined : raw;
            if (next === atom.label) return;
            editorStore
              .getState()
              .applyMoleculeEdit("Set label", (mol) =>
                guardedOps.setLabel(mol, atom.id, next),
              );
          }}
        />
      </Field>
    </div>
  );
}

const STEREO_LABELS: Readonly<Record<string, string>> = {
  none: "Plain",
  wedge: "Wedge",
  hash: "Hash",
  wavy: "Wavy",
  either: "Either (crossed)",
};

function BondProperties({ bond }: { readonly bond: Bond }): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Order">
        <Select
          value={String(bond.order)}
          onValueChange={(value) => {
            const order = Number(value);
            editorStore
              .getState()
              .applyMoleculeEdit("Set bond order", (mol) =>
                guardedOps.setBondOrder(mol, bond.id, order as 1 | 2 | 3),
              );
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BOND_ORDER_VALUES.map((value) => (
              <SelectItem key={value} value={String(value)}>
                {value === 1 ? "Single" : value === 2 ? "Double" : "Triple"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field
        label="Stereo"
        hint="The narrow end is at the bond's first atom. Use Flip to swap it."
      >
        <Select
          value={bond.stereo}
          onValueChange={(value) => {
            editorStore
              .getState()
              .applyMoleculeEdit("Set bond stereo", (mol) =>
                guardedOps.setBondStereo(
                  mol,
                  bond.id,
                  value as (typeof BOND_STEREO_VALUES)[number],
                ),
              );
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BOND_STEREO_VALUES.map((value) => (
              <SelectItem key={value} value={value}>
                {STEREO_LABELS[value] ?? value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field
        label="Double-bond side"
        hint="Which side the second line is drawn on. Auto reads it from the ring."
      >
        <Select
          value={bond.doubleBondSide}
          onValueChange={(value) => {
            editorStore
              .getState()
              .applyMoleculeEdit("Set double-bond side", (mol) =>
                guardedOps.setDoubleBondSide(
                  mol,
                  bond.id,
                  value as (typeof DOUBLE_BOND_SIDE_VALUES)[number],
                ),
              );
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DOUBLE_BOND_SIDE_VALUES.map((value) => (
              <SelectItem key={value} value={value}>
                <span className="capitalize">{value}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <button
        type="button"
        className="hover:bg-accent h-8 rounded-md border text-xs"
        onClick={() => {
          void commandById("structure.flip-bond").run(editorStore);
        }}
      >
        Flip wedge direction
      </button>
    </div>
  );
}

export function PropertiesPanel(): ReactElement {
  const molecule = useEditorStore((state) => state.document.molecule);
  const selection = useEditorStore((state) => state.selection);

  const atomId =
    selection.atomIds.length === 1 && selection.bondIds.length === 0
      ? selection.atomIds[0]
      : undefined;
  const bondId =
    selection.bondIds.length === 1 && selection.atomIds.length === 0
      ? selection.bondIds[0]
      : undefined;

  const atom =
    atomId !== undefined && Object.hasOwn(molecule.atoms, atomId)
      ? molecule.atoms[atomId]
      : undefined;
  const bond =
    bondId !== undefined && Object.hasOwn(molecule.bonds, bondId)
      ? molecule.bonds[bondId]
      : undefined;

  const total = selection.atomIds.length + selection.bondIds.length;

  return (
    <aside
      aria-label="Properties"
      data-shell="properties-panel"
      className="bg-background w-64 shrink-0 overflow-y-auto border-l p-3"
    >
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide">
        Properties
      </h2>
      {atom !== undefined ? (
        <AtomProperties atom={atom} />
      ) : bond !== undefined ? (
        <BondProperties bond={bond} />
      ) : (
        <p className="text-muted-foreground text-xs">
          {total === 0
            ? "Select one atom or one bond to edit it."
            : `${total} things selected. The panel edits one atom or one bond at a time; the command palette acts on the whole selection.`}
        </p>
      )}
    </aside>
  );
}

"use client";

/**
 * The properties popover: the status bar's readouts at full length, plus the
 * descriptors only RDKit can compute (decision 235).
 *
 * THE FORMULA IS THE TRIGGER. A separate "Properties" button would be one
 * more item in a bar that already sheds readouts below 900px (decision 139),
 * and the formula is what a chemist clicks when they want to know more about
 * what is drawn.
 *
 * NOTHING HERE BLOCKS. The masses and the formula are chem-core's, already
 * computed for the bar. The descriptors are requested when the popover opens
 * and arrive when they arrive; until then the rows say "Computing…", and a
 * refusal says "Unavailable" with its reason. A zero is never a stand-in.
 */

import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";

import { exactMassGap, descriptorsFor } from "@/editor/properties";
import type { DescriptorOutcome, PropertiesScope } from "@/editor/properties";
import { moleculeMass } from "@/editor/derived";
import type { Molecule } from "@starter/chem-core";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Four decimals: the precision a monoisotopic mass is quoted to. */
function formatMass(value: number): string {
  return value.toFixed(4);
}

function formatCharge(charge: number): string {
  if (charge === 0) return "0";
  return charge > 0 ? `+${String(charge)}` : String(charge);
}

function Row({
  name,
  label,
  children,
  title,
}: {
  readonly name: string;
  readonly label: string;
  readonly children: ReactNode;
  readonly title?: string | undefined;
}): ReactElement {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd data-property={name} title={title} className="text-foreground font-mono tabular-nums">
        {children}
      </dd>
    </>
  );
}

function Unavailable({ reason }: { readonly reason: string }): ReactElement {
  return (
    <span data-unavailable="" title={reason} className="font-sans">
      Unavailable
    </span>
  );
}

/**
 * The descriptor rows for `molecule`, asked for on mount.
 *
 * The outcome is stored WITH the molecule it answers, so a drawing that
 * changed while the worker was busy shows "Computing…" for the new one
 * instead of the old one's numbers under the new formula.
 */
function DescriptorRows({ molecule }: { readonly molecule: Molecule }): ReactElement {
  const [answer, setAnswer] = useState<
    { readonly molecule: Molecule; readonly outcome: DescriptorOutcome } | undefined
  >(undefined);
  useEffect(() => {
    let live = true;
    void descriptorsFor(molecule).then((outcome) => {
      if (live) setAnswer({ molecule, outcome });
    });
    return () => {
      live = false;
    };
  }, [molecule]);

  const outcome = answer?.molecule === molecule ? answer.outcome : undefined;
  const value = (render: (d: Extract<DescriptorOutcome, { ok: true }>["descriptors"]) => string) =>
    outcome === undefined ? (
      <span className="font-sans">Computing…</span>
    ) : outcome.ok ? (
      render(outcome.descriptors)
    ) : (
      <Unavailable reason={outcome.reason} />
    );

  return (
    <>
      <Row name="tpsa" label="TPSA" title="Topological polar surface area (Ertl; N and O only)">
        {value((d) => `${d.tpsa.toFixed(2)} Å²`)}
      </Row>
      <Row name="clogp" label="cLogP" title="Calculated logP (Wildman–Crippen)">
        {value((d) => d.clogp.toFixed(2))}
      </Row>
      <Row name="hbd" label="H-bond donors" title="Lipinski count: N–H and O–H">
        {value((d) => String(d.hbd))}
      </Row>
      <Row name="hba" label="H-bond acceptors" title="Lipinski count: every N and O">
        {value((d) => String(d.hba))}
      </Row>
      {outcome !== undefined && !outcome.ok ? (
        <p
          data-property="descriptors-reason"
          className="text-muted-foreground col-span-2 max-w-64 pt-1 font-sans whitespace-normal"
        >
          {outcome.reason}
        </p>
      ) : null}
    </>
  );
}

export function PropertiesPopover({
  scope,
  children,
}: {
  readonly scope: PropertiesScope;
  /** The trigger's content: the formula readout. */
  readonly children: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const mass = moleculeMass(scope.molecule);
  const gap = mass.exactMass === undefined ? exactMassGap(scope.molecule) : undefined;
  const atoms = scope.molecule.atomIds.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-status="formula"
        data-scope={scope.kind}
        title="Properties: masses, TPSA, cLogP, H-bond donors and acceptors"
        className="text-foreground hover:bg-muted rounded px-1 font-medium"
      >
        {children}
      </PopoverTrigger>
      <PopoverContent data-shell="properties" align="start" side="top" className="text-xs">
        <p className="text-muted-foreground pb-1 font-medium">
          {scope.kind === "selection"
            ? `Selection, ${String(atoms)} ${atoms === 1 ? "atom" : "atoms"}`
            : "Whole sketch"}
        </p>
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
          <Row name="formula" label="Formula">
            {mass.formulaUnicode === "" ? "—" : mass.formulaUnicode}
          </Row>
          <Row name="weight" label="MW">
            {mass.molecularWeight === undefined ? (
              <Unavailable reason="No verified mass for one of these isotope labels." />
            ) : (
              formatMass(mass.molecularWeight)
            )}
          </Row>
          <Row name="exact-mass" label="Exact mass">
            {/* chem-core's exactMass() throws rather than guess; this is that
                refusal, stated, with the element it is missing. */}
            {gap === undefined && mass.exactMass !== undefined ? (
              formatMass(mass.exactMass)
            ) : (
              <Unavailable reason={gap ?? "No verified exact mass."} />
            )}
          </Row>
          <Row name="charge" label="Charge">
            {formatCharge(mass.netCharge)}
          </Row>
        </dl>
        <dl className="mt-1 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 border-t pt-1">
          {open ? <DescriptorRows molecule={scope.molecule} /> : null}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

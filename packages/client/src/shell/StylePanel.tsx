"use client";

/**
 * The figure-style panel (decisions 223 and 237): every number a house style
 * specifies, in the unit an author guide states it in, editable on the
 * document's current preset.
 *
 * WHAT IS EDITED IS WHAT IS EXPORTED. The panel writes the document through
 * `setStyleOverrides`; the canvas and every export resolve the same edits
 * through `presetStyleFor`, so there is no second copy of a value to drift
 * (decision 107). Each committed field is one undo step.
 *
 * A FIELD COMMITS ON ENTER OR BLUR, not per keystroke: "0.6" typed as "0",
 * "0.", "0.6" would otherwise push three undo entries and refuse the first.
 * A value outside the range is shown as an error and not written. Typing the
 * preset's own value back removes that field's edit, so "edited" always means
 * "differs from the preset".
 */

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import { SlidersHorizontalIcon } from "lucide-react";
import {
  NO_BACKGROUND,
  RENDER_STYLES,
  STYLE_PARAM_RANGES,
  styleParams,
} from "@starter/chem-render";
import type {
  ColorStyleParam,
  FigureStyleOverrides,
  FigureStyleParams,
  NumericStyleParam,
} from "@starter/chem-render";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { STYLE_PRESET_TITLES, renderStyleFor } from "@/canvas/scene-bridge";
import { commandById } from "@/editor/commands/registry";
import { cn } from "@/lib/utils";
import { editorStore, useEditorStore } from "@/state";

interface NumericField {
  readonly param: NumericStyleParam;
  readonly label: string;
  readonly unit: "mm" | "pt";
}

const BOND_FIELDS: readonly NumericField[] = [
  { param: "bondLengthMm", label: "Bond length", unit: "mm" },
  { param: "lineWidthPt", label: "Line width", unit: "pt" },
  { param: "bondSpacingPt", label: "Double/triple spacing", unit: "pt" },
  { param: "wedgeWidthPt", label: "Wedge width", unit: "pt" },
  { param: "hashSpacingPt", label: "Hash spacing", unit: "pt" },
];

const LABEL_FIELDS: readonly NumericField[] = [
  { param: "fontSizePt", label: "Label size", unit: "pt" },
  { param: "marginMm", label: "Figure margin", unit: "mm" },
];

const COLOR_FIELDS: readonly { readonly param: ColorStyleParam; readonly label: string }[] = [
  { param: "bondColor", label: "Bonds" },
  { param: "labelColor", label: "Labels" },
  { param: "background", label: "Background" },
];

/** Three decimals, trailing zeros dropped: 0.6, 5.08, 2.52, 10. */
export function formatStyleNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** Half the last shown digit: a value that displays as the preset's IS it. */
const SAME_AS_PRESET = 5e-4;

/**
 * The edit set after `param` is set to `value`: the key is dropped when the
 * value is the preset's, so a field typed back to its default is not an edit.
 */
export function overridesWith<K extends keyof FigureStyleParams>(
  current: FigureStyleOverrides,
  preset: FigureStyleParams,
  param: K,
  value: FigureStyleParams[K],
): FigureStyleOverrides {
  const next: Record<string, unknown> = { ...current };
  const presetValue = preset[param];
  const same =
    typeof value === "number" && typeof presetValue === "number"
      ? Math.abs(value - presetValue) < SAME_AS_PRESET
      : value === presetValue;
  if (same) delete next[param];
  else next[param] = value;
  return next as FigureStyleOverrides;
}

/** A typed number, or why it is refused. */
export function parseStyleNumber(
  param: NumericStyleParam,
  text: string,
): { readonly ok: true; readonly value: number } | { readonly ok: false; readonly message: string } {
  const range = STYLE_PARAM_RANGES[param];
  const value = Number(text.trim().replace(",", "."));
  if (text.trim() === "" || !Number.isFinite(value)) {
    return { ok: false, message: "Enter a number." };
  }
  if (value < range.min || value > range.max) {
    return { ok: false, message: `Between ${range.min} and ${range.max}.` };
  }
  return { ok: true, value };
}

function commit(next: FigureStyleOverrides): void {
  editorStore.getState().setStyleOverrides(next);
}

function NumberRow({
  field,
  value,
  edited,
  onCommit,
}: {
  readonly field: NumericField;
  readonly value: number;
  readonly edited: boolean;
  readonly onCommit: (value: number) => void;
}): ReactElement {
  const id = useId();
  const shown = formatStyleNumber(value);
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  // An undo, a reset or a preset switch changes the stored value under the
  // field; the draft follows it.
  useEffect(() => {
    setDraft(shown);
    setError(null);
  }, [shown]);

  const apply = (): void => {
    if (draft === shown) {
      setError(null);
      return;
    }
    const parsed = parseStyleNumber(field.param, draft);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setError(null);
    onCommit(parsed.value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") apply();
    if (event.key === "Escape" && draft !== shown) {
      // Revert the field, and keep the popover open for the next edit.
      event.stopPropagation();
      setDraft(shown);
      setError(null);
    }
  };

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-0.5">
      <label htmlFor={id} className="flex items-center gap-1 text-xs">
        {field.label}
        {edited && (
          <span className="bg-primary size-1.5 rounded-full" title="Edited" aria-label="edited" />
        )}
      </label>
      <div className="flex items-center gap-1">
        <input
          id={id}
          data-style-param={field.param}
          inputMode="decimal"
          value={draft}
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : `${id}-error`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={apply}
          onKeyDown={onKeyDown}
          className={cn(
            "h-7 w-16 rounded-md border bg-transparent px-1.5 text-right text-xs tabular-nums",
            "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
            error !== null && "border-destructive",
          )}
        />
        <span className="text-muted-foreground w-5 text-xs">{field.unit}</span>
      </div>
      {error !== null && (
        <p id={`${id}-error`} role="alert" className="text-destructive col-span-2 text-right text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

function ColorRow({
  param,
  label,
  value,
  edited,
  onCommit,
}: {
  readonly param: ColorStyleParam;
  readonly label: string;
  readonly value: string;
  readonly edited: boolean;
  readonly onCommit: (value: string) => void;
}): ReactElement {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const transparent = value === NO_BACKGROUND;
  // The NATIVE change event, which fires once when the picker is dismissed.
  // React's onChange is the input event and fires on every drag step, which
  // would push one undo entry per pixel of hue.
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  useEffect(() => {
    const input = ref.current;
    if (input === null) return;
    const listener = (): void => commitRef.current(input.value.toLowerCase());
    input.addEventListener("change", listener);
    return () => input.removeEventListener("change", listener);
  }, []);

  return (
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={id} className="flex items-center gap-1 text-xs">
        {label}
        {edited && (
          <span className="bg-primary size-1.5 rounded-full" title="Edited" aria-label="edited" />
        )}
      </label>
      <div className="flex items-center gap-2">
        {param === "background" && (
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              data-style-param="background-none"
              checked={transparent}
              onChange={(event) => onCommit(event.target.checked ? NO_BACKGROUND : "#ffffff")}
            />
            None
          </label>
        )}
        <input
          ref={ref}
          id={id}
          type="color"
          data-style-param={param}
          disabled={transparent}
          // Uncontrolled between commits, keyed on the stored value so an
          // undo or a reset repaints the swatch.
          key={value}
          defaultValue={transparent ? "#ffffff" : value}
          className="h-7 w-10 cursor-pointer rounded border bg-transparent p-0.5 disabled:opacity-40"
        />
      </div>
    </div>
  );
}

function StylePanelBody(): ReactElement {
  const doc = useEditorStore((state) => state.document);
  const presetId = doc.stylePreset;
  const preset = styleParams(RENDER_STYLES[presetId]);
  const current = styleParams(renderStyleFor(doc));
  const edits: FigureStyleOverrides = doc.styleOverrides?.[presetId] ?? {};
  const reset = commandById("view.style-reset");
  const isEdited = (param: keyof FigureStyleParams): boolean => edits[param] !== undefined;
  const set = <K extends keyof FigureStyleParams>(param: K, value: FigureStyleParams[K]): void =>
    commit(overridesWith(edits, preset, param, value));

  const numberRows = (fields: readonly NumericField[]): ReactElement[] =>
    fields.map((field) => (
      <NumberRow
        key={field.param}
        field={field}
        value={current[field.param]}
        edited={isEdited(field.param)}
        onCommit={(value) => set(field.param, value)}
      />
    ));

  return (
    <div data-shell="style-panel" className="flex w-64 flex-col gap-3 p-1">
      <div>
        <h2 className="text-sm font-medium">Figure style</h2>
        <p className="text-muted-foreground text-xs">
          Starts from the {STYLE_PRESET_TITLES[presetId]} preset. The canvas and every export use
          these values.
        </p>
      </div>

      <section aria-label="Bonds" className="flex flex-col gap-1.5">
        <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Bonds</h3>
        {numberRows(BOND_FIELDS)}
      </section>

      <section aria-label="Labels" className="flex flex-col gap-1.5">
        <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Labels and margin
        </h3>
        {numberRows(LABEL_FIELDS)}
        <p className="text-muted-foreground text-xs" data-style-param="font">
          Font: Arimo (metrics of Arial and Helvetica), regular. The only face whose widths the
          label layout can measure.
        </p>
      </section>

      <section aria-label="Colours" className="flex flex-col gap-1.5">
        <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Colours
        </h3>
        {COLOR_FIELDS.map(({ param, label }) => (
          <ColorRow
            key={param}
            param={param}
            label={label}
            value={current[param]}
            edited={isEdited(param)}
            onCommit={(value) => set(param, value)}
          />
        ))}
      </section>

      <button
        type="button"
        data-command={reset.id}
        disabled={!reset.enabled(editorStore.getState())}
        onClick={() => void reset.run(editorStore)}
        className={cn(
          "h-7 rounded-md border px-2 text-xs",
          "hover:bg-accent focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        Reset to {STYLE_PRESET_TITLES[presetId]}
      </button>
    </div>
  );
}

/** The top-bar button that opens the panel; a dot marks an edited preset. */
export function StylePanelButton(): ReactElement {
  const edited = useEditorStore(
    (state) => state.document.styleOverrides?.[state.document.stylePreset] !== undefined,
  );
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-shell="style-panel-button"
              data-style-edited={edited}
              aria-label="Figure style"
              className={cn(
                "relative flex size-8 items-center justify-center rounded-md",
                "hover:bg-accent focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
              )}
            >
              <SlidersHorizontalIcon className="size-4" />
              {edited && (
                <span
                  aria-hidden="true"
                  className="bg-primary absolute right-1 top-1 size-1.5 rounded-full"
                />
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {edited ? "Figure style (edited)" : "Figure style"}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end">
        <StylePanelBody />
      </PopoverContent>
    </Popover>
  );
}

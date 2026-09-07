"use client";

/**
 * The left tool rail: one button per `ToolDef`, plus the option popovers for
 * the three tools that carry settings.
 *
 * IT RENDERS `TOOLS` AND DISPATCHES `tool.<id>` COMMANDS. It holds no list of
 * its own — clicking a button and pressing its letter run the same
 * `Command.run`, which is what makes "no second list of actions exists" true
 * rather than merely intended.
 *
 * SUB-VARIANTS ARE OPTIONS, NOT TOOLS. A double bond is not a different tool
 * from a single bond; it is the bond tool with `bondOrder: 2`. Making each
 * variant its own `ToolId` would multiply the rail by fifteen, would put
 * fifteen branches in the reducer's `ctx.tool` switch, and would lose the
 * setting the moment the user picked the eraser — `ToolOptions` persists
 * across a tool change precisely so a chemist part-way through a wedge-heavy
 * steroid does not re-pick it after every erase.
 */

import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { RING_TEMPLATES } from "@starter/chem-core";
import type { BondStereo, ElementSymbol, RingTemplateName } from "@starter/chem-core";
import { COMMON_ORGANIC_ELEMENTS } from "@starter/chem-core";
import { BOND_ORDER_VALUES, BOND_STEREO_VALUES } from "@starter/shared";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  BenzeneIcon,
  CyclobutaneIcon,
  CycloheptaneIcon,
  CyclohexaneIcon,
  CyclopentaneIcon,
  CyclopropaneIcon,
  DoubleBondIcon,
  HashBondIcon,
  SingleBondIcon,
  TripleBondIcon,
  WaveBondIcon,
  WedgeBondIcon,
} from "@/chem-icons";
import type { ChemIconProps } from "@/chem-icons";
import { commandById, formatShortcut } from "@/editor/commands/registry";
import { TOOLS } from "@/editor/tools";
import type { ToolDef } from "@/editor/tools";
import { cn } from "@/lib/utils";
import { editorStore, useEditorStore } from "@/state";
import type { ToolId } from "@/state";

const RING_ICONS: Readonly<
  Record<RingTemplateName, (props: ChemIconProps) => ReactElement>
> = {
  cyclopropane: CyclopropaneIcon,
  cyclobutane: CyclobutaneIcon,
  cyclopentane: CyclopentaneIcon,
  cyclohexane: CyclohexaneIcon,
  cycloheptane: CycloheptaneIcon,
  benzene: BenzeneIcon,
};

const ORDER_ICONS = {
  1: SingleBondIcon,
  2: DoubleBondIcon,
  3: TripleBondIcon,
} as const;

const STEREO_ICONS: Readonly<
  Record<BondStereo, (props: ChemIconProps) => ReactElement>
> = {
  none: SingleBondIcon,
  wedge: WedgeBondIcon,
  hash: HashBondIcon,
  wavy: WaveBondIcon,
  either: WaveBondIcon,
};

const STEREO_LABELS: Readonly<Record<BondStereo, string>> = {
  none: "Plain",
  wedge: "Wedge (towards viewer)",
  hash: "Hash (away from viewer)",
  wavy: "Wavy (undefined)",
  either: "Either (crossed double)",
};

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
}

/**
 * A tool button.
 *
 * `glyph` OVERRIDES the registry's static icon for the three tools whose
 * options change what a click does. A ring button that always drew a plain
 * hexagon would say "ring" when the tool was actually set to place benzene,
 * and the chemist would find out by placing one; showing the armed template
 * makes the rail state legible without opening the popover.
 */
function ToolButton({
  tool,
  active,
  glyph,
}: {
  readonly tool: ToolDef;
  readonly active: boolean;
  readonly glyph?: ReactNode;
}): ReactElement {
  const command = commandById(`tool.${tool.id}`);
  const Icon = tool.Icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-tool={tool.id}
          // `aria-pressed` rather than a colour alone. The rail is a set of
          // toggles and which one is down is the single most important thing
          // it says; a screen reader gets that from the state, not from the
          // ring.
          aria-pressed={active}
          aria-keyshortcuts={tool.hotkey}
          onClick={() => {
            void command.run(editorStore);
          }}
          className={cn(
            "flex size-9 items-center justify-center rounded-md border border-transparent transition-colors",
            "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
            active
              ? "bg-primary text-primary-foreground"
              : "text-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          {glyph ?? <Icon className="size-5" />}
          <span className="sr-only">{tool.title}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        <span className="font-medium">{tool.title}</span>
        <span className="ml-2 font-mono uppercase opacity-70">
          {formatShortcut(tool.hotkey, isApplePlatform())}
        </span>
        <p className="text-muted-foreground mt-0.5 max-w-52">{tool.hint}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The little chevron that opens a tool's options.
 *
 * CONTROLLED, AND IT CLOSES WHEN AN OPTION IS PICKED. Left uncontrolled the
 * popover stays up after a choice, and the next click on the canvas is spent
 * dismissing it rather than drawing — which is one wasted click every time a
 * chemist changes ring size. Closing on the content's click rather than per
 * button keeps the option buttons from each having to know about the popover.
 */
function OptionsPopover({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex h-4 w-9 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2"
        >
          <ChevronDownIcon className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="right">
        <div onClick={() => setOpen(false)}>{children}</div>
      </PopoverContent>
    </Popover>
  );
}

function OptionButton({
  active,
  label,
  testId,
  onSelect,
  children,
}: {
  readonly active: boolean;
  readonly label: string;
  /**
   * A stable hook for the e2e specs, keyed on the OPTION rather than on the
   * visible text. The text is not usable as a selector here: the benzene row
   * carries an "arene" badge, so its accessible name is "benzene arene", and
   * a spec matching on the label would be one copy edit away from failing.
   */
  readonly testId?: string;
  readonly onSelect: () => void;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={label}
      {...(testId === undefined ? {} : { "data-option": testId })}
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2 rounded px-2 py-1 text-left text-xs",
        active
          ? "bg-primary text-primary-foreground"
          : "hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {children}
    </button>
  );
}

function BondOptions(): ReactElement {
  const order = useEditorStore((state) => state.toolOptions.bondOrder);
  const stereo = useEditorStore((state) => state.toolOptions.bondStereo);
  return (
    <div className="flex w-52 flex-col gap-2">
      <div>
        <p className="text-muted-foreground mb-1 text-xs font-medium">Order</p>
        <div className="flex flex-col">
          {BOND_ORDER_VALUES.map((value) => {
            const Icon = ORDER_ICONS[value];
            return (
              <OptionButton
                key={value}
                active={order === value}
                testId={`order-${String(value)}`}
                label={`Bond order ${String(value)}`}
                onSelect={() => {
                  void commandById(`bond.order.${value}`).run(editorStore);
                }}
              >
                <Icon className="size-4" />
                <span>
                  {value === 1 ? "Single" : value === 2 ? "Double" : "Triple"}
                </span>
                <span className="ml-auto font-mono opacity-60">{value}</span>
              </OptionButton>
            );
          })}
        </div>
      </div>
      <div>
        <p className="text-muted-foreground mb-1 text-xs font-medium">Stereo</p>
        <div className="flex flex-col">
          {BOND_STEREO_VALUES.map((value) => {
            const Icon = STEREO_ICONS[value];
            return (
              <OptionButton
                key={value}
                active={stereo === value}
                testId={`stereo-${value}`}
                label={STEREO_LABELS[value]}
                onSelect={() => {
                  void commandById(`bond.stereo.${value}`).run(editorStore);
                }}
              >
                <Icon className="size-4" />
                <span>{STEREO_LABELS[value]}</span>
              </OptionButton>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * THE RING POPOVER IS WHAT CLOSES THE TEMPLATE GAP.
 *
 * `ToolOptions` used to carry `ringSize: number`, and a number cannot separate
 * cyclohexane from benzene — both are size 6. It now carries the template
 * NAME, which is what `RING_TEMPLATES` is keyed by, so both are here and both
 * are one click away.
 */
function RingOptions(): ReactElement {
  const current = useEditorStore((state) => state.toolOptions.ringTemplate);
  const names = Object.keys(RING_TEMPLATES) as RingTemplateName[];
  return (
    <div className="flex w-48 flex-col">
      {names.map((name) => {
        const Icon = RING_ICONS[name];
        return (
          <OptionButton
            key={name}
            active={current === name}
            testId={`ring-${name}`}
            label={name}
            onSelect={() => {
              void commandById(`ring.${name}`).run(editorStore);
            }}
          >
            <Icon className="size-4" />
            <span className="capitalize">{name}</span>
            {RING_TEMPLATES[name].kekule ? (
              <span className="text-muted-foreground ml-auto text-[10px] uppercase">
                arene
              </span>
            ) : null}
          </OptionButton>
        );
      })}
    </div>
  );
}

function ElementOptions(): ReactElement {
  const current = useEditorStore((state) => state.toolOptions.element);
  return (
    <div className="grid w-48 grid-cols-4 gap-1">
      {COMMON_ORGANIC_ELEMENTS.map((element: ElementSymbol) => (
        <button
          key={element}
          type="button"
          aria-pressed={current === element}
          data-element={element}
          onClick={() => {
            void commandById(`element.${element}`).run(editorStore);
          }}
          className={cn(
            "rounded px-2 py-1 font-mono text-xs",
            current === element
              ? "bg-primary text-primary-foreground"
              : "hover:bg-accent hover:text-accent-foreground",
          )}
        >
          {element}
        </button>
      ))}
    </div>
  );
}

function ChainOptions(): ReactElement {
  const length = useEditorStore((state) => state.toolOptions.chainLength);
  return (
    <div className="flex w-44 flex-col gap-1">
      <p className="text-muted-foreground text-xs font-medium">Chain length</p>
      <div className="flex flex-wrap gap-1">
        {[2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
          <OptionButton
            key={n}
            active={length === n}
            testId={`chain-${String(n)}`}
            label={`${String(n)} atoms`}
            onSelect={() => {
              editorStore.getState().setToolOption("chainLength", n);
            }}
          >
            <span className="font-mono">{n}</span>
          </OptionButton>
        ))}
      </div>
    </div>
  );
}

const OPTIONS_BY_TOOL: Partial<Record<ToolId, () => ReactElement>> = {
  bond: BondOptions,
  ring: RingOptions,
  element: ElementOptions,
  chain: ChainOptions,
};

/**
 * The glyph a tool's CURRENT options call for, or undefined to use the
 * registry's static one.
 *
 * A hook rather than a lookup because it subscribes: the rail has to redraw
 * when the armed template or bond order changes, and only these three
 * buttons care.
 */
function useToolGlyph(id: ToolId): ReactNode {
  const ringTemplate = useEditorStore((state) => state.toolOptions.ringTemplate);
  const bondOrder = useEditorStore((state) => state.toolOptions.bondOrder);
  const bondStereo = useEditorStore((state) => state.toolOptions.bondStereo);
  const element = useEditorStore((state) => state.toolOptions.element);

  if (id === "ring") {
    const Icon = RING_ICONS[ringTemplate];
    return <Icon className="size-5" />;
  }
  if (id === "bond") {
    // Stereo wins over order in the glyph: a wedge is what the eye reads
    // first, and a "double wedge" is not a thing the rail can draw anyway.
    const Icon =
      bondStereo === "none" ? ORDER_ICONS[bondOrder] : STEREO_ICONS[bondStereo];
    return <Icon className="size-5" />;
  }
  if (id === "element") {
    // The symbol itself, because no glyph says "nitrogen" better than "N".
    return (
      <span className="font-mono text-sm font-semibold leading-none">
        {element}
      </span>
    );
  }
  return undefined;
}

function RailTool({
  tool,
  active,
}: {
  readonly tool: ToolDef;
  readonly active: boolean;
}): ReactElement {
  const glyph = useToolGlyph(tool.id);
  const Options = OPTIONS_BY_TOOL[tool.id];
  return (
    <div className="flex flex-col items-center">
      <ToolButton tool={tool} active={active} glyph={glyph} />
      {Options === undefined ? null : (
        <OptionsPopover label={`${tool.title} options`}>
          <Options />
        </OptionsPopover>
      )}
    </div>
  );
}

export function ToolRail(): ReactElement {
  const active = useEditorStore((state) => state.tool);
  return (
    <nav
      aria-label="Tools"
      data-shell="tool-rail"
      className="bg-background flex w-14 shrink-0 flex-col items-center gap-1 border-r py-2"
    >
      {TOOLS.map((tool) => (
        <RailTool key={tool.id} tool={tool} active={active === tool.id} />
      ))}
    </nav>
  );
}

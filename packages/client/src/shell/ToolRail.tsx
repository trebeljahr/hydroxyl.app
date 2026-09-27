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
import { RING_TEMPLATES, elementBySymbol } from "@starter/chem-core";
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
import {
  CHAIN_LENGTHS,
  commandById,
  formatShortcut,
} from "@/editor/commands/registry";
import { TOOLS, toolDef } from "@/editor/tools";
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

/**
 * THE FOUR STATES A PICKER ENTRY CAN BE IN, EACH NAMING BOTH OF ITS COLOURS.
 *
 * WHY AN IDLE ENTRY STATES A GROUND AND AN INK IT APPEARS NOT TO NEED. It used
 * to state neither: the inactive branch was `hover:bg-accent
 * hover:text-accent-foreground` and nothing else, so an idle entry had no
 * background of its own and was legible only by INHERITING
 * `text-popover-foreground` from `PopoverContent`. The selected entry was the
 * one entry that named both a background and a foreground. So any hiccup in the
 * cascade — a stylesheet applied half-way, a token that failed to resolve, a
 * stale chunk served after a deploy — erased every entry EXCEPT the selected
 * one, which is exactly the "the pickers are weirdly transparent and the chain
 * numbers do not show" report this function answers. An entry that names its own
 * ground can lose only the token it names; it cannot take its siblings with it.
 *
 * NO STATE IS THE ABSENCE OF A CLASS. `bg-popover` on an entry inside a popover
 * paints the colour the entry would have inherited anyway, and that is the
 * point: the declaration IS the repair.
 *
 * DISABLED WINS OVER SELECTED. An armed option that has become unavailable has
 * to read as unavailable; painting it `bg-primary` would invite a click that
 * does nothing.
 */
const PICKER_ENTRY_BASE = cn(
  "rounded transition-colors",
  // The element grid had no focus ring at all, so a keyboard user could not see
  // where they stood among thirteen identical cells.
  "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
);

function pickerEntryClasses({
  active,
  disabled,
}: {
  readonly active: boolean;
  readonly disabled: boolean;
}): string {
  if (disabled) {
    // Deliberately no hover pair: an entry that lights up under the cursor and
    // then refuses the click is worse than one that never lights up.
    return cn(
      PICKER_ENTRY_BASE,
      "bg-muted text-muted-foreground cursor-not-allowed",
    );
  }
  if (active) {
    return cn(PICKER_ENTRY_BASE, "bg-primary text-primary-foreground");
  }
  return cn(
    PICKER_ENTRY_BASE,
    "bg-popover text-popover-foreground hover:bg-accent hover:text-accent-foreground",
  );
}

/**
 * Whether an option's COMMAND will accept the click, asked of the registry the
 * way the palette asks it — the same idiom as `flagAvailability` in
 * `RepresentationSwitcher`.
 *
 * EVERY OPTION COMMAND IS `enabled: always` TODAY, so this greys nothing out in
 * the shipped rail. The branch exists so that the first option command with a
 * real precondition greys its own entry out rather than offering a click that
 * silently does nothing, and it is wired here rather than left for later so the
 * disabled state cannot be invented twice. `OptionButton` is exported so the
 * component test can drive that branch directly — while the registry says yes
 * to everything, that is the only way to reach it.
 */
function optionDisabled(commandId: string): boolean {
  return !commandById(commandId).enabled(editorStore.getState());
}

export function OptionButton({
  active,
  label,
  testId,
  elementSymbol,
  disabled = false,
  className,
  onSelect,
  children,
}: {
  readonly active: boolean;
  /**
   * Tooltip AND accessible name. Named explicitly rather than left to the
   * entry's own text: the element grid's text is a bare symbol, which says
   * "C" where a screen reader should say "Carbon".
   */
  readonly label: string;
  /**
   * A stable hook for the e2e specs, keyed on the OPTION rather than on the
   * visible text. The text is not usable as a selector here: the benzene row
   * carries an "arene" badge, so its accessible name is "benzene arene", and
   * a spec matching on the label would be one copy edit away from failing.
   */
  readonly testId?: string;
  /** The element grid's own hook, so a symbol stays findable by symbol. */
  readonly elementSymbol?: string;
  readonly disabled?: boolean;
  /**
   * LAYOUT ONLY. The state colours above are not overridable per call site,
   * which is what keeps the four states identical across four popovers.
   */
  readonly className?: string;
  readonly onSelect: () => void;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      disabled={disabled}
      {...(testId === undefined ? {} : { "data-option": testId })}
      {...(elementSymbol === undefined ? {} : { "data-element": elementSymbol })}
      onClick={() => {
        // `disabled` alone is not a guarantee — a synthetic or scripted click
        // still reaches React's onClick — and the store must not learn about a
        // choice the entry is refusing. Same reasoning as the view-flag
        // checkboxes in `RepresentationSwitcher`.
        if (disabled) return;
        onSelect();
      }}
      className={cn(
        "flex items-center gap-2 px-2 py-1 text-left text-xs",
        pickerEntryClasses({ active, disabled }),
        className,
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
                disabled={optionDisabled(`bond.order.${value}`)}
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
                disabled={optionDisabled(`bond.stereo.${value}`)}
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
            disabled={optionDisabled(`ring.${name}`)}
            testId={`ring-${name}`}
            label={name}
            onSelect={() => {
              void commandById(`ring.${name}`).run(editorStore);
            }}
          >
            <Icon className="size-4" />
            <span className="capitalize">{name}</span>
            {RING_TEMPLATES[name].kekule ? (
              // `text-current` and not `text-muted-foreground`: the badge sits
              // INSIDE an entry that already states its own ink, and a fixed
              // grey on a `bg-primary` row was the one part of the selected
              // entry that did not follow it.
              <span className="ml-auto text-[10px] uppercase text-current opacity-70">
                arene
              </span>
            ) : null}
          </OptionButton>
        );
      })}
    </div>
  );
}

/**
 * The element grid, now an `OptionButton` grid.
 *
 * IT USED TO BE ITS OWN BUTTON, and paid for it three times over: thirteen
 * buttons with no `title` and no `aria-label` (a screen reader read "C", "O",
 * "N" and nothing else), no focus ring, and an inactive branch that declared no
 * colour — the same fragility the popovers had. Sharing `OptionButton` is what
 * makes "every picker entry has the same four states" a property of the code
 * rather than a claim in a comment.
 */
function ElementOptions(): ReactElement {
  const current = useEditorStore((state) => state.toolOptions.element);
  return (
    <div className="grid w-48 grid-cols-4 gap-1">
      {COMMON_ORGANIC_ELEMENTS.map((element: ElementSymbol) => (
        <OptionButton
          key={element}
          active={current === element}
          disabled={optionDisabled(`element.${element}`)}
          elementSymbol={element}
          testId={`element-${element}`}
          // "Carbon (C)", not "C". The symbol stays on screen; the name is for
          // the tooltip and for anything reading the accessible name.
          label={`${elementBySymbol(element)?.name ?? element} (${element})`}
          onSelect={() => {
            void commandById(`element.${element}`).run(editorStore);
          }}
          className="justify-center gap-0 text-center font-mono"
        >
          {element}
        </OptionButton>
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
        {CHAIN_LENGTHS.map((n) => (
          <OptionButton
            key={n}
            active={length === n}
            disabled={optionDisabled(`chain.length.${String(n)}`)}
            testId={`chain-${String(n)}`}
            label={`${String(n)} atoms`}
            className="justify-center gap-0"
            onSelect={() => {
              // Through the registry, like every other option popover on this
              // rail — chain length was the last one setting a tool option
              // directly, and so the last one absent from the palette.
              void commandById(`chain.length.${String(n)}`).run(editorStore);
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
  const chainLength = useEditorStore((state) => state.toolOptions.chainLength);

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
  if (id === "chain") {
    // THE CHAIN TOOL WAS THE ONE OPTION-CARRYING TOOL WHOSE BUTTON DID NOT SAY
    // WHAT IT WAS ARMED WITH: a chemist who had picked 12 saw the same zig-zag
    // as one who had picked 2, and found out by clicking. The icon STAYS —
    // unlike an element symbol, a bare "12" beside a hexagon would read as a
    // ring size — and the armed length rides in the corner. `toolDef` rather
    // than a second reference to `CarbonChainIcon`, so the rail keeps drawing
    // whatever the registry says the chain tool looks like.
    const Icon = toolDef(id).Icon;
    return (
      <span className="relative flex size-5 items-center justify-center">
        <Icon className="size-5" />
        <span
          data-rail-badge="chain"
          // No colour of its own: it sits inside a button that states both of
          // its colours in both states, so it follows the pressed button's ink
          // instead of holding a grey that disappears on `bg-primary`.
          className="absolute -bottom-1.5 -right-1.5 font-mono text-[9px] font-semibold leading-none"
        >
          {chainLength}
        </span>
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

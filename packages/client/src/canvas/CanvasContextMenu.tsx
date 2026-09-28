"use client";

/**
 * The canvas's context menu: what a right-click, a long-press or the
 * context-menu key opens instead of the browser's own menu.
 *
 * THIS FILE DRAWS; `editor/context-menu.ts` DECIDES. Which entries a target
 * gets, which are enabled, why the others are not, what is checked and what
 * running one does — all of it is the pure model, built from the registry and
 * tested without a DOM. Nothing in here knows a chemistry fact.
 *
 * ── WHY A DROPDOWN MENU OPENED BY THE CANVAS, NOT RADIX'S CONTEXT MENU ─────
 *
 * Radix's ContextMenu can only be opened by its own trigger: its Root has no
 * `open` prop, so the one way in is the trigger's `contextmenu` listener and
 * its built-in long-press. That long-press waits 700 ms and cancels on ANY
 * pointermove, which under the canvas's `touch-action: none` is every pixel
 * of finger tremor; it opens on top of a press the canvas has already started,
 * so the finger's release would still click the atom underneath; and nothing
 * lets the keyboard open it on the atom the arrow keys are focused on. The
 * gesture hook owns all three instead — see `onContextMenu` there — and this
 * menu is a controlled DropdownMenu anchored on the point it is handed.
 *
 * ── UNAVAILABLE ENTRIES FOLLOW THE PICKER-STATE CONVENTION ─────────────────
 *
 * Shown greyed with the reason beside them, never hidden — a missing entry
 * reads as a missing feature (the palette's rule). Every state names its own
 * ground and ink, resting AND highlighted, because a state defined by the
 * absence of a class is whatever the cascade does. The unavailable row holds
 * `bg-popover` / `text-muted-foreground` through hover and highlight: the
 * same ink on `bg-accent` is 4.349:1 in light mode, under the 4.5:1 floor.
 * It stays FOCUSABLE rather than `disabled`, as the WAI-ARIA menu pattern
 * asks, so a keyboard or screen-reader user can land on it and hear why; its
 * selection is swallowed, and the entry's own `run` re-asks the registry
 * before acting in any case.
 */

import { useEffect, useMemo } from "react";
import type { ReactElement, ReactNode } from "react";

import type { Vec2 } from "@starter/chem-core";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatShortcut } from "@/editor/commands/registry";
import { buildContextMenu } from "@/editor/context-menu";
import type { ContextTarget, MenuEntry, MenuItem } from "@/editor/context-menu";
import { cn } from "@/lib/utils";
import { editorStore, useEditorStore } from "@/state";

export interface ContextMenuRequest {
  readonly target: ContextTarget;
  /** Canvas-local px: where the menu's top-left corner goes. */
  readonly anchor: Vec2;
}

export interface CanvasContextMenuProps {
  /** `null` while closed. */
  readonly request: ContextMenuRequest | null;
  readonly onClose: () => void;
  /**
   * Where focus goes when the menu closes. Radix would return it to the
   * invisible anchor, which is a dead end for the keyboard; the canvas is
   * where the arrow keys and every shortcut live.
   */
  readonly returnFocus: () => void;
}

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
}

/**
 * Both branches name a ground, an ink, a hover pair and a highlighted pair.
 * Radix highlights on pointer-move as well as on the arrow keys, so the
 * highlighted pair IS the hover state for the pointer; the `hover:` pair is
 * stated too so the row does not fall back on the cascade for the frame
 * before Radix sets `data-highlighted`.
 */
export function menuEntryClasses(enabled: boolean): string {
  return enabled
    ? "bg-popover text-popover-foreground hover:bg-accent hover:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
    : // A ring, not a ground change, marks where keyboard focus stands on an
      // unavailable row: the ground cannot move without dropping the ink under
      // the floor, and focus still has to be visible.
      "bg-popover text-muted-foreground hover:bg-popover hover:text-muted-foreground data-[highlighted]:bg-popover data-[highlighted]:text-muted-foreground data-[highlighted]:ring-1 data-[highlighted]:ring-inset data-[highlighted]:ring-ring cursor-not-allowed";
}

function EntryBody({ item, apple }: { readonly item: MenuItem; readonly apple: boolean }): ReactElement {
  const keys =
    item.keys ?? (item.shortcut === undefined ? undefined : formatShortcut(item.shortcut, apple));
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex items-baseline gap-4">
        <span className={cn("truncate", item.enabled ? undefined : "line-through")}>{item.label}</span>
        {keys === undefined ? null : (
          // The row's own ink, not a muted one: muted on the highlighted
          // ground is the 4.349:1 pair.
          <kbd data-shortcut className="ml-auto font-sans text-xs tracking-wide">
            {keys}
          </kbd>
        )}
      </span>
      {item.reason === undefined ? null : (
        <span data-disabled-reason className="text-[11px] leading-tight whitespace-normal">
          {item.reason}
        </span>
      )}
    </span>
  );
}

function Entry({ item, apple }: { readonly item: MenuItem; readonly apple: boolean }): ReactElement {
  const common = {
    "data-menu-entry": item.id,
    ...(item.enabled ? {} : { "data-unavailable": "", "aria-disabled": true as const }),
    ...(item.reason === undefined ? {} : { title: item.reason }),
    className: menuEntryClasses(item.enabled),
    onSelect: (event: Event) => {
      if (!item.enabled) {
        // Kept open and inert: the reason is on the row, and closing the menu
        // on a refusal would take it away before it could be read.
        event.preventDefault();
        return;
      }
      item.run(editorStore);
    },
  };
  if (item.role !== undefined) {
    return (
      <DropdownMenuCheckboxItem
        {...common}
        role={item.role === "radio" ? "menuitemradio" : "menuitemcheckbox"}
        checked={item.checked === true}
      >
        <EntryBody item={item} apple={apple} />
      </DropdownMenuCheckboxItem>
    );
  }
  return (
    <DropdownMenuItem {...common}>
      <EntryBody item={item} apple={apple} />
    </DropdownMenuItem>
  );
}

function Entries({
  entries,
  apple,
}: {
  readonly entries: readonly MenuEntry[];
  readonly apple: boolean;
}): ReactNode {
  return entries.map((entry, index) => {
    switch (entry.kind) {
      case "item":
        return <Entry key={entry.id} item={entry} apple={apple} />;
      case "separator":
        return <DropdownMenuSeparator key={`separator-${String(index)}`} />;
      case "heading":
        return <DropdownMenuLabel key={`heading-${entry.label}`}>{entry.label}</DropdownMenuLabel>;
      case "submenu":
        return (
          <DropdownMenuSub key={entry.id}>
            <DropdownMenuSubTrigger
              data-menu-submenu={entry.id}
              // Lit while its submenu is open, not only while highlighted:
              // focus moves INTO the submenu, and the trigger would otherwise
              // drop back to the resting pair and stop saying which row the
              // open submenu belongs to.
              className={cn(
                menuEntryClasses(true),
                "data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
              )}
            >
              {entry.label}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent data-menu-submenu-content={entry.id}>
              <Entries entries={entry.entries} apple={apple} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        );
    }
  });
}

/**
 * The open menu. Split from the shell for the palette's reason: the model is
 * judged against the WHOLE state, and a whole-store subscription re-renders on
 * every pointer-move frame of a drag — so it exists only while the menu does.
 */
function MenuBody({ target }: { readonly target: ContextTarget }): ReactElement {
  const state = useEditorStore((s) => s);
  const model = useMemo(() => buildContextMenu(target, state), [target, state]);
  const apple = isApplePlatform();
  return (
    <>
      <DropdownMenuLabel data-context-menu-title className="text-popover-foreground">
        {model.title}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <Entries entries={model.entries} apple={apple} />
    </>
  );
}

export function CanvasContextMenu(props: CanvasContextMenuProps): ReactElement {
  const { request, onClose, returnFocus } = props;

  // WHILE THE MENU IS OPEN, NO RIGHT-CLICK ANYWHERE OPENS THE BROWSER'S MENU.
  // The menu is modal, so Radix sets `pointer-events: none` on the body and a
  // second right-click lands on <html>, past the canvas's own handler — the
  // browser's menu would open on top of ours. Swallowed at the capture phase
  // instead; the press that came with it has already dismissed our menu, so
  // the second right-click reads as "close", as it does in a native menu.
  const open = request !== null;
  useEffect(() => {
    if (!open) return;
    const swallow = (event: MouseEvent): void => {
      event.preventDefault();
    };
    document.addEventListener("contextmenu", swallow, { capture: true });
    return () => {
      document.removeEventListener("contextmenu", swallow, { capture: true });
    };
  }, [open]);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DropdownMenuTrigger asChild>
        {/* The anchor. Zero-size and inert: it exists so the popper has a
            rectangle to place the menu against, at the point the request
            names, and it is never a thing anyone clicks or tabs to. */}
        <span
          aria-hidden
          tabIndex={-1}
          data-context-menu-anchor
          className="pointer-events-none absolute size-0"
          style={{ left: request?.anchor.x ?? 0, top: request?.anchor.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      {request === null ? null : (
        <DropdownMenuContent
          data-context-menu={request.target.kind}
          align="start"
          side="bottom"
          collisionPadding={8}
          aria-label="Canvas context menu"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // Only when nothing else claimed focus meanwhile. Radix runs this
            // a task after the menu unmounts, and an entry that opens a dialog
            // — the periodic table, the palette — has put focus inside it by
            // then; pulling it back to the canvas would strand the dialog.
            const active = document.activeElement;
            if (active === null || active === document.body) returnFocus();
          }}
        >
          <MenuBody target={request.target} />
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}

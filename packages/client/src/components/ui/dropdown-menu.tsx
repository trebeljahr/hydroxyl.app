"use client";

/**
 * Radix DropdownMenu, in the shadcn shape. See tooltip.tsx for why these are
 * hand-written rather than generated.
 *
 * STRUCTURE ONLY. The entries' colours are decided by the one component that
 * renders them (`CanvasContextMenu`), for the reason ToolRail keeps its picker
 * entry classes beside the picker: every state has to name its own ground and
 * ink, and which states exist is the caller's knowledge, not the primitive's.
 * The content panel names its own pair here because it is the same for every
 * caller.
 *
 * DropdownMenu and not ContextMenu, although the canvas uses it as one: see
 * `CanvasContextMenu` for why the menu has to be opened by the canvas rather
 * than by Radix's own right-click trigger.
 */

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { CheckIcon, ChevronRightIcon, DotIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;

/**
 * Capped in width so an entry's reason WRAPS under it instead of widening the
 * panel: an unwrapped sentence pushed a submenu off the left edge of the
 * window, since the popper then had no side it fitted on.
 */
const CONTENT =
  "bg-popover text-popover-foreground z-50 min-w-[12rem] max-w-[min(20rem,calc(100vw-1rem))] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-md border p-1 shadow-md outline-none";

export function DropdownMenuContent({
  className,
  sideOffset = 2,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(CONTENT, className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent className={cn(CONTENT, className)} {...props} />
    </DropdownMenuPrimitive.Portal>
  );
}

const ENTRY = "relative flex w-full cursor-default select-none items-start gap-2 rounded-sm py-1.5 pr-2 pl-7 text-sm outline-none";

export function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return <DropdownMenuPrimitive.Item className={cn(ENTRY, className)} {...props} />;
}

/**
 * A checkbox entry, or a radio one with `role="menuitemradio"`. Radix's own
 * RadioItem needs every radio entry inside a RadioGroup with one controlled
 * value, and the menus here mark the CURRENT state of a selection that may
 * hold several values at once (two bonds, one single and one double), where
 * the honest answer is that no entry is checked.
 */
export function DropdownMenuCheckboxItem({
  className,
  children,
  role,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(ENTRY, className)}
      // Only when given: Radix spreads props over its own
      // `role="menuitemcheckbox"`, so an explicit `undefined` would erase it.
      {...(role === undefined ? {} : { role })}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center pt-0.5">
        <DropdownMenuPrimitive.ItemIndicator>
          {role === "menuitemradio" ? (
            <DotIcon className="size-4" aria-hidden />
          ) : (
            <CheckIcon className="size-3.5" aria-hidden />
          )}
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
  return (
    <DropdownMenuPrimitive.SubTrigger className={cn(ENTRY, "items-center", className)} {...props}>
      {children}
      <ChevronRightIcon className="ml-auto size-4" aria-hidden />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn("bg-popover text-muted-foreground px-2 py-1.5 text-xs font-medium", className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("bg-border -mx-1 my-1 h-px", className)}
      {...props}
    />
  );
}

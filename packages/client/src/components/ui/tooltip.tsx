"use client";

/**
 * Radix Tooltip, in the shadcn shape.
 *
 * WRITTEN BY HAND RATHER THAN BY `shadcn add`. The CLI's first act is to
 * rewrite `src/styles/globals.css`, which here is a hand-written HSL-triple +
 * `@theme inline` file the whole app resolves its colours through. These files
 * are the CLI's output, reviewed, with the parts that assume a generated
 * stylesheet removed.
 *
 * `TooltipProvider` is mounted once in the editor shell rather than per
 * tooltip: the provider owns the shared open/close delay, and a per-trigger
 * provider makes every tooltip in a rail wait the full delay again as the
 * pointer sweeps across it.
 */

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "bg-popover text-popover-foreground z-50 overflow-hidden rounded-md border px-2 py-1 text-xs shadow-md",
          "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

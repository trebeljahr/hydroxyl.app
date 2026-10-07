"use client";

/**
 * The top bar: the document's name, the handful of commands worth a permanent
 * button, the style preset, and the theme switch.
 *
 * EVERY BUTTON HERE IS A REGISTRY ENTRY. Undo, redo, Clean up structure and
 * the theme switch are `commandById(...)`, so their disabled state is the same
 * `enabled(state)` the palette greys on and their behaviour is the same `run`
 * the shortcut fires. The theme switch still READS the theme through
 * `useTheme` — it has to know which glyph to draw — but it no longer WRITES
 * it, which is what kept it out of the palette.
 * The title field is the one control that is not — a text input is not a
 * command — and it is also the reason the keyboard layer's text-entry guard
 * exists: typing "Benzene-1,2-diol" into it must not switch tools eight times.
 *
 * "Sketches", at the far left, is a LINK whose click runs a command. A link
 * so that it can be opened in a new tab and so that its href is right in the
 * prerendered HTML; a command so that a plain click saves before it leaves,
 * exactly as the palette's "Back to my sketches" does.
 */

import type { MouseEvent, ReactElement } from "react";
import {
  ChevronLeftIcon,
  CommandIcon,
  FlaskConicalIcon,
  ImageDownIcon,
  MoonIcon,
  Redo2Icon,
  SparklesIcon,
  SunIcon,
  Undo2Icon,
} from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  STYLE_PRESETS,
  STYLE_PRESET_IN_SENTENCE,
  STYLE_PRESET_TITLES,
} from "@/canvas/scene-bridge";
import { commandById, formatShortcut } from "@/editor/commands/registry";
import { recentsHref } from "@/lib/deployment";
import { cn } from "@/lib/utils";
import { editorStore, useEditorStore } from "@/state";

import { useTheme } from "./theme";

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
}

function CommandButton({
  id,
  label,
  children,
}: {
  readonly id: string;
  readonly label?: string;
  readonly children: ReactElement;
}): ReactElement {
  const command = commandById(id);
  // Subscribed through a selector that returns a boolean, so the button
  // re-renders when its availability changes and not on every pointer frame.
  const enabled = useEditorStore((state) => command.enabled(state));
  const title = label ?? command.title;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-command={id}
          disabled={!enabled}
          onClick={() => {
            void command.run(editorStore);
          }}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-md px-2 text-xs",
            "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
            enabled
              ? "hover:bg-accent hover:text-accent-foreground"
              : "cursor-not-allowed opacity-40",
          )}
        >
          {children}
          <span className="sr-only">{title}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <span className="font-medium">{title}</span>
        {command.shortcut === undefined ? null : (
          <span className="ml-2 font-mono opacity-70">
            {formatShortcut(command.shortcut, isApplePlatform())}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Screen / Publication / Nature: the document's style preset, which the canvas draws
 * with, and every export writes when its style choice is "As shown on the canvas"
 * (decisions 21, 50 and 234; exports default to Publication). One registry command per preset, so the
 * palette offers the same switch and a click is the same undoable
 * `setStylePreset` the command runs. The active preset is `aria-pressed`
 * rather than disabled, so it stays focusable and announced.
 */
function StylePresetSwitch(): ReactElement {
  const preset = useEditorStore((state) => state.document.stylePreset);
  return (
    <div
      role="group"
      aria-label="Style preset"
      data-shell="style-preset"
      data-style-preset={preset}
      className="flex items-center rounded-md border p-0.5"
    >
      {STYLE_PRESETS.map((id) => {
        const command = commandById(`view.style-${id}`);
        const active = preset === id;
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-command={command.id}
                aria-pressed={active}
                onClick={() => {
                  if (!active) void command.run(editorStore);
                }}
                className={cn(
                  "flex h-7 items-center rounded px-2 text-xs",
                  "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
                  active ? "bg-accent text-accent-foreground font-medium" : "hover:bg-accent",
                )}
              >
                {STYLE_PRESET_TITLES[id]}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {active
                ? `The canvas and exports use the ${STYLE_PRESET_IN_SENTENCE[id]} style`
                : command.title}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

/**
 * The way out of the editor, to the recents grid.
 *
 * `recentsHref()`, never a literal "/": the static export can be opened from a
 * subdirectory or as a document-relative `index.html` inside an app shell,
 * where "/" names the wrong file entirely. And a plain `<a>`, not `next/link`,
 * for the reason `lib/deployment.ts` measured: a client-side navigation in the
 * export leaves the relative asset prefix pointing into a directory with no
 * assets in it.
 *
 * A PLAIN CLICK IS TAKEN OVER, a modified one is not. The plain click waits
 * for the open sketch to reach storage before it navigates — see
 * `leaveToRecents`. A Cmd/Ctrl/Shift/middle click opens the grid in another
 * tab or window, this editor stays open and goes on autosaving, and there is
 * nothing to wait for.
 */
function RecentsLink(): ReactElement {
  const command = commandById("file.recents");
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    void command.run(editorStore);
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={recentsHref()}
          data-shell="recents-link"
          data-command={command.id}
          onClick={onClick}
          className={cn(
            "flex h-8 items-center gap-0.5 rounded-md pl-1 pr-2 text-xs",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
          )}
        >
          <ChevronLeftIcon className="size-4" aria-hidden="true" />
          <span aria-hidden="true">Sketches</span>
          <span className="sr-only">{command.title}</span>
        </a>
      </TooltipTrigger>
      <TooltipContent side="bottom">{command.title}</TooltipContent>
    </Tooltip>
  );
}

export function TopBar(): ReactElement {
  const title = useEditorStore((state) => state.document.metadata.title);
  // Rendered as an attribute rather than as text: the e2e specs need to know
  // which document is loaded in order to reopen it at `/editor?doc=<id>`, and
  // a raw id is not something to put in front of a chemist.
  const docId = useEditorStore((state) => state.document.id);
  const { theme } = useTheme();

  return (
    <header
      data-shell="top-bar"
      data-doc-id={docId}
      className="bg-background flex h-11 shrink-0 items-center gap-2 border-b px-3"
    >
      <RecentsLink />
      <div className="bg-border h-5 w-px" aria-hidden="true" />

      <input
        aria-label="Document title"
        data-shell="document-title"
        value={title}
        onChange={(event) =>
          editorStore.getState().setDocumentTitle(event.target.value)
        }
        className="focus:ring-ring h-8 w-64 rounded-md border border-transparent bg-transparent px-2 text-sm font-medium focus:outline-none focus:ring-2"
      />

      <div className="ml-2 flex items-center gap-0.5">
        <CommandButton id="edit.undo">
          <Undo2Icon className="size-4" />
        </CommandButton>
        <CommandButton id="edit.redo">
          <Redo2Icon className="size-4" />
        </CommandButton>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <StylePresetSwitch />
        <CommandButton id="structure.insert" label="Insert a structure">
          <>
            <FlaskConicalIcon className="size-4" />
            <span aria-hidden="true">Insert</span>
          </>
        </CommandButton>
        <CommandButton id="structure.clean-up">
          <>
            <SparklesIcon className="size-4" />
            <span aria-hidden="true">Clean up</span>
          </>
        </CommandButton>
        <CommandButton id="figure.export-dialog">
          <>
            <ImageDownIcon className="size-4" />
            <span aria-hidden="true">Export</span>
          </>
        </CommandButton>
        <CommandButton id="view.command-palette">
          <>
            <CommandIcon className="size-4" />
            <span aria-hidden="true">Commands</span>
          </>
        </CommandButton>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-shell="theme-toggle"
              data-command="view.theme"
              aria-pressed={theme === "dark"}
              onClick={() => {
                // The registry entry, not the hook's callback directly: the
                // palette lists the same command, and one code path is the
                // point of the registry.
                void commandById("view.theme").run(editorStore);
              }}
              className="hover:bg-accent focus-visible:ring-ring flex size-8 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2"
            >
              {theme === "dark" ? (
                <SunIcon className="size-4" />
              ) : (
                <MoonIcon className="size-4" />
              )}
              <span className="sr-only">
                {theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}

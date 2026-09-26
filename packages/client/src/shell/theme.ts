"use client";

/**
 * Light/dark for the UI chrome — and ONLY for the chrome.
 *
 * There was no dark mode in this app at all: `globals.css` declared a `.dark`
 * token block and a `@custom-variant dark`, and nothing anywhere added the
 * class. Two acceptance criteria are about dark mode, so the mechanism is part
 * of the work rather than something to be assumed.
 *
 * IT IS DELIBERATELY THE SMALLEST MECHANISM THAT WORKS: a class on `<html>`
 * plus a `localStorage` key, and no provider. `next-themes` exists to solve
 * server-rendered flash-of-wrong-theme, and this route is a client component
 * in a statically exported app — there is no server render to mismatch. A
 * dependency for a class toggle would be a dependency for a class toggle.
 *
 * THE THEME LIVES OUTSIDE REACT, read through `useSyncExternalStore`. Two
 * reasons, and the second is the load-bearing one. The DOM class is the real
 * state — anything that wants to know the theme can read `<html>` — so React
 * is a subscriber rather than the owner. And the alternative shape, a
 * `useState` corrected in a mount effect, is a setState inside an effect: it
 * renders the wrong theme once and the right one a frame later, which is the
 * flash the whole design is trying to avoid.
 *
 * THE CANVAS IS NOT THEMED, and that is the point of the second criterion. A
 * figure's ground is white because that is what a journal prints on;
 * `EditorCanvas` paints `RenderStyle.colors.background` under the structure,
 * so the drawing stays a white publication ground while the chrome around it
 * goes dark. Anything else would mean the editor showed you something you
 * could not export.
 */

import { useEffect, useSyncExternalStore } from "react";

export type ThemeName = "light" | "dark";

const STORAGE_KEY = "chemistry-sketcher.theme";

let current: ThemeName = "light";
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ThemeName {
  return current;
}

/** Prerender and the first hydration pass agree on light; the mount effect
 *  below corrects it before paint if storage says otherwise. */
function getServerSnapshot(): ThemeName {
  return "light";
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function setTheme(theme: ThemeName): void {
  if (current === theme) return;
  current = theme;
  applyTheme(theme);
  for (const listener of listeners) listener();
}

function readStoredTheme(): ThemeName | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    // Private mode, or storage disabled. Not worth failing a render over.
    return null;
  }
}

/**
 * Flip the theme, outside React.
 *
 * A plain function and not only a hook callback, because the command registry
 * owns every action the shell exposes and a button that bypassed it would be
 * an action with no palette row and no `enabled` — which is exactly the seam
 * the "one registry" criterion is about. The hook hands this same function
 * back, so the top bar's switch and the palette entry are one code path.
 */
export function toggleTheme(): void {
  const next: ThemeName = current === "dark" ? "light" : "dark";
  setTheme(next);
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // The class is already applied; only the memory of it is lost.
  }
}

/** The current theme, and a way to flip it. */
export function useTheme(): {
  readonly theme: ThemeName;
  readonly toggleTheme: () => void;
} {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    // Resolving the preference is a read of two external systems — storage and
    // the media query — and pushing the answer into the external store is what
    // an effect is FOR. React finds out through its subscription.
    // OPTIONAL, because a missing `matchMedia` must not take the shell down.
    // jsdom has none, so mounting the editor in a unit test threw here before
    // it rendered a single element — which is why nothing mounted it. The
    // fallback is the same "light" the server snapshot reports, so a
    // environment without the query gets the theme the markup already has.
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    setTheme(readStoredTheme() ?? (prefersDark ? "dark" : "light"));
  }, []);

  return { theme, toggleTheme };
}

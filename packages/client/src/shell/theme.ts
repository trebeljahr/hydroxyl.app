"use client";

/**
 * Light/dark for the UI chrome — and ONLY for the chrome.
 *
 * There was no dark mode in this app at all: `globals.css` declared a `.dark`
 * token block and a `@custom-variant dark`, and nothing anywhere added the
 * class. Two acceptance criteria are about dark mode, so the mechanism is part
 * of the work rather than something to be assumed.
 *
 * IT IS DELIBERATELY THE SMALLEST MECHANISM THAT WORKS: a class on
 * `<html>` plus a `localStorage` key, and no provider. `next-themes` exists to
 * solve server-rendered flash-of-wrong-theme, and this route is a client
 * component in a statically exported app — there is no server render to
 * mismatch. A dependency for a class toggle would be a dependency for a class
 * toggle.
 *
 * THE CANVAS IS NOT THEMED, and that is the point of the second criterion. A
 * figure's ground is white because that is what a journal prints on;
 * `EditorCanvas` paints `RenderStyle.colors.background` under the structure,
 * so the drawing stays a white publication ground while the chrome around it
 * goes dark. Anything else would mean the editor showed you something you
 * could not export.
 */

import { useCallback, useEffect, useState } from "react";

export type ThemeName = "light" | "dark";

const STORAGE_KEY = "chemistry-sketcher.theme";

function readStoredTheme(): ThemeName | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    // Private mode, or storage disabled. Not worth failing a render over.
    return null;
  }
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/**
 * The current theme, and a way to flip it.
 *
 * Starts at "light" and corrects itself in an effect rather than reading
 * storage during render: the initial HTML is generated at build time by
 * `output: "export"`, and a render that consulted `window` would produce
 * markup the first client render disagreed with.
 */
export function useTheme(): {
  readonly theme: ThemeName;
  readonly toggleTheme: () => void;
} {
  const [theme, setTheme] = useState<ThemeName>("light");

  useEffect(() => {
    const stored = readStoredTheme();
    const initial: ThemeName =
      stored ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light");
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: ThemeName = current === "dark" ? "light" : "dark";
      applyTheme(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // The class is already applied; only the memory of it is lost.
      }
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}

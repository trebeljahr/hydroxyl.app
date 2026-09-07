/**
 * The chemistry glyphs, inline so they inherit `currentColor`.
 *
 * Only chemistry lives here. The generic UI marks the shell needs — a
 * pointer, a hand, an eraser, a chevron — come from `lucide-react`, which is
 * already a dependency and already draws them better than a salvaged file
 * would; there is no salvaged art for any of them anyway.
 *
 * DELIBERATELY NOT RE-EXPORTED: the `Glyph` wrapper. A caller reaching for it
 * is drawing a new chemistry icon, and that belongs in `glyphs.tsx` beside the
 * others rather than inline at a call site, where it would drift from the
 * family's stroke weight and viewBox.
 *
 * AND THE DIRECTORY IS NOT CALLED `icons`. macOS's stock global gitignore
 * carries `Icon?` — for the Finder's custom-icon resource files — and with
 * git's case-insensitive matching on this platform that pattern eats a
 * directory called `icons` whole. The files were silently unstageable; the
 * name is what fixes it.
 */

export * from "./glyphs";

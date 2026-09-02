# Third-party notices

Components redistributed with chemistry-sketcher, and — because this tool's
whole output is a file someone else opens — the terms that apply when that
output travels.

## Arimo (the figure font)

- **Files:** `packages/chem-render/assets/arimo-latin-400-normal.woff`,
  regular weight, latin subset, 14.4 kB.
- **Version:** 1.341. Extracted from `@fontsource/arimo@5.3.0`; the licence text
  in `packages/chem-render/assets/OFL.txt` is the copy published alongside the
  font in `google/fonts`.
- **Copyright:** Copyright The Arimo Project Authors
  (https://github.com/googlefonts/arimo).
- **Licence:** SIL Open Font License, Version 1.1. Full text in
  `packages/chem-render/assets/OFL.txt`.

### Why this font

Three constraints, and only a short list of faces satisfies all of them.

**The licence has to permit embedding in a file the user then gives away.**
Exported figures go to journals, co-authors and preprint servers, and an SVG
that references a font by name renders in whatever the recipient happens to
have — which is how a carefully spaced `OCH₃` arrives at a typesetter
overlapping the bond it sits on. So the font gets embedded, and the licence has
to allow that unconditionally. OFL 1.1 does, explicitly and in the strongest
terms available: section 2 permits redistribution of the font software with or
without modification, and the licence's own preamble and FAQ are clear that a
document created with the font — including one with the font embedded in it —
carries no licence obligation whatsoever. Nothing propagates to the user's
manuscript. A Microsoft core font (Arial, Helvetica) would have been the
obvious typographic choice and is flatly not redistributable; a GPL-with-
font-exception face (Nimbus Sans) is redistributable but drags a discussion
about the exception's scope into a chemist's figure, which is not a
conversation this tool should start.

**It has to be metric-compatible with Arial and Helvetica.** Chemical figures
are set in Arial or Helvetica by long convention, and several journals specify
one of them outright. Arimo is Steve Matteson's metrically-compatible design —
identical advance widths, glyph for glyph — so a figure laid out against the
bundled table is laid out correctly whether the viewer resolves Arimo, Arial,
Helvetica or Liberation Sans. That is what makes `font-family` a real fallback
chain here rather than a hope: the measurements this renderer trims bonds
against stay true under substitution. Liberation Sans is the same design under
a different name and would have done equally well; Arimo was taken because it
ships as a clean, small, subsettable OFL package.

**It has to cover what a label contains.** The latin subset carries the element
symbols, digits, `+`, the real minus sign U+2212, parentheses and brackets, and
the middle dot. Radical electrons are drawn as circle primitives rather than
glyphs, so no label depends on a bullet character being present.

### Obligations this project meets

- The OFL text ships next to the font, unmodified.
- The copyright notice is reproduced above and in `OFL.txt`.
- The font is not renamed, and no Reserved Font Name is used — the file is a
  verbatim subset as published, so OFL section 3 is not engaged.
- The font is not sold on its own.

### Obligations that reach an exported figure

None. A figure exported from this tool — including one with the font embedded —
is a document created with the font, not a derivative of the font software, and
the user may do anything at all with it. That is the reason for choosing an OFL
face, and it is worth stating plainly here so nobody has to re-derive it before
sending a paper out.

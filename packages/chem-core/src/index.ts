/**
 * @starter/chem-core — the chemistry model.
 *
 * Pure TypeScript: no React, no DOM, no dependencies. Everything the editor
 * knows about molecules lives here so it can be unit-tested without a
 * browser, reused headlessly, and swapped between renderers without
 * touching chemistry logic. (There is no server package — this repo is a
 * client-only surface.)
 */

export * from "./elements.js";
export * from "./query.js";
export * from "./nuclides.js";
export * from "./types.js";
export * from "./vec.js";
export * from "./molecule.js";
export * from "./valence.js";
export * from "./formula.js";
export * from "./builders.js";
export * from "./ops.js";
export * from "./transform.js";
export * from "./fragment.js";
export * from "./hit.js";
export * from "./selection.js";
// The ABS/AND/OR record layer. Below ops and fragment in the graph (both
// import it to keep a group honest across a delete, a merge and a paste) and
// deliberately above nothing that perceives: it asks no stereo questions.
export * from "./stereo-groups.js";
// Species: connected components unioned across `Molecule.speciesJoins`, the
// record layer for those joins beside them. Below ops and fragment for the
// same reason as the stereo groups.
export * from "./species.js";
// Contracted abbreviations (decision 225): the superatom record layer, below
// ops and fragment like the two above, and the label table that names a
// stamped group when it is contracted.
export * from "./abbreviations.js";
export * from "./abbreviation-labels.js";
export * from "./sprout.js";
export * from "./rings.js";
export * from "./aromatic.js";
export * from "./molblock-write.js";
export * from "./molblock-read.js";
export * from "./cdxml-write.js";
export * from "./templates.js";
// Functional groups: stamped through templates.ts's attachment direction.
export * from "./groups.js";
export * from "./lewis.js";
export * from "./condensed.js";
// The one lift and signed volume both stereo readers call. Imports neither.
export * from "./parity.js";
// CIP ranking and unit classification, shared by both stereo readers. Imports
// neither of them.
export * from "./cip.js";
// Constitutional symmetry (colour refinement) and stereogenic axes and planes.
export * from "./symmetry.js";
export * from "./stereo-axes.js";
// Perception LAST among the chemistry modules: it reads valence, rings and
// aromaticity, and only stereo-config reads it.
export * from "./stereo.js";
// After stereo.js and valence.js, which it composes. Nothing imports it.
export * from "./issues.js";
// Curly arrows as electron bookkeeping: reads valence and lone pairs, draws
// nothing, and knows no drawn arrow (decision 149).
export * from "./mechanism.js";
// Coordinate-free configuration and reading conventions, built on stereo.ts's
// CIP ranking.
export * from "./stereo-config.js";
// The V2000 atom parity column as a StereoConfig and back (decision 207).
// The molblock writer calls it; it reads stereo-config's parity arithmetic.
export * from "./atom-parity.js";
// Achirality proved by an atom mapping; reads stereo-config.
export * from "./achirality.js";
// One centre on a synthetic Fischer cross, read through stereo-config: the
// only thing sugar and amino-acid D/L share (decision 132).
export * from "./fischer-side.js";
// Parent-chain selection with an honest stop at a tie, for the two below.
export * from "./carbon-chain.js";
// Alpha-amino acids: C1 at the carboxyl, D/L at the alpha carbon.
export * from "./amino-acid.js";
// Sugar rings, carbohydrate numbering, D/L, alpha/beta, cyclise and open.
export * from "./sugar.js";
// Locants: explicit first, then the sugar and amino-acid rules. Reads both.
export * from "./numbering.js";
// One implicit hydrogen drawn as a real atom for an arrow to reach (decision
// 131). Reads stereo-config to keep a centre's configuration, so it sits last.
export * from "./promote-hydrogen.js";
// Every implicit hydrogen on a selection drawn, or drawn protium folded back
// into the count, configurations kept (decision 242). Built on promote-hydrogen.
export * from "./explicit-hydrogens.js";
// Retained ring skeletons as data: embedding, acceptance, and the alpha/beta
// face against one reference plane (decision 165). Reads stereo-config; the
// planar templates read it. Nothing here imports sugar.ts: steroid and
// anomeric alpha/beta share a Greek letter and no code.
export * from "./skeleton/table.js";
export * from "./skeleton/steroid.js";
// The projection engine: frames, project and read back. Built on
// stereo-config's reading conventions and read by nothing above. The
// templates and their helpers (template.ts, planar.ts, mills.ts,
// steroid-panel.ts, fischer.ts, marks.ts, skeleton-labels.ts) stay internal:
// a template's `place` returns an unchecked draft, and only `project`, which
// reads every draft back before returning it (decision 146), may hand a
// layout out.
export * from "./projection/types.js";
export * from "./projection/nodes.js";
export * from "./projection/frames.js";
export * from "./projection/engine.js";
// The brand the projection harness's layout-to-Molecule builder puts on what
// it returns, so a document refuses it (decision 210). The builder itself
// lives in the test tree and is not exported.
export * from "./test-only.js";

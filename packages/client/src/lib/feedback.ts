/**
 * Where feedback goes (decision 140).
 *
 * ── ONE ADDRESS, AND NOTHING FROM THE SKETCH ───────────────────────────────
 *
 * Feedback is an email alias, linked from the landing footer and the editor's
 * status bar: a chemist should not need a GitHub account to report a missing
 * feature, even though the repo is public (MIT).
 * Both read the address from here, so a change of alias is one line.
 *
 * The link is a bare `mailto:` with no `?subject=` or `?body=`. A body filled
 * in from the open sketch would send a structure out of the browser, and the
 * landing page says the structures you draw do not leave your computer. A
 * chemist who wants to show a structure attaches an export themselves.
 */

export const FEEDBACK_ADDRESS = "feedback@hydroxyl.app";

export const FEEDBACK_HREF = `mailto:${FEEDBACK_ADDRESS}`;

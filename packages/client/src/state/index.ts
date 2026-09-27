/**
 * The editor state module.
 *
 * Import from here, not from the individual files: `./store` pulls in React
 * for the hook, and keeping that behind one entry point is what lets the
 * framework-free half (`./viewport`, `./history`, `./chem-guard` and the
 * slices) stay provable in a plain node process.
 *
 * The slice creators themselves are not re-exported — they are plumbing for
 * `createEditorStore`, and exporting them would invite a second store
 * assembled from a different subset of slices, which `EditorState` says does
 * not exist.
 */

export * from "./chem-guard";
export * from "./history";
export * from "./startup-document";
export * from "./types";
export * from "./viewport";
export * from "./store";
export { EMPTY_SELECTION, pruneSelection } from "./slices/selection";
export { DEFAULT_TOOL_OPTIONS } from "./slices/tool";
export { INITIAL_UI_STATE } from "./slices/ui";

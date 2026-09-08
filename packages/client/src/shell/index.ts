/**
 * The editor shell: the chrome around the canvas.
 *
 * Every file here is a React component and every one is a client component,
 * which is exactly why they are separated from `@/editor` — the registries,
 * the element buffer and the traversal in that module are framework-free and
 * provable in a plain node process, and mixing the two would drag React into
 * their tests.
 *
 * DELIBERATELY NOT RE-EXPORTED: the sub-panels' internal field components
 * (`Field`, `NumberField`, `OptionButton`). A caller reaching for one of them
 * is building a second properties panel, which is a design question rather
 * than an import question.
 */

export { EditorShell } from "./EditorShell";
export { CanvasErrorBoundary } from "./CanvasErrorBoundary";
export { useFileDrop } from "./useFileDrop";
export { CommandPalette } from "./CommandPalette";
export { PropertiesPanel } from "./PropertiesPanel";
export { StatusBar } from "./StatusBar";
export { ToolRail } from "./ToolRail";
export { TopBar } from "./TopBar";
export { useTheme, applyTheme } from "./theme";
export type { ThemeName } from "./theme";

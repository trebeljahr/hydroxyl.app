/**
 * The editor module: the tool and command registries, the keyboard layer, the
 * derived-chemistry cache and the keyboard traversal.
 *
 * `useKeyBindings.ts` is the only file here that touches React, which is what
 * keeps the registries, the element buffer and the traversal provable in a
 * plain node process. Import from here rather than from the individual files;
 * a caller that wants to stay React-free can reach for the specific module.
 *
 * DELIBERATELY NOT RE-EXPORTED:
 *
 * - `./interaction`, which has a barrel of its own and a different audience:
 *   it is the pointer machine, and mixing its vocabulary into this one would
 *   suggest the two are the same layer. They are not — the machine speaks
 *   pointer facts, this module speaks commands.
 * - `./commands/cleanup`'s internals. `cleanUpStructure` is reachable as the
 *   `structure.clean-up` command and there is no second call site; exporting
 *   it would invite one that skipped the registry's `enabled` check.
 */

export * from "./tools";
export * from "./commands/registry";
export * from "./element-buffer";
export * from "./traversal";
export * from "./derived";
export * from "./useKeyBindings";

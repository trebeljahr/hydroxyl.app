/**
 * File in, file out. Sniffing, importing, exporting, and the File System
 * Access shims the three of them need.
 *
 * Nothing here imports RDKit statically — see the header of `open.ts` — so a
 * chunk that pulls this module in does not pull in the wasm.
 */

export * from "./sniff";
export * from "./open";
export * from "./save";
export * from "./file-system";

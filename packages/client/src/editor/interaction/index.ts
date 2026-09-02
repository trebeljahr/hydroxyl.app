/**
 * The editing interaction module: the pointer state machine and the React
 * adapter that feeds it.
 *
 * `facts.ts` and `machine.ts` are framework-free and import nothing from React
 * or the DOM, so they stay provable in a plain node process — which is the
 * whole reason the machine is a reducer. `adapter.ts` is the only file here
 * that knows about either.
 */

export * from "./facts";
export * from "./machine";
export * from "./adapter";

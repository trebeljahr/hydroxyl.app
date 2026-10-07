// The client's export module types its settings through `@/state/types`,
// whose StateCreator mutator list names "zustand/immer". That name is
// registered by a module augmentation in zustand/middleware/immer, which the
// client's store imports and this package never does, so the typecheck loads
// it here. The ESM typings, because those are what zustand's exports map gives
// `@/state/types`; the CJS ones augment a different module. Types only:
// nothing of zustand reaches the bundle.
import type {} from "../../client/node_modules/zustand/esm/middleware/immer.mjs";

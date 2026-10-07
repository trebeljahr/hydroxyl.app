/**
 * 3D conformers for the 3D view (decisions 222 and 232), from OpenChemLib's
 * MMFF94s+ in a worker. Nothing here is a chem-core type and nothing leaves
 * the machine (decision 108).
 *
 * Extensionless relative imports, as in `@/lib/rdkit` (its index says why).
 */

export { conformerWorkerUrl, disposeConformerWorker, requestConformer } from "./client";
export type {
  ConformerAtom,
  ConformerBond,
  ConformerFailure,
  ConformerResult,
} from "./protocol";

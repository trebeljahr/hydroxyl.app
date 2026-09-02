/**
 * chem-io: SMILES, InChI, molfiles and 2D layout, via RDKit in a worker.
 *
 * Importing this module does NOT load RDKit. The wasm is fetched by the
 * worker on the first operation, and a session that never imports or exports
 * a structure never pays for it.
 */

export {
  canonicalize,
  disposeRdkitWorker,
  fromMolblock,
  fromSmiles,
  generate2DCoords,
  toInchi,
  toMolblock,
  toSmiles,
} from "./client.js";
export { rdkitAssetBase } from "./asset-base.js";
export {
  COORDINATE_SCALE,
  COORDINATE_TOLERANCE,
  diffMolecules,
  hasMeaningfulCoordinates,
  maxCoordinateDelta,
  moleculeToMolblock,
  molblockToMolecule,
} from "./translate.js";
export type {
  CanonicalResult,
  ChangeReport,
  ChemIoError,
  ChemIoErrorKind,
  ChemIoResult,
  CoordinateOutcome,
  ImportedStructure,
  InchiResult,
  MoleculeDiff,
} from "./types.js";

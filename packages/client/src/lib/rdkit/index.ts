/**
 * chem-io: SMILES, InChI, molfiles and 2D layout, via RDKit in a worker.
 *
 * Importing this module does NOT load RDKit. The wasm is fetched by the
 * worker on the first operation, and a session that never imports or exports
 * a structure never pays for it.
 *
 * RELATIVE IMPORTS HERE ARE EXTENSIONLESS, unlike chem-core's and shared's.
 * Those two packages are NodeNext and their `./x.js` specifiers are required;
 * this package is `moduleResolution: "bundler"` and Turbopack cannot resolve
 * a `.js` specifier that has no `.js` file behind it. `tsc` could — bundler
 * resolution does the rewrite — so the whole directory typechecked while
 * being unbundlable, and nothing noticed because until the "Clean up
 * structure" command nothing in the APP imported it: the unit tests run under
 * vitest, and `worker.ts` is bundled separately by esbuild. The first import
 * from a client component broke `next build` outright.
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
} from "./client";
export { rdkitAssetBase } from "./asset-base";
export {
  COORDINATE_SCALE,
  COORDINATE_TOLERANCE,
  diffMolecules,
  hasMeaningfulCoordinates,
  maxCoordinateDelta,
  moleculeToMolblock,
  molblockToMolecule,
} from "./translate";
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
  Verification,
} from "./types";

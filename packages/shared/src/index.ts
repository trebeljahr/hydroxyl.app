/**
 * @starter/shared — the sketch document: its types, its zod schemas, and the
 * codec that moves it between memory and a file.
 *
 * Deliberately one module. Everything chemical lives in `@starter/chem-core`
 * and everything visual in the client; what is left over — the persisted
 * shape both of them agree on — is small enough that a second file here would
 * only invite unrelated things to move in.
 */

export * from "./document.js";

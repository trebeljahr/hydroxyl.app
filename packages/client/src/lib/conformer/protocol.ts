/**
 * The conformer worker's wire format. Text in, plain numbers out.
 *
 * As with the RDKit worker, only a molblock crosses into the worker and only
 * structured-cloneable records come back: OpenChemLib never sees a chem-core
 * type and chem-core never sees an OpenChemLib molecule. The result is not a
 * `Molecule` either. chem-core's stored model stays 2D (decision 222); a
 * conformer is derived at view time, like an implicit hydrogen, and thrown
 * away with the view.
 */

export interface ConformerRequest {
  readonly id: number;
  readonly molblock: string;
}

/** Ångström, centred on the conformer's centroid. Hydrogens included. */
export interface ConformerAtom {
  readonly element: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Indices into `atoms`. Kekulé orders, as the molblock carried them. */
export interface ConformerBond {
  readonly a: number;
  readonly b: number;
  readonly order: 1 | 2 | 3;
}

export type ConformerFailure =
  | "empty"
  | "unreadable"
  | "too-large"
  | "force-field"
  | "stereo"
  | "worker";

export type ConformerResult =
  | {
      readonly ok: true;
      readonly atoms: readonly ConformerAtom[];
      readonly bonds: readonly ConformerBond[];
      /** MMFF94s+ total energy after minimisation, kcal/mol. */
      readonly energy: number;
      /** Which seed kept the drawn stereochemistry (1-based). */
      readonly attempts: number;
    }
  | {
      readonly ok: false;
      readonly reason: ConformerFailure;
      readonly message: string;
    };

export interface ConformerResponse {
  readonly id: number;
  readonly result: ConformerResult;
}

import {v4} from 'uuid';

import {BondTypes} from '../../types';
import {Coordinates} from '../functionalAtoms';

import {Atom} from './Atom';
import {Carbon} from './elements';

export const electronsNeededBy = (bondType: string): number => {
  switch (bondType) {
    case BondTypes.double:
      return 2;
    case BondTypes.triple:
      return 3;
    case BondTypes.single:
    case BondTypes.wedge:
    case BondTypes.hash:
    case BondTypes.wave:
    default:
      return 1;
  }
};

export const origin = (): Coordinates => {
  return {x: 0, y: 0};
};

export function makeCarbonChain(length: number): Atom {
  let chain = new Carbon(origin());
  for (let i = 0; i < length - 1; i++) {
    chain = addCarbon(chain, BondTypes.single);
  }
  return chain;
}

export function addCarbon(molecule: Atom, bondType: BondTypes) {
  const secondCarbon = new Carbon(origin());
  const newBond = {
    id: v4(),
    type: bondType,
    atom: secondCarbon,
    angle: 0,
  };
  molecule.changeBond(newBond);
  const index1 = molecule.findBondIndex(secondCarbon.id);
  const bondedAtom = molecule.bonds[index1].atom;
  return bondedAtom;
}

export const trim = (str: String): String => str.replace(/\s+/g, '');

import {v4} from 'uuid';
import {combinedPeriodicTable} from '../components/UI/PeriodicTable/data/periodicTable';
import {Element} from '../components/UI/PeriodicTable/types';
import {BondTypes} from '../types';

export interface Vec2D {
  x: number;
  y: number;
}

interface Bond {
  id: string;
  type: string;
  angle: number;
  atom: Atom;
}

interface Atom {
  id: string;
  element: string;
  freeBonds: number;
  totalBonds: number;
  maxPossibleBonds: number;
  bonds: Bond[];
  position: Vec2D;
}

type Molecule = [Atom];

function changeFreeBonds(atom: Atom, newFreeBonds: number) {
  if (newFreeBonds > atom.maxPossibleBonds) {
    return {...atom};
  }
  return {...atom, freeBonds: newFreeBonds};
}

function createBond(atom: Atom, type: string, angle: number): Bond {
  return {
    id: v4(),
    type,
    angle,
    atom,
  };
}

const bondsNeeded = {
  single: 1,
  double: 2,
  triple: 3,
  wedge: 1,
  hash: 1,
} as bonding;

interface bonding {
  [key: string]: number;
}

function countHydrogen(atom: Atom) {
  return atom.bonds.reduce((agg, bond) => {
    if (bond.atom.element === 'Hydrogen') {
      return agg + 1;
    }
    return agg;
  }, 0);
}

function getFreeBonds(atom: Atom) {
  return atom.freeBonds + countHydrogen(atom);
}

function changeBond(atom1: Atom, bondIndex: number, type: string) {
  const atom2 = {...atom1.bonds[bondIndex].atom};
  const bothCanBond = getFreeBonds(atom1) >= bondsNeeded[type] &&
      getFreeBonds(atom2) >= bondsNeeded[type];
  if (bothCanBond) {
  }
}

function numberOfBonds(bonds: Bond[]) {
  return bonds.reduce((agg, bond) => {
    return agg + bondsNeeded[bond.type];
  }, 0);
}

function removeHydrogen(atom: Atom) {
  const newBonds =
      atom.bonds.filter((bond) => bond.atom.element !== 'Hydrogen');
  const totalBonds = numberOfBonds(newBonds);
  const freeBonds = atom.maxPossibleBonds - totalBonds;
  return {
    ...atom,
    bonds: newBonds,
    totalBonds,
    freeBonds,
  };
}

function createAtom(
    element: string, bondedTo?: Atom, bondType = BondTypes.single, position = {
      x: 0,
      y: 0
    }): Atom {
  const {maxBonds, name} = combinedPeriodicTable[element] as Element;
  const bonds = bondedTo ? [createBond(bondedTo, bondType, 0)] : [];
  const totalBonds = bondedTo ? bondsNeeded[bondType] : 0;
  const atom = {
    id: v4(),
    bonds,
    element: name,
    freeBonds: maxBonds - totalBonds,
    totalBonds,
    maxPossibleBonds: maxBonds,
    position,
  };
  return atom;
}

// function fillHydrogen(atom: Atom): Atom {
//   const totalBonds = numberOfBonds(atom.bonds);
//   const freeBonds = atom.maxPossibleBonds - totalBonds;
//   if (freeBonds > 0) {
//     const atom2 =
//     const hydrogenBond = createBond(atom, BondTypes.single, );
//     const newAtom = {};
//     return fillHydrogen(newAtom);
//   } else return { ...atom };
// }

export default {
  createBond,
  changeFreeBonds,
  changeBond,
  removeHydrogen,
  createAtom,
};

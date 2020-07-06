import { combinedPeriodicTable } from "../../components/UI/PeriodicTable/data/periodicTable";
import { Element } from "../../components/UI/PeriodicTable/types";
import { Atom } from "./Atom";
import { Vec2D, origin } from "./utils";
import { BondTypes } from "../../types";
import { v4 } from "uuid";

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

export class Hydrogen extends Atom {
  constructor(pos: Vec2D) {
    const { maxBonds, symbol, name } = combinedPeriodicTable[
      "Hydrogen"
    ] as Element;
    super({
      name,
      maxBonds,
      symbol,
      pos,
    });
  }
}

export class Nitrogen extends Atom {
  constructor(pos: Vec2D) {
    const { maxBonds, symbol, name } = combinedPeriodicTable[
      "Nitrogen"
    ] as Element;
    super({
      name,
      maxBonds,
      symbol,
      pos,
    });
  }
}

export class Oxygen extends Atom {
  constructor(pos: Vec2D) {
    const { maxBonds, symbol, name } = combinedPeriodicTable[
      "Oxygen"
    ] as Element;
    super({
      name,
      maxBonds,
      symbol,
      pos,
    });
  }
}

export class Carbon extends Atom {
  constructor(pos: Vec2D) {
    const { maxBonds, symbol, name } = combinedPeriodicTable[
      "Carbon"
    ] as Element;
    super({
      name,
      maxBonds,
      symbol,
      pos,
    });
  }
}

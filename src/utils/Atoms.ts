import { v4 as uuid } from "uuid";
import { AtomConstructor, Bonds, BondDirections, Bond } from "../types";

const defaultBonds = (): Bonds => {
  return {
    [BondDirections.left]: null,
    [BondDirections.right]: null,
    [BondDirections.up]: null,
    [BondDirections.down]: null,
  };
};

const hydrogenate = (atom: Atom) => {
  Object.entries(atom.bonds).forEach((entry) => {
    const [direction, bond]: [any, Bond | null] = entry;
    if (bond === null) {
      atom.changeBond(direction, { type: 1, atom: new Hydrogen() });
    }
  });
};

export const opposite = (direction: BondDirections) => {
  switch (direction) {
    case BondDirections.left:
      return BondDirections.right;
    case BondDirections.right:
      return BondDirections.left;
    case BondDirections.up:
      return BondDirections.down;
    case BondDirections.down:
      return BondDirections.up;
  }
};

export class Atom {
  id: string;
  type: string;
  maxBonds: number;
  bonds: Bonds;
  constructor({
    type = "Unknown Atom",
    maxBonds = 1,
    bonds = defaultBonds(),
  }: AtomConstructor) {
    this.type = type;
    this.maxBonds = maxBonds;
    this.bonds = bonds;
    this.id = uuid();
  }
  totalBonds = () => {
    return Object.values(this.bonds).reduce((acc: number, bond: Bond) => {
      const type = bond ? bond.type : 0;
      return acc + type;
    }, 0);
  };
  changeBond = (direction: BondDirections, newBond: Bond | null) => {
    if (newBond === null) {
      this.bonds[direction] = newBond;
      return;
    }
    const oldBond = this.bonds[direction];
    const oldBondType = oldBond === null ? 0 : oldBond.type;
    if (this.totalBonds() + newBond.type - oldBondType > this.maxBonds) {
      return;
    }
    this.bonds[direction] = newBond;
    newBond.atom.bonds[opposite(direction)] = {
      type: newBond.type,
      atom: this,
    };
  };
}

export const trim = (str: String): String => str.replace(/\s+/g, "");

export class Oxygen extends Atom {
  constructor() {
    super({ type: "Oxygen" });
  }
}

export class Nitrogen extends Atom {
  constructor() {
    super({ type: "Nitrogen" });
    Object.entries(this.bonds).forEach((entry) => {
      // const [direction, bond]: [any, Bond | null] = entry;
      // if (
      //   bond === null &&
      //   (!bondedFrom ||
      //     (direction !== bondedFrom && direction !== opposite(bondedFrom)))
      // ) {
      //   this.changeBond(direction, { type: 1, atom: new Hydrogen() });
      // }
    });
  }
}

export class Hydrogen extends Atom {
  constructor() {
    super({ type: "Hydrogen" });
  }
}

export const mapConnection = [2, 3, 0, 1];

export class Carbon extends Atom {
  constructor() {
    super({ type: "Carbon", maxBonds: 4 });
    hydrogenate(this);
  }
}

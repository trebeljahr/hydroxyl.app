import { v4 as uuid } from "uuid";
import {
  AtomConstructor,
  Connections,
  Bonds,
  BondDirections,
  Bond,
} from "../types";

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
  connections: Connections;
  constructor({
    type = "Unknown Atom",
    maxBonds = 1,
    bonds = defaultBonds(),
    connections = new Map(),
  }: AtomConstructor) {
    this.type = type;
    this.maxBonds = maxBonds;
    this.bonds = bonds;
    this.connections = connections;
    this.id = uuid();
  }
  totalBonds = () => {
    return Object.values(this.bonds).reduce((acc: number, bond: Bond) => {
      const type = bond ? bond.type : 0;
      return acc + type;
    }, 0);
  };
  changeBond = (direction: BondDirections, newBond: Bond) => {
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
  constructor(connections?: Connections) {
    super({ connections, type: "Oxygen" });
  }
}

export class Nitrogen extends Atom {
  constructor(connections?: Connections) {
    super({ connections, type: "Nitrogen" });
  }
}

export class Hydrogen extends Atom {
  constructor(connection?: Atom) {
    super({ type: "Hydrogen" });
    connection && this.connections.set(0, connection);
  }
}

export const mapConnection = [2, 3, 0, 1];

export class Carbon extends Atom {
  constructor(connections?: Connections) {
    super({ connections, type: "Carbon", maxBonds: 4 });
    hydrogenate(this);
  }
}

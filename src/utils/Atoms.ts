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
  deleteBond = (direction: BondDirections) => {
    this.bonds[direction]?.atom.deleteBond(opposite(direction));
    this.bonds[direction] = null;
  };
  totalBonds = () => {
    return Object.values(this.bonds).reduce((acc: number, bond: Bond) => {
      const type = bond ? bond.type : 0;
      return acc + type;
    }, 0);
  };
  changeBond = (direction: BondDirections, newBond: Bond) => {
    const oldBond = this.bonds[direction];
    const oldBondType = oldBond === null ? 0 : oldBond.type;
    console.log(this.totalBonds());
    if (this.totalBonds() + newBond.type - oldBondType > this.maxBonds) {
      return;
    }

    this.bonds[direction] = newBond;
    console.log(this.totalBonds());

    const otherAtom = newBond.atom;
    console.log(otherAtom.bonds);

    const bondOnOtherAtom = otherAtom.bonds[opposite(direction)];
    console.log(direction);
    console.log(opposite(direction));
    console.log({ bondOnOtherAtom });
    console.log({ bonds: otherAtom.bonds });

    otherAtom.bonds[opposite(direction)] = {
      type: newBond.type,
      atom: this,
    };
    console.log(this.totalBonds());
  };
  changeConnection = (connection: number, newAtom: Atom) => {
    this.connections.set(connection, newAtom);
    // newAtom.connections.set(mapConnection[connection], this);
  };
  delete = () => {
    this.type = "Hydrogen";
    this.connections = new Map();
  };

  // show = () => {
  //   const structure: String = trim(`
  //       ${this.type[0]} ${
  //     this.connections
  //       ? Object.values(this.connections)
  //           .filter((atom: Atom) => atom !== this.childOf)
  //           .map((atom: Atom) => atom.show())
  //           .join("")
  //       : ""
  //   }
  //   `);
  //   const condensedStructure = structure
  //     .split("")
  //     .reduce((agg: any, val: string) => {
  //       return {
  //         ...agg,
  //         [val]: agg[val] === undefined ? 1 : agg[val] + 1,
  //       };
  //     }, {});

  //   return structure;
  // };
}

export const trim = (str: String): String => str.replace(/\s+/g, "");

export class Oxygen extends Atom {
  constructor(connections?: Connections) {
    super({ connections, type: "Oxygen" });
    this.connections = new Map([
      [0, new Hydrogen(this)],
      [1, new Hydrogen(this)],
    ]);
    this.connections.forEach((connection: Atom, i) => {
      connection.changeConnection(mapConnection[i], this);
    });
  }
}

export class Nitrogen extends Atom {
  constructor(connections?: Connections) {
    super({ connections, type: "Nitrogen" });

    this.connections = new Map([
      [0, new Hydrogen(this)],
      [1, new Hydrogen(this)],
      [2, new Hydrogen(this)],
    ]);
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
    this.connections = new Map([
      [0, new Hydrogen(this)],
      [1, new Hydrogen(this)],
      [2, new Hydrogen(this)],
      [3, new Hydrogen(this)],
    ]);
  }
}

// const createConnections = (
//   connections: number,
//   childOf: Atom | null,
//   connectionOn: number[],
//   parent: Atom
// ) => {
//   return new Array(connections)
//     .fill(0)
//     .map((_, i) =>
//       childOf && connectionOn.find((j) => j === i)
//         ? childOf
//         : new Hydrogen({ childOf: parent })
//     );
// };

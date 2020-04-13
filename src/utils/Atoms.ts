import { v4 as uuid } from "uuid";
import { AtomConstructor, Connections } from "../types";

interface Bond {
  type: 1 | 2 | 3 | 4;
  atoms: [Atom, Atom];
}
type Bonds = Map<string, Bond>;
export class Atom {
  id: string;
  type: string;
  totalBonds: number;
  bonds: Bonds;
  connections: Connections;
  constructor({
    type = "Unknown Atom",
    totalBonds = 1,
    bonds,
    connections = new Map(),
  }: AtomConstructor) {
    this.type = type;
    this.totalBonds = totalBonds;
    this.connections = connections;
    this.id = uuid();
  }
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
    super({ connections, type: "Carbon" });
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

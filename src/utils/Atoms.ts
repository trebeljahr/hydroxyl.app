import { v4 as uuid } from "uuid";
import { AtomConstructor } from "../types";

export class Atom {
  id: string;
  childOf: Atom | null;
  type: string;
  connections: Atom[];
  constructor({ type = "Unknown Atom", childOf = null }: AtomConstructor) {
    this.type = type;
    this.childOf = childOf || null;
    this.connections = [childOf || new Hydrogen({ childOf: this })];
    this.id = uuid();
  }
  changeConnection = (connection: number, newAtom: Atom) => {
    this.connections = this.connections.map((atom, i) => {
      if (i === connection) {
        return newAtom;
      } else {
        return atom;
      }
    });
  };

  show = () => {
    const structure: String = trim(`
        ${this.type[0]} ${
      this.connections
        ? Object.values(this.connections)
            .filter((atom: Atom) => atom !== this.childOf)
            .map((atom: Atom) => atom.show())
            .join("")
        : ""
    }
    `);
    const condensedStructure = structure
      .split("")
      .reduce((agg: any, val: string) => {
        return {
          ...agg,
          [val]: agg[val] === undefined ? 1 : agg[val] + 1,
        };
      }, {});
    if (!this.childOf) {
      console.log(condensedStructure);
    }
    return structure;
  };
}

export const trim = (str: String): String => str.replace(/\s+/g, "");

export class Oxygen extends Atom {
  connectionOn: number[];
  constructor({ childOf = null, connectionOn = [0] }: AtomConstructor) {
    super({ childOf, type: "Oxygen" });
    this.connectionOn = connectionOn;
    this.connections = createConnections(2, childOf, connectionOn, this);
  }
}

export class Nitrogen extends Atom {
  connectionOn: number[];
  constructor({ childOf = null, connectionOn = [0] }: AtomConstructor) {
    super({ childOf, type: "Nitrogen" });
    this.connectionOn = connectionOn;
    this.connections = createConnections(3, childOf, connectionOn, this);
  }
}

export class Hydrogen extends Atom {
  constructor({ childOf = null }: AtomConstructor) {
    super({ childOf, type: "Hydrogen" });
  }
}

export class Carbon extends Atom {
  connectionOn: number[];
  constructor({ childOf = null, connectionOn = [0] }: AtomConstructor) {
    super({ childOf, type: "Carbon" });
    this.connectionOn = connectionOn;
    this.connections = createConnections(4, childOf, connectionOn, this);
  }
}

const createConnections = (
  connections: number,
  childOf: Atom | null,
  connectionOn: number[],
  parent: Atom
) => {
  return new Array(connections)
    .fill(0)
    .map((_, i) =>
      childOf && connectionOn.find((j) => j === i)
        ? childOf
        : new Hydrogen({ childOf: parent })
    );
};

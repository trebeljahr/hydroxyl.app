interface AtomConstructor {
  type?: string;
  childOf?: Atom | null;
}

export class Atom {
  childOf: Atom | null;
  type: string;
  connections: null | TwoBonds | ThreeBonds | FourBonds;
  constructor({ type = "Unknown Atom", childOf = null }: AtomConstructor) {
    this.type = type;
    this.childOf = childOf || null;
    this.connections = null;
  }
  changeConnection = (connection: number, newAtom: Atom) => {
    this.connections = this.connections
      ? {
          ...this.connections,
          [connection]: newAtom,
        }
      : null;
  };
  show = () => {
    const structure: string = `
        ${this.type[0]} ${
      this.connections
        ? Object.values(this.connections)
            .filter((atom: Atom) => atom !== this.childOf)
            .map((atom: Atom) => atom.show())
            .join("")
        : ""
    }
    `;
    const condensedStructure = trim(structure)
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
  connections: TwoBonds;
  constructor({ childOf = null }: AtomConstructor) {
    super({ childOf, type: "Carbon" });
    this.connections = {
      1: new Hydrogen({ childOf: this }),
    };
  }
}

export class Hydrogen extends Atom {
  constructor({ childOf = null }: AtomConstructor) {
    super({ childOf, type: "Hydrogen" });
  }
}

export class Carbon extends Atom {
  connections: FourBonds;
  constructor({ childOf = null }: AtomConstructor) {
    super({ childOf, type: "Carbon" });
    this.connections = {
      1: childOf || new Hydrogen({ childOf: this }),
      2: new Hydrogen({ childOf: this }),
      3: new Hydrogen({ childOf: this }),
      4: new Hydrogen({ childOf: this }),
    };
  }
}

interface TwoBonds {
  1: Atom;
}

interface ThreeBonds {
  1: Atom;
  2: Atom;
}

interface FourBonds {
  1: Atom;
  2: Atom;
  3: Atom;
  4: Atom;
}

import { v4 as uuid } from "uuid";
import {
  AtomConstructor,
  Bonds,
  BondDirections,
  Bond,
  BondTypes,
} from "../types";
import { combinedPeriodicTable } from "../components/UI/PeriodicTable/data/periodicTable";
import { Element } from "../components/UI/PeriodicTable/types";

const defaultBonds = (): Bonds => {
  return {
    [BondDirections.left]: null,
    [BondDirections.right]: null,
    [BondDirections.up]: null,
    [BondDirections.down]: null,
  };
};

const electronsNeededBy = (bondType: BondTypes): number => {
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

const directionToAngle = (direction: BondDirections): number => {
  switch (direction) {
    case BondDirections.left:
      return 180;
    case BondDirections.right:
      return 0;
    case BondDirections.up:
      return 90;
    case BondDirections.down:
      return 270;
  }
};
export class Atom {
  id: string;
  name: string;
  maxBonds: number;
  bonds: Bonds;
  symbol: string;
  constructor({
    name,
    maxBonds,
    bonds = defaultBonds(),
    symbol,
  }: AtomConstructor) {
    this.name = name;
    this.symbol = symbol;
    this.maxBonds = maxBonds;
    this.bonds = bonds;
    this.id = uuid();
    if (this.name !== "Hydrogen") {
      this.fillUpWithHydrogen();
    }
  }
  freeBonds = (): number => {
    return this.maxBonds - this.totalBonds();
  };
  totalBonds = (): number => {
    return Object.values(this.bonds).reduce((acc: number, bond: Bond) => {
      const type = bond ? electronsNeededBy(bond.type) : 0;
      return acc + type;
    }, 0);
  };
  deleteBond = (direction: BondDirections) => {
    this.bonds[direction] = null;
  };
  hydrogenBonds = (): { amount: number; directions: BondDirections[] } => {
    return Object.keys(this.bonds).reduce(
      (agg: any, k: string) => {
        const key = k as BondDirections;
        const bond = this.bonds[key] as Bond;
        if (bond && bond.atom.name === "Hydrogen") {
          return {
            amount: agg.amount + 1,
            directions: [...agg.directions, key],
          };
        }
        return agg;
      },
      { amount: 0, directions: [] }
    );
  };
  fillUpWithHydrogen = () => {
    Object.entries(this.bonds).forEach((entry) => {
      const [direction, bond]: [any, Bond | null] = entry;
      if (bond === null && this.freeBonds() >= 1) {
        this.addHydrogen(direction);
      }
    });
  };
  addHydrogen = (direction: BondDirections) => {
    const newAtom = new Hydrogen();
    newAtom.bonds[opposite(direction)] = {
      type: BondTypes.single,
      atom: this,
      angle: directionToAngle(direction),
    };
    this.bonds[direction] = {
      type: BondTypes.single,
      atom: newAtom,
      angle: directionToAngle(direction),
    };
  };
  removeHydrogen = () => {
    Object.keys(this.bonds).forEach((k) => {
      const key = k as BondDirections;
      const bond = this.bonds[key] as Bond;
      if (bond && bond.atom.name === "Hydrogen") {
        this.deleteBond(key);
      }
    });
  };
  changeBond = (direction: BondDirections, newBond: Bond) => {
    this.removeHydrogen();
    newBond.atom.removeHydrogen();
    const canBond = this.freeBonds() >= electronsNeededBy(newBond.type);
    const partnerCanBond =
      newBond.atom.freeBonds() >= electronsNeededBy(newBond.type);
    if (canBond && partnerCanBond) {
      this.bonds[direction] = newBond;
      newBond.atom.bonds[opposite(direction)] = {
        type: newBond.type,
        atom: this,
        angle: 180 - newBond.angle,
      };
    }
    this.fillUpWithHydrogen();
    newBond.atom.fillUpWithHydrogen();
  };
}

export class Hydrogen extends Atom {
  constructor() {
    const { maxBonds, symbol, name } = combinedPeriodicTable[
      "Hydrogen"
    ] as Element;
    super({
      name,
      maxBonds,
      symbol,
    });
  }
}

export class Nitrogen extends Atom {
  constructor() {
    const { maxBonds, symbol, name } = combinedPeriodicTable[
      "Nitrogen"
    ] as Element;
    super({
      name,
      maxBonds,
      symbol,
    });
  }
}

export class Oxygen extends Atom {
  constructor() {
    const { maxBonds, symbol, name } = combinedPeriodicTable[
      "Oxygen"
    ] as Element;
    super({
      name,
      maxBonds,
      symbol,
    });
  }
}

export class Carbon extends Atom {
  constructor() {
    const { maxBonds, symbol, name } = combinedPeriodicTable[
      "Carbon"
    ] as Element;
    super({
      name,
      maxBonds,
      symbol,
    });
  }
}

export const trim = (str: String): String => str.replace(/\s+/g, "");

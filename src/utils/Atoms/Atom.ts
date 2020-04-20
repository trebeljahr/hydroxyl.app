import { v4 as uuid, v4 } from "uuid";
import {
  AtomConstructor,
  Bonds,
  BondDirections,
  Bond,
  BondTypes,
} from "../../types";
import {
  electronsNeededBy,
  opposite,
  directionToAngle,
  defaultBonds,
} from "./utils";
import { Hydrogen } from "./elements";

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
    const id = v4();
    newAtom.bonds[opposite(direction)] = {
      type: BondTypes.single,
      atom: this,
      angle: directionToAngle(direction),
      id,
    };
    this.bonds[direction] = {
      type: BondTypes.single,
      atom: newAtom,
      angle: directionToAngle(direction),
      id,
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
        id: newBond.id,
        type: newBond.type,
        atom: this,
        angle: 180 - newBond.angle,
      };
    }
    this.fillUpWithHydrogen();
    newBond.atom.fillUpWithHydrogen();
  };
}

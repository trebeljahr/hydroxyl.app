import { v4 as uuid, v4 } from "uuid";
import { AtomConstructor, Bond, BondTypes } from "../../types";
import { electronsNeededBy } from "./utils";
import { Hydrogen } from "./elements";
import { Coordinates } from "../functionalAtoms";

// polarCoordinates formulas =>
// x = bondLength * Math.cos(angle)
// y = bondLength * Math.sin(angle)
// angle = Math.acos(x / bondLength)
// angle = Math.asin(y / bondLength)

const bondLength = 10;

export class Atom {
  id: string;
  name: string;
  maxBonds: number;
  bonds: Bond[];
  symbol: string;
  pos: Coordinates;
  constructor({ name, maxBonds, bonds = [], symbol, pos }: AtomConstructor) {
    this.pos = pos;
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
    return this.bonds.reduce(
      (acc: number, bond: Bond) => acc + electronsNeededBy(bond.type),
      0
    );
  };
  deleteBond = (index: number) => {
    this.bonds = this.bonds.filter((_, i) => index !== i);
  };
  countHydrogenBonds = (): number => {
    return this.bonds.reduce(
      (agg, bond) => agg + (bond.atom.name === "Hydrogen" ? 1 : 0),
      0
    );
  };
  fillUpWithHydrogen = () => {
    const freeBonds = this.freeBonds();
    for (let i = 0; i < freeBonds; i++) {
      const angle = i * (360 / freeBonds);
      this.addHydrogen(angle);
    }
  };
  changeBondType = (bondId: string, newBondType: string) => {
    const index = this.bonds.findIndex((bond) => bond.id === bondId);
    const newBond = { ...this.bonds[index], type: newBondType };
    index && this.changeBond(newBond);
  };
  addBond = (angle: number, newBond: Bond) => {
    this.addHydrogen(angle);
    this.changeBond(newBond);
  };

  addHydrogen = (angle: number) => {
    const pos = {
      x: this.pos.x + Math.cos(angle) * bondLength,
      y: this.pos.y + Math.sin(angle) * bondLength,
    };
    const newAtom = new Hydrogen(pos);
    const id = v4();

    const newBondToThis = {
      type: BondTypes.single,
      atom: this,
      angle,
      id,
    };
    newAtom.bonds = [...newAtom.bonds, newBondToThis];

    const newBond = {
      type: BondTypes.single,
      atom: newAtom,
      angle: 180 - angle,
      id,
    };
    this.bonds = [...this.bonds, newBond];
  };
  removeHydrogen = () => {
    this.bonds = this.bonds.filter((bond) => bond.atom.name !== "Hydrogen");
  };

  changeBond = (newBond: Bond) => {
    this.removeHydrogen();
    const partner = newBond.atom;
    partner.removeHydrogen();
    const canBond = this.freeBonds() >= electronsNeededBy(newBond.type);
    const partnerCanBond =
      partner.freeBonds() >= electronsNeededBy(newBond.type);
    if (canBond && partnerCanBond) {
      this.bonds = [...this.bonds, newBond];
      partner.bonds = [
        ...partner.bonds,
        {
          id: newBond.id,
          type: newBond.type,
          atom: this,
          angle: 180 - newBond.angle,
        },
      ];
    }
    this.fillUpWithHydrogen();
    partner.fillUpWithHydrogen();
  };

  findBondIndex = (atomId: string) => {
    return this.bonds.findIndex((bond) => bond.atom.id === atomId);
  };

  mapBonds = () => {
    return this.bonds.map((bond) => bond.atom.symbol);
  };

  buildTree = (visited: string[] = [], symbols: string[] = []): string[] => {
    //console.log({ symbols });
    const noUnvisitedBonds =
      this.bonds.filter((bond) => !visited.includes(bond.id)).length === 0;

    if (noUnvisitedBonds) {
      return [];
    }

    const newSymbols = [...symbols, ...this.mapBonds()];
    const newVisited = [...visited, ...this.bonds.map((bond) => bond.id)];
    const newTree = this.bonds.reduce(
      (agg, bond) => [...agg, ...bond.atom.buildTree(newVisited, symbols)],
      [...newSymbols] as string[]
    );
    // console.log({ newTree });
    return newTree;
  };
}

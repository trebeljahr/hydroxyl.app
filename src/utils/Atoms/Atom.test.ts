import { Atom } from "./Atom";
import { Carbon } from "./elements";
import {
  origin,
  makeCarbonChain,
  addCarbon,
} from "../../components/UI/Canvas/Canvas";
import { BondTypes } from "../../types";
import { v4 } from "uuid";

test("Sum Formula works correctly", () => {
  const methane = makeCarbonChain(1);
  const pentane = makeCarbonChain(5);
  const heptane = makeCarbonChain(7);
  const octane = makeCarbonChain(8);
  expect(methane.sumFormulaString()).toBe("CH4");
  expect(pentane.sumFormulaString()).toBe("C5H12");
  expect(heptane.sumFormulaString()).toBe("C7H16");
  expect(octane.sumFormulaString()).toBe("C8H18");
});

test("Build Tree works correctly", () => {
  const carbon = new Carbon(origin());
  const secondCarbon = new Carbon(origin());
  const newBond = {
    id: v4(),
    type: BondTypes.single,
    atom: secondCarbon,
    angle: 0,
  };
  carbon.changeBond(newBond);
  const tree = ["C", "C", "H", "H", "H", "H", "H", "H"];
  expect(carbon.buildTree()).toStrictEqual(tree);
});

test("Test Molecule has 4 hydrogen bonds", () => {
  const testMolecule = new Carbon(origin());
  expect(testMolecule.bonds.length).toBe(4);
  expect(
    testMolecule.bonds.filter((bond) => bond.atom.name !== "Hydrogen").length
  ).toBe(0);
});

test("Changing to Single Bond works", () => {
  const testMolecule = new Carbon(origin());
  const secondCarbon = new Carbon(origin());
  const newBond = {
    id: v4(),
    type: BondTypes.single,
    atom: secondCarbon,
    angle: 0,
  };
  testMolecule.changeBond(newBond);
  const bondedAtom = testMolecule.bonds[0].atom;
  expect(bondedAtom.id).toBe(secondCarbon.id);
  expect(bondedAtom.name).toBe("Carbon");
  expect(testMolecule.bonds.length).toBe(4);
  expect(secondCarbon.bonds.length).toBe(4);
});

test("Changing to Double Bonds works", () => {
  const testMolecule = new Carbon(origin());
  const secondCarbon = new Carbon(origin());
  const newBond = {
    id: v4(),
    type: BondTypes.double,
    atom: secondCarbon,
    angle: 0,
  };
  testMolecule.changeBond(newBond);
  const bondedAtom = testMolecule.bonds[0].atom;
  expect(bondedAtom.id).toBe(secondCarbon.id);
  expect(bondedAtom.name).toBe("Carbon");
  expect(testMolecule.bonds[0].type).toBe(BondTypes.double);
  const index = bondedAtom.findBondIndex(testMolecule.id);
  expect(bondedAtom.bonds[index].type).toBe(BondTypes.double);
  expect(testMolecule.bonds.length).toBe(3);
  expect(bondedAtom.bonds.length).toBe(3);
});

test("Changing to Triple Bonds works", () => {
  const testMolecule = new Carbon(origin());
  const secondCarbon = new Carbon(origin());
  const newBond = {
    id: v4(),
    type: BondTypes.triple,
    atom: secondCarbon,
    angle: 0,
  };
  testMolecule.changeBond(newBond);
  const bondedAtom = testMolecule.bonds[0].atom;
  expect(bondedAtom.id).toBe(secondCarbon.id);
  expect(bondedAtom.name).toBe("Carbon");
  const index1 = testMolecule.findBondIndex(secondCarbon.id);
  expect(testMolecule.bonds[index1].type).toBe(BondTypes.triple);
  const index2 = bondedAtom.findBondIndex(testMolecule.id);
  expect(bondedAtom.bonds[index2].type).toBe(BondTypes.triple);
  expect(testMolecule.bonds.length).toBe(2);
  expect(bondedAtom.bonds.length).toBe(2);
});

test("Carbon Chaining works correctly", () => {
  const first = new Carbon(origin());
  const second = addCarbonTest(first, BondTypes.single);
  const third = addCarbonTest(second, BondTypes.single);
  const fourth = addCarbonTest(third, BondTypes.single);
  const fifth = addCarbonTest(fourth, BondTypes.single);

  expect(first.sumFormula()).toStrictEqual({ C: 5, H: 12 });
  expect(first.sumFormula()).toStrictEqual(second.sumFormula());
  expect(second.sumFormula()).toStrictEqual(third.sumFormula());
  expect(third.sumFormula()).toStrictEqual(fourth.sumFormula());
  expect(fourth.sumFormula()).toStrictEqual(fifth.sumFormula());
});

function addCarbonTest(molecule: Atom, bondType: BondTypes) {
  const bondedAtom = addCarbon(molecule, bondType);
  expect(bondedAtom.name).toBe("Carbon");
  const index1 = molecule.findBondIndex(bondedAtom.id);
  expect(molecule.bonds[index1].type).toBe(bondType);

  const index2 = bondedAtom.findBondIndex(molecule.id);
  expect(bondedAtom.bonds[index2].type).toBe(bondType);
  testBonds(molecule);
  testBonds(bondedAtom);
  return bondedAtom;
}

function testBonds(atom: Atom) {
  expect(atom.freeBonds()).toBe(0);
  expect(atom.maxBonds).toBe(atom.totalBonds());
}

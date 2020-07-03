import { Atom } from "./utils/Atoms/Atom";
import { Bond, BondDirections } from "./types";
import { v4 } from "uuid";

enum MOLECULE_ACTIONS {
  ADD_MOLECULE = "Add molecule",
  ADD_ATOM = "Add Atom",
  REMOVE_ATOM = "Remove Atom",
  CHANGE_BOND = "Changing Bond",
  CHANGE_ROOT_POSITION = "Changing Molecule Root Position",
}
enum EDITOR_ACTIONS {
  TOGGLE_EDITING_MODE = "Switch Editing Mode",
}
interface AddMolecule {
  type: MOLECULE_ACTIONS.ADD_MOLECULE;
  molecule: Molecule;
}

const addMolecule = (root: Atom, pos: Coordinates): AddMolecule => ({
  type: MOLECULE_ACTIONS.ADD_MOLECULE,
  molecule: {
    id: v4(),
    root,
    pos,
  },
});

interface ChangeMoleculeRoot {
  type: MOLECULE_ACTIONS.CHANGE_ROOT_POSITION;
  molecule: Molecule;
  newPos: Coordinates;
}
interface Coordinates {
  x: number;
  y: number;
}
export interface Molecule {
  id: String;
  root: Atom;
  pos: Coordinates;
}

const changeMoleculeRoot = (
  molecule: Molecule,
  newPos: Coordinates
): ChangeMoleculeRoot => ({
  type: MOLECULE_ACTIONS.CHANGE_ROOT_POSITION,
  molecule,
  newPos,
});

interface AddAtom {
  type: MOLECULE_ACTIONS.ADD_ATOM;
  parent: Atom;
  bond: Bond;
}
const addAtom = (parent: Atom, bond: Bond): AddAtom => ({
  type: MOLECULE_ACTIONS.ADD_ATOM,
  parent,
  bond,
});

interface RemoveAtom {
  type: MOLECULE_ACTIONS.REMOVE_ATOM;
  parent: Atom;
  atomId: String;
}
const removeAtom = (parent: Atom, atomId: String): RemoveAtom => ({
  type: MOLECULE_ACTIONS.REMOVE_ATOM,
  atomId,
  parent,
});

interface ChangeBond {
  type: MOLECULE_ACTIONS.CHANGE_BOND;
  parent: Atom;
  newBond: Bond;
  bondId: String;
}
const changeBond = (
  parent: Atom,
  bondId: String,
  bondDirections: BondDirections,
  newBond: Bond
): ChangeBond => {
  return { type: MOLECULE_ACTIONS.CHANGE_BOND, bondId, newBond, parent };
};

interface ToggleEditingMode {
  type: EDITOR_ACTIONS.TOGGLE_EDITING_MODE;
  newMode: String;
}
const toggleEditing = (newMode: String): ToggleEditingMode => ({
  type: EDITOR_ACTIONS.TOGGLE_EDITING_MODE,
  newMode,
});

export {
  MOLECULE_ACTIONS,
  EDITOR_ACTIONS,
  changeMoleculeRoot,
  addMolecule,
  addAtom,
  removeAtom,
  changeBond,
  toggleEditing,
};

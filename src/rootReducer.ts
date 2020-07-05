import { combineReducers } from "redux";
import { MOLECULE_ACTIONS } from "./actions";
import { Carbon } from "./utils/Atoms/elements";
import { Atom } from "./utils/Atoms/Atom";
import { v4 } from "uuid";

export const defaultMolecule = {
  id: v4(),
  root: new Carbon({ x: 0, y: 0 }) as Atom,
};
export const initialState = {
  molecules: [defaultMolecule],
};

function moleculeActionsReducer(state = initialState, action: any) {
  switch (action.type) {
    case MOLECULE_ACTIONS.ADD_ATOM:
      return {
        ...state,
        molecules: state.molecules.map((molecule) => {
          if (molecule.id === action.moleculeId) {
            return molecule.root.changeBond(action.newBond);
          }
          return molecule;
        }),
      };
    default:
      return state;
  }
}

const reducers = {
  moleculeActionsReducer,
};
const rootReducer = combineReducers(reducers);
export default rootReducer;

import React from "react";
import { Text, Rect } from "react-konva";
import { EditingProps, Bond, BondDirections } from "../types";
import {
  Carbon,
  Hydrogen,
  Nitrogen,
  Oxygen,
  mapConnection,
  opposite,
} from "../utils/Atoms";

export const Editing = ({ editing, turnOffEditing }: EditingProps) => {
  const editingOffsetY = 10;
  const editingOffsetX = -10;
  const {
    pos: { x, y },
  } = editing;
  const changeMolecule = (type: string) => {
    console.log("Molecule to Edit: ", editing.molecule);
    Object.entries(editing.molecule.bonds).forEach(
      (entry: [any, Bond | null]) => {
        const [direction, bond] = entry;
        const newAtom =
          type === "Hydrogen"
            ? new Hydrogen()
            : type === "Carbon"
            ? new Carbon()
            : type === "Oxygen"
            ? new Oxygen()
            : type === "Nitrogen"
            ? new Nitrogen()
            : null;
        if (newAtom && bond) {
          if (direction) {
            const atom = bond.atom;
            console.log(direction);
            newAtom.changeBond(direction, { type: 1, atom });
            console.log(direction);
            console.log("Molecule to insert: ", newAtom);
          }
        }
      }
    );
    turnOffEditing();
  };

  return (
    <>
      {editing.on ? (
        <>
          <Rect
            x={x + editingOffsetX}
            y={y + editingOffsetY}
            fill={"yellow"}
            width={20}
            height={60}
          />
          <Text
            onClick={() => changeMolecule("Carbon")}
            x={x + editingOffsetX / 2}
            y={y + editingOffsetY + 5}
            text={"C"}
          />
          <Text
            onClick={() => changeMolecule("Nitrogen")}
            x={x + editingOffsetX / 2}
            y={y + editingOffsetY + 25}
            text={"N"}
          />
          <Text
            onClick={() => changeMolecule("Hydrogen")}
            x={x + editingOffsetX / 2}
            y={y + editingOffsetY + 45}
            text={"H"}
          />
        </>
      ) : null}
    </>
  );
};

import React from "react";
import { Text, Rect } from "react-konva";
import { EditingProps } from "../types";
import {
  Atom,
  Carbon,
  Hydrogen,
  Nitrogen,
  Oxygen,
  mapConnection,
} from "../utils/Atoms";

export const Editing = ({ editing, turnOffEditing }: EditingProps) => {
  const editingOffsetY = 10;
  const editingOffsetX = -10;
  const {
    pos: { x, y },
  } = editing;
  const changeMolecule = (type: string) => {
    console.log("Molecule to Edit: ", editing.molecule);
    editing.molecule.connections.forEach((atom, key) => {
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
      if (newAtom) {
        const actualKey = [...atom.connections.entries()].find(
          ([_, value]) => value.id === editing.molecule.id
        );
        if (actualKey) {
          console.log(actualKey[0]);
          atom.changeConnection(actualKey[0], newAtom);
          newAtom.changeConnection(mapConnection[actualKey[0]], atom);
          console.log(key);
          console.log("Molecule to insert: ", newAtom);
        }
      }
    });
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

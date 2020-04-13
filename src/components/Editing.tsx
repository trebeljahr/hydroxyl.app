import React from "react";
import { Text, Rect } from "react-konva";
import { EditingProps } from "../types";
import { Atom, Carbon, Hydrogen, Nitrogen, Oxygen } from "../utils/Atoms";

const mapConnection = [2, 3, 0, 1];
export const Editing = ({ editing, turnOffEditing }: EditingProps) => {
  const editingOffsetY = 10;
  const editingOffsetX = -10;
  const {
    pos: { x, y },
  } = editing;
  const changeMolecule = (type: string) => {
    if (editing.molecule.childOf) {
      const parent: Atom = editing.molecule.childOf;
      const index = parent.connections.findIndex(
        (atom) => atom.id === editing.molecule.id
      );
      const newAtom =
        type === "Hydrogen"
          ? new Hydrogen({
              childOf: parent,
              connectionOn: [mapConnection[index]],
            })
          : type === "Carbon"
          ? new Carbon({
              childOf: parent,
              connectionOn: [mapConnection[index]],
            })
          : type === "Oxygen"
          ? new Oxygen({
              childOf: parent,
              connectionOn: [mapConnection[index]],
            })
          : type === "Nitrogen"
          ? new Nitrogen({
              childOf: parent,
              connectionOn: [mapConnection[index]],
            })
          : null;
      if (newAtom) {
        editing.molecule.childOf.changeConnection(index, newAtom);
      }
    }
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

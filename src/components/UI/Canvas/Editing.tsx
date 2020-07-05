import React from "react";
import { Text, Rect } from "react-konva";
import { EditingProps, BondTypes } from "../../../types";
import {
  Carbon,
  Hydrogen,
  Nitrogen,
  Oxygen,
} from "../../../utils/Atoms/elements";
import { v4 } from "uuid";

export const Editing = ({ editing, turnOffEditing }: EditingProps) => {
  const editingOffsetY = 10;
  const editingOffsetX = -10;
  const pos = editing.molecule.pos;
  const { x, y } = pos;
  const changeMolecule = (name: string) => {
    editing.molecule.bonds.forEach((bond) => {
      const newAtom =
        name === "Hydrogen"
          ? new Hydrogen(pos)
          : name === "Carbon"
          ? new Carbon(pos)
          : name === "Oxygen"
          ? new Oxygen(pos)
          : name === "Nitrogen"
          ? new Nitrogen(pos)
          : null;
      if (newAtom && bond) {
        const atom = bond.atom;
        newAtom.changeBond({
          atom,
          type: BondTypes.single,
          angle: 120,
          id: v4(),
        });
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

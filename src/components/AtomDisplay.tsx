import React, { useState } from "react";
import { Text, Line } from "react-konva";
import { Carbon, Atom, Hydrogen } from "../utils/Atoms";
import {
  Pos,
  EditingData,
  AtomDisplayProps,
  BondDirections,
  Bond,
} from "../types";
import { Editing } from "./Editing";

const initialEditing: EditingData = {
  on: false,
  id: null,
  pos: { x: 0, y: 0 },
  molecule: new Atom({ type: "Hydrogen" }),
};
export const molecule = new Carbon();
molecule.changeBond(BondDirections.right, { type: 1, atom: new Hydrogen() });
console.log(molecule);

molecule.changeBond(BondDirections.left, { type: 1, atom: new Carbon() });
console.log(molecule.bonds);

molecule.bonds[BondDirections.right]?.atom.changeBond(BondDirections.right, {
  type: 1,
  atom: new Hydrogen(),
});
// molecule.changeBond(BondDirections.up, { type: 1, atom: new Hydrogen() });
// console.log(molecule.bonds);
// molecule.changeBond(BondDirections.left, { type: 1, atom: new Hydrogen() });
// console.log(molecule.bonds);
// molecule.changeConnection(1, new Carbon(new Map([[3, molecule]])));

export const AtomDisplay = ({ showHydrogen }: AtomDisplayProps) => {
  const [editing, setEditing] = useState(initialEditing);

  const toggleEditing = (id: string, pos: Pos, molecule: Atom, key: string) => {
    console.log(key);
    setEditing({ on: true, id, pos, molecule });
  };
  const turnOffEditing = () => {
    setEditing(initialEditing);
  };

  const generateAtomChain = (
    atom: Atom,
    pos: Pos = { x: 350, y: 350 },
    traversedNodes: string[] = []
  ): any => {
    const { x, y } = pos;
    if (atom.bonds) {
      return Object.entries(atom.bonds).map((entry: [string, Bond | null]) => {
        const [k, bond] = entry;
        const connection = bond?.atom;
        if (connection) {
          const positionOffset = connection.type === "Hydrogen" ? 20 : 30;
          const newPos =
            k === BondDirections.left
              ? { ...pos, x: x - positionOffset }
              : k === BondDirections.up
              ? { ...pos, y: y - positionOffset }
              : k === BondDirections.right
              ? { ...pos, x: x + positionOffset }
              : k === BondDirections.down
              ? { ...pos, y: y + positionOffset }
              : pos;
          const offset = 6;
          const oldOffset = -offset;
          const linePoints =
            k === BondDirections.left
              ? [pos.x + oldOffset, pos.y, newPos.x + offset, newPos.y]
              : k === BondDirections.up
              ? [pos.x, pos.y + oldOffset, newPos.x, newPos.y + offset]
              : k === BondDirections.right
              ? [pos.x - oldOffset, pos.y, newPos.x - offset, newPos.y]
              : k === BondDirections.down
              ? [pos.x, pos.y - oldOffset, newPos.x, newPos.y - offset]
              : [pos.x, pos.y, newPos.x, newPos.y];
          if (traversedNodes.find((id) => id === connection.id)) {
            return null;
          }
          return (
            <>
              {(showHydrogen || connection.type !== "Hydrogen") && (
                <>
                  <Text
                    key={"text-" + connection.id}
                    text={connection.type[0]}
                    x={newPos.x - 4}
                    y={newPos.y - 5}
                    align="center"
                    verticalAlign="middle"
                    fontStyle={
                      editing && connection.id === editing.id
                        ? "bold"
                        : "normal"
                    }
                    onClick={() =>
                      toggleEditing(connection.id, newPos, connection, k)
                    }
                  />
                  <Line
                    key={"line-" + connection.id}
                    points={linePoints}
                    fill={"black"}
                    stroke={"black"}
                  />
                </>
              )}
              {generateAtomChain(connection, newPos, [
                ...traversedNodes,
                connection.id,
              ])}
            </>
          );
        }

        return null;
      });
    }
    return null;
  };
  return (
    <>
      <Text text={molecule.type[0]} x={350 - 4} y={350 - 5} />
      {generateAtomChain(molecule, undefined, [molecule.id])}
      <Editing turnOffEditing={turnOffEditing} editing={editing} />
    </>
  );
};

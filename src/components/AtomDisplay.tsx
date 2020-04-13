import React, { useState } from "react";
import { Text, Line } from "react-konva";
import { Carbon, Atom, Hydrogen } from "../utils/Atoms";
import { Pos, EditingData, AtomDisplayProps } from "../types";
import { Editing } from "./Editing";

const initialEditing: EditingData = {
  on: false,
  id: null,
  pos: { x: 0, y: 0 },
  molecule: new Hydrogen({ childOf: null }),
};
export const molecule = new Carbon({ childOf: null });
const secondMolecule = new Carbon({ childOf: molecule, connectionOn: [3] });
molecule.changeConnection(1, secondMolecule);

export const AtomDisplay = ({ showHydrogen }: AtomDisplayProps) => {
  const [editing, setEditing] = useState(initialEditing);

  const toggleEditing = (id: string, pos: Pos, molecule: Atom) => {
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

    return atom.connections.map((connection: Atom, k: number) => {
      const positionOffset = connection.type === "Hydrogen" ? 20 : 30;
      const newPos =
        k === 0
          ? { ...pos, x: x - positionOffset }
          : k === 1
          ? { ...pos, y: y - positionOffset }
          : k === 2
          ? { ...pos, x: x + positionOffset }
          : k === 3
          ? { ...pos, y: y + positionOffset }
          : pos;
      const offset = 6;
      const oldOffset = -offset;
      const linePoints =
        k === 0
          ? [pos.x + oldOffset, pos.y, newPos.x + offset, newPos.y]
          : k === 1
          ? [pos.x, pos.y + oldOffset, newPos.x, newPos.y + offset]
          : k === 2
          ? [pos.x - oldOffset, pos.y, newPos.x - offset, newPos.y]
          : k === 3
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
                  editing && connection.id === editing.id ? "bold" : "normal"
                }
                onClick={() => toggleEditing(connection.id, newPos, connection)}
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
    });
  };
  return (
    <>
      <Text text={molecule.type[0]} x={350 - 4} y={350 - 5} />
      {generateAtomChain(molecule, undefined, [molecule.id])}
      <Editing turnOffEditing={turnOffEditing} editing={editing} />
    </>
  );
};

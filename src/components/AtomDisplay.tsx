import React, { useState } from "react";
import { Text, Group } from "react-konva";
import { Atom, Hydrogen } from "../utils/Atoms";
import {
  Pos,
  EditingData,
  AtomDisplayProps,
  BondDirections,
  Bond,
} from "../types";
import { Editing } from "./Editing";
import { BondLines } from "./BondLines";
import { v4 } from "uuid";

const initialEditing = (): EditingData => {
  return {
    on: false,
    id: null,
    pos: { x: 0, y: 0 },
    molecule: new Hydrogen(),
  };
};

export const AtomDisplay = ({
  showHydrogen,
  molecule,
  pos,
}: AtomDisplayProps) => {
  const [editing, setEditing] = useState(initialEditing());

  const toggleEditing = (id: string, pos: Pos, molecule: Atom, key: string) => {
    setEditing({ on: true, id, pos, molecule });
  };
  const turnOffEditing = () => {
    setEditing(initialEditing());
  };

  const generateAtomChain = (
    atom: Atom,
    pos: Pos = { x: 350, y: 350 },
    traversedNodes: string[] = []
  ): any => {
    const { x, y } = pos;
    if (atom.bonds) {
      return Object.entries(atom.bonds).map((entry: [string, Bond | null]) => {
        const [j, bond] = entry;
        const k = j as BondDirections;
        if (bond) {
          const connection = bond.atom;
          const positionOffset = connection.name === "Hydrogen" ? 20 : 30;
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

          if (traversedNodes.find((id) => id === connection.id)) {
            return null;
          }
          return (
            <Group key={connection.id}>
              {(showHydrogen || connection.name !== "Hydrogen") && (
                <>
                  <Text
                    key={"text-" + connection.id}
                    text={connection.name[0]}
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
                  <BondLines bond={bond} k={k} pos={{ oldPos: pos, newPos }} />
                </>
              )}

              {generateAtomChain(connection, newPos, [
                ...traversedNodes,
                connection.id,
              ])}
            </Group>
          );
        }
        return null;
      });
    }
    return null;
  };
  return (
    <Group key={v4()}>
      <Text text={molecule.name[0]} x={pos.x - 5} y={pos.y - 5} />
      {generateAtomChain(molecule, pos, [molecule.id])}
      <Editing turnOffEditing={turnOffEditing} editing={editing} />
    </Group>
  );
};

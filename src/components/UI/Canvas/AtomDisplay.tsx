import React, { useState } from "react";
import { Text, Group, Circle } from "react-konva";
import { Hydrogen } from "../../../utils/Atoms/elements";
import {
  Pos,
  EditingData,
  AtomDisplayProps,
  BondDirections,
  Bond,
  AtomConnectionsProps,
  SingleAtomProps,
} from "../../../types";
import { Editing } from "./Editing";
import { BondLines } from "./Bonds/BondLines";
import { v4 } from "uuid";
import { Atom } from "../../../utils/Atoms/Atom";

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
  hover,
  setHover,
  pos,
  bondHighlight,
}: AtomDisplayProps) => {
  const [editing, setEditing] = useState(initialEditing());

  const toggleEditing = (id: string, pos: Pos, molecule: Atom) => {
    setEditing({ on: true, id, pos, molecule });
  };
  const turnOffEditing = () => {
    setEditing(initialEditing());
  };
  return (
    <Group key={v4()}>
      <AtomConnections
        atom={molecule}
        pos={pos}
        showHydrogen={showHydrogen}
        setHover={setHover}
        hover={hover}
        editing={editing}
        toggleEditing={toggleEditing}
        traversedNodes={[]}
        bondHighlight={bondHighlight}
      />
      <Editing turnOffEditing={turnOffEditing} editing={editing} />
    </Group>
  );
};

const AtomConnections = ({
  atom,
  pos,
  hover,
  setHover,
  showHydrogen,
  editing,
  toggleEditing,
  traversedNodes,
  bondHighlight,
}: AtomConnectionsProps): any => {
  const { x, y } = pos;
  const newTraversedNodes = [...traversedNodes, atom.id];
  return (
    <>
      {atom.bonds &&
        Object.entries(atom.bonds).map((entry: [string, Bond | null]) => {
          const [j, bond] = entry;
          const k = j as BondDirections;
          if (bond) {
            const { angle, atom: connection } = bond;
            const newPos = {
              x: Math.cos((angle * Math.PI) / 180),
              y: Math.sin((angle * Math.PI) / 180),
            };
            const length = Math.sqrt(newPos.x * newPos.x + newPos.y * newPos.y);
            newPos.x = newPos.x / length;
            newPos.y = newPos.y / length;
            newPos.x = newPos.x * 200 + x;
            newPos.y = newPos.y * 200 + y;
            if (newTraversedNodes.includes(connection.id)) {
              return null;
            }
            return (
              <Group key={connection.id}>
                {(showHydrogen || connection.name !== "Hydrogen") && (
                  <BondLines
                    bond={bond}
                    k={k}
                    pos={{ oldPos: pos, newPos }}
                    hover={hover}
                    setHover={setHover}
                    bondHighlight={bondHighlight}
                  />
                )}
                <SingleAtom
                  atom={atom}
                  editing={editing}
                  toggleEditing={toggleEditing}
                  pos={pos}
                  hover={hover}
                  setHover={setHover}
                />
                <AtomConnections
                  atom={connection}
                  pos={newPos}
                  showHydrogen={showHydrogen}
                  setHover={setHover}
                  hover={hover}
                  bondHighlight={bondHighlight}
                  editing={editing}
                  toggleEditing={toggleEditing}
                  traversedNodes={[...newTraversedNodes]}
                />
              </Group>
            );
          }
          return null;
        })}
    </>
  );
};

const SingleAtom = ({
  atom,
  pos,
  hover,
  setHover,
  editing,
  toggleEditing,
}: SingleAtomProps) => {
  return (
    <Group
      key={atom.id}
      onMouseOver={() => {
        setHover(atom.id);
      }}
      onMouseOut={() => {
        setHover("");
      }}
    >
      <Circle
        x={pos.x}
        y={pos.y}
        radius={60}
        fill={hover === atom.id ? "yellow" : "transparent"}
      />
      <Text
        key={"text-" + atom.id}
        width={60}
        fontSize={80}
        text={atom.symbol}
        x={pos.x - 30}
        align="center"
        verticalAlign="middle"
        y={pos.y - 35}
        fontStyle={editing && atom.id === editing.id ? "bold" : "normal"}
        onClick={() => toggleEditing(atom.id, pos, atom)}
      />
    </Group>
  );
};

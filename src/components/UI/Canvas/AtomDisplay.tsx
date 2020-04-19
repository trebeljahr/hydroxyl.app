import React, { useState } from "react";
import { Text, Group, Circle } from "react-konva";
import { Atom, Hydrogen } from "../../../utils/Atoms";
import {
  Pos,
  EditingData,
  AtomDisplayProps,
  BondDirections,
  Bond,
} from "../../../types";
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
  const [hover, setHover] = useState("");
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
      />
      <Editing turnOffEditing={turnOffEditing} editing={editing} />
    </Group>
  );
};

interface AtomConnectionsProps {
  atom: Atom;
  pos: Pos;
  hover: string;
  setHover: (e: string) => void;
  showHydrogen: boolean;
  editing: EditingData;
  toggleEditing: (id: string, pos: Pos, molecule: Atom) => void;
  traversedNodes: string[];
}
const AtomConnections = ({
  atom,
  pos = { x: 350, y: 350 },
  hover,
  setHover,
  showHydrogen,
  editing,
  toggleEditing,
  traversedNodes,
}: AtomConnectionsProps): any => {
  const { x, y } = pos;
  const newTraversedNodes = [...traversedNodes, atom.id];
  return (
    <>
      <SingleAtom
        atom={atom}
        editing={editing}
        toggleEditing={toggleEditing}
        pos={pos}
        hover={hover}
        setHover={setHover}
      />
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
            newPos.x = newPos.x * 50 + x;
            newPos.y = newPos.y * 50 + y;
            if (newTraversedNodes.includes(connection.id)) {
              return null;
            }
            return (
              <Group key={connection.id}>
                {(showHydrogen || connection.name !== "Hydrogen") && (
                  <>
                    <BondLines
                      bond={bond}
                      k={k}
                      pos={{ oldPos: pos, newPos }}
                    />
                    <AtomConnections
                      atom={connection}
                      pos={newPos}
                      showHydrogen={showHydrogen}
                      setHover={setHover}
                      hover={hover}
                      editing={editing}
                      toggleEditing={toggleEditing}
                      traversedNodes={[...newTraversedNodes]}
                    />
                  </>
                )}
              </Group>
            );
          }
          return null;
        })}
    </>
  );
};

interface SingleAtomProps {
  atom: Atom;
  pos: Pos;
  hover: string;
  setHover: (e: string) => void;
  editing: EditingData;
  toggleEditing: (id: string, pos: Pos, molecule: Atom) => void;
}
const SingleAtom = ({
  atom,
  pos = { x: 350, y: 350 },
  hover,
  setHover,
  editing,
  toggleEditing,
}: SingleAtomProps) => {
  console.log(atom.name);
  console.log(atom.symbol);
  console.log(pos);
  return (
    <Group
      key={atom.id}
      onMouseOver={() => {
        console.log("Over", atom.id);
        setHover(atom.id);
      }}
      onMouseOut={() => {
        console.log("And Out");
        setHover("");
      }}
    >
      <Circle
        x={pos.x}
        y={pos.y}
        radius={20}
        fill={hover === atom.id ? "yellow" : "transparent"}
      />
      <Text
        key={"text-" + atom.id}
        text={atom.symbol}
        x={pos.x - 4}
        y={pos.y - 5}
        align="center"
        verticalAlign="middle"
        fontStyle={editing && atom.id === editing.id ? "bold" : "normal"}
        onClick={() => toggleEditing(atom.id, pos, atom)}
      />
    </Group>
  );
};

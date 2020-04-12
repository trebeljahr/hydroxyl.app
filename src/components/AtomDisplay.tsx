import React, { useState } from "react";
import { Text, Line } from "react-konva";
import { Carbon, Oxygen } from "../utils/Atoms";

interface Editing {
  on: boolean;
  id: string | null;
}
const initialEditing: Editing = { on: false, id: null };
interface AtomDisplayProps {
  showHydrogen: boolean;
}
const molecule = new Carbon({ childOf: null });
molecule.changeConnection(
  2,
  new Carbon({
    childOf: molecule,
    connectionOn: 4,
  })
);
molecule.changeConnection(
  1,
  new Carbon({
    childOf: molecule,
    connectionOn: 3,
  })
);
molecule.changeConnection(
  4,
  new Carbon({
    childOf: molecule,
    connectionOn: 2,
  })
);
molecule.connections[4].changeConnection(
  4,
  new Carbon({ childOf: molecule.connections[1], connectionOn: 2 })
);
molecule.connections[1].changeConnection(
  1,
  new Carbon({ childOf: molecule.connections[1], connectionOn: 3 })
);
molecule.changeConnection(
  3,
  new Oxygen({ childOf: molecule, connectionOn: 1 })
);

export const AtomDisplay = ({ showHydrogen }: AtomDisplayProps) => {
  const [editing, setEditing] = useState(initialEditing);

  const toggleEditing = (id: string) => {
    setEditing({ on: true, id });
  };
  const turnOffEditing = () => {
    setEditing(initialEditing);
  };

  const generateAtomChain = (atom: any, pos: any = { x: 350, y: 350 }): any => {
    const { x, y } = pos;
    if (atom.connections) {
      return Object.keys(atom.connections).map((k: any) => {
        const parentKey =
          atom.childOf && atom.connections[k].id === atom.childOf.id ? k : null;
        const key = parseInt(k);

        const positionOffset =
          atom.connections[key].type === "Hydrogen" ? 20 : 30;
        const newPos =
          key === 1
            ? { ...pos, x: x - positionOffset }
            : key === 2
            ? { ...pos, y: y - positionOffset }
            : key === 3
            ? { ...pos, x: x + positionOffset }
            : key === 4
            ? { ...pos, y: y + positionOffset }
            : pos;
        const editingPos =
          key === 1
            ? { x: newPos.x - positionOffset - 30, y: newPos.y - 5 }
            : key === 2
            ? { y: newPos.y - positionOffset - 10 }
            : key === 3
            ? { x: newPos.x + positionOffset - 10, y: newPos.y - 5 }
            : key === 4
            ? { y: newPos.y + positionOffset - 5 }
            : pos;
        const offset = 6;
        const oldOffset = -offset;
        const linePoints =
          key === 1
            ? [pos.x + oldOffset, pos.y, newPos.x + offset, newPos.y]
            : key === 2
            ? [pos.x, pos.y + oldOffset, newPos.x, newPos.y + offset]
            : key === 3
            ? [pos.x - oldOffset, pos.y, newPos.x - offset, newPos.y]
            : key === 4
            ? [pos.x, pos.y - oldOffset, newPos.x, newPos.y - offset]
            : [pos.x, pos.y, newPos.x, newPos.y];
        if (parentKey) {
          return null;
        }

        return (
          <>
            {showHydrogen || atom.connections[key].type !== "Hydrogen" ? (
              <>
                <Text
                  key={"text-" + atom.connections[key].id}
                  text={atom.connections[key].type[0]}
                  x={newPos.x - 4}
                  y={newPos.y - 5}
                  align="center"
                  verticalAlign="middle"
                  fontStyle={
                    editing && atom.connections[key].id === editing.id
                      ? "bold"
                      : "normal"
                  }
                  onClick={() => toggleEditing(atom.connections[key].id)}
                />
                {editing && atom.connections[key].id === editing.id ? (
                  <Text
                    onClick={turnOffEditing}
                    x={editingPos.x}
                    y={editingPos.y}
                    text={"Editing"}
                  />
                ) : null}
                <Line
                  key={"line-" + atom.connections[key].id}
                  points={linePoints}
                  fill={"black"}
                  stroke={"black"}
                />
              </>
            ) : null}
            {generateAtomChain(atom.connections[key], newPos)}
          </>
        );
      });
    }

    return null;
  };
  return (
    <>
      <Text text={molecule.type[0]} x={350 - 4} y={350 - 5} />
      {generateAtomChain(molecule)}
    </>
  );
};

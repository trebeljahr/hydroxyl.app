import React from "react";
import { Text, Line } from "react-konva";
import { Carbon } from "../utils/Atoms";
export const AtomDisplay = () => {
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
  const generateAtomChain = (atom: any, pos: any = { x: 350, y: 350 }): any => {
    const { x, y } = pos;
    if (atom.connections) {
      return Object.keys(atom.connections).map((k: any) => {
        const parentKey = atom.connections[k] === atom.childOf ? k : null;
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
          console.log(parentKey);
          return null;
        }
        return (
          <>
            <Text
              text={atom.connections[key].type[0]}
              x={newPos.x - 4}
              y={newPos.y - 5}
              align="center"
              verticalAlign="middle"
              onClick={() => console.log(atom.connections[key].type[0])}
            />
            <Line points={linePoints} fill={"black"} stroke={"black"} />
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

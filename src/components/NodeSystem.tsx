import React, { useState } from "react";
import { Line } from "react-konva";
import { Node } from "./Node";
import { Pos } from "../types";
import { AddNode } from "./AddNode";

export const NodeSystem = () => {
  const [pos, setPos] = useState([
    { x: 50, y: 50 },
    { x: 100, y: 100 },
  ]);
  const setNodePos = (i: number, newPos: Pos) => {
    setPos((old: Pos[]): Pos[] => {
      return old.map((pos, index) => (index === i ? newPos : pos));
    });
  };
  const addNode = (newPos: Pos) => {
    setPos((old: Pos[]) => {
      return [...old, newPos];
    });
  };
  return (
    <>
      {pos.map((position: Pos, i: number) => {
        return <Node setPos={(p: Pos) => setNodePos(i, p)} pos={position} />;
      })}
      <Line
        points={[pos[0].x, pos[0].y, pos[1].x, pos[1].y]}
        stroke="black"
        fill="black"
      />
      <AddNode addNode={addNode} />
    </>
  );
};

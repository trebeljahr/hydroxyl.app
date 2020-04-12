import React, { useState } from "react";
import { Line } from "react-konva";
import { Node } from "./Node";
import { Pos } from "../types";

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
  return (
    <>
      <Node setPos={(pos: Pos) => setNodePos(0, pos)} pos={pos[0]} />
      <Node setPos={(pos: Pos) => setNodePos(1, pos)} pos={pos[1]} />
      <Line
        points={[pos[0].x, pos[0].y, pos[1].x, pos[1].y]}
        stroke="black"
        fill="black"
      />
    </>
  );
};

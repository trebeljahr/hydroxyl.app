import React from "react";
import { Line } from "react-konva";
import { Bond, BondDirections, Pos } from "../types";

interface Positions {
  oldPos: Pos;
  newPos: Pos;
}
interface BondLinesProps {
  bond: Bond;
  k: BondDirections;
  pos: Positions;
}
const offsetLine = (
  { oldPos, newPos }: Positions,
  k: BondDirections
): LinePoints => {
  const offset = 6;
  const oldOffset = -offset;
  return k === BondDirections.left
    ? [oldPos.x + oldOffset, oldPos.y, newPos.x + offset, newPos.y]
    : k === BondDirections.up
    ? [oldPos.x, oldPos.y + oldOffset, newPos.x, newPos.y + offset]
    : k === BondDirections.right
    ? [oldPos.x - oldOffset, oldPos.y, newPos.x - offset, newPos.y]
    : k === BondDirections.down
    ? [oldPos.x, oldPos.y - oldOffset, newPos.x, newPos.y - offset]
    : [oldPos.x, oldPos.y, newPos.x, newPos.y];
};

type LinePoints = [number, number, number, number];
const doubleBondLine = (
  linePoints: LinePoints,
  offset: number,
  k: BondDirections
) => {
  return linePoints
    .map((val, i) => {
      return (k === BondDirections.up || k === BondDirections.down) &&
        (i === 0 || i === 2)
        ? val + offset
        : val;
    })
    .map((val, i) => {
      return (k === BondDirections.right || k === BondDirections.left) &&
        (i === 1 || i === 3)
        ? val + offset
        : val;
    });
};

export const BondLines = ({
  bond,
  k,
  pos: { oldPos, newPos },
}: BondLinesProps) => {
  const connection = bond?.atom;
  const linePoints = offsetLine({ oldPos, newPos }, k);
  const offset = 3;
  const rightTwoBondLine = doubleBondLine(linePoints, -offset, k);
  const leftTwoBondLine = doubleBondLine(linePoints, offset, k);
  return (
    <>
      {(bond.type === 1 || bond.type === 3) && (
        <Line
          key={"line1-" + connection.id}
          points={linePoints}
          fill={"black"}
          stroke={"black"}
        />
      )}
      {(bond.type === 2 || bond.type === 3) && (
        <>
          <Line
            key={"line2-" + connection.id}
            points={leftTwoBondLine}
            fill={"black"}
            stroke={"black"}
          />
          <Line
            key={"line3-" + connection.id}
            points={rightTwoBondLine}
            fill={"black"}
            stroke={"black"}
          />
        </>
      )}
    </>
  );
};

import React from "react";
import { Line, Group } from "react-konva";
import { BondDirections, Positions, BondLinesProps } from "../../../types";

const offsetLine = (
  { oldPos, newPos }: Positions,
  k: BondDirections
): LinePoints => {
  const offset = 50;
  const oldOffset = -offset;
  return k === BondDirections.left
    ? [oldPos.x + oldOffset, oldPos.y, newPos.x + offset, newPos.y]
    : k === BondDirections.up
    ? [oldPos.x, oldPos.y - oldOffset, newPos.x, newPos.y - offset]
    : k === BondDirections.right
    ? [oldPos.x - oldOffset, oldPos.y, newPos.x - offset, newPos.y]
    : k === BondDirections.down
    ? [oldPos.x, oldPos.y + oldOffset, newPos.x, newPos.y + offset]
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
  const offset = 0;
  const rightTwoBondLine = doubleBondLine(linePoints, -offset, k);
  const leftTwoBondLine = doubleBondLine(linePoints, offset, k);
  return (
    <Group>
      {(bond.type === 1 || bond.type === 3) && (
        <Line
          strokeWidth={10}
          key={"line1-" + connection.id}
          points={linePoints}
          fill={"black"}
          stroke={"black"}
        />
      )}
      {(bond.type === 2 || bond.type === 3) && (
        <>
          <Line
            strokeWidth={10}
            key={"line2-" + connection.id}
            points={leftTwoBondLine}
            fill={"black"}
            stroke={"black"}
          />
          <Line
            strokeWidth={10}
            key={"line3-" + connection.id}
            points={rightTwoBondLine}
            fill={"black"}
            stroke={"black"}
          />
        </>
      )}
    </Group>
  );
};

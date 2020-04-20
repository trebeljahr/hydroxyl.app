import React from "react";
import { Line, Group } from "react-konva";
import { doubleBondLine, offsetLine } from "./utils";
import { BondLinesProps, BondTypes } from "../../../../types";

export const NormalBonds = ({
  hover,
  setHover,
  bond,
  k,
  bondHighlight,
  pos: { oldPos, newPos },
}: BondLinesProps) => {
  const linePoints = offsetLine({ oldPos, newPos }, k);
  const offset = 0;
  const rightTwoBondLine = doubleBondLine(linePoints, -offset, k);
  const leftTwoBondLine = doubleBondLine(linePoints, offset, k);
  const handleClick = () => {
    console.log(bondHighlight);
    bond && bond.atom.changeBondType(bond.id, bondHighlight);
  };
  return (
    <Group
      onMouseOver={() => setHover(bond.id)}
      onMouseOut={() => setHover("")}
      onClick={handleClick}
    >
      <Line
        points={linePoints}
        strokeWidth={50}
        stroke={bond.id === hover ? "yellow" : "white"}
        lineCap="round"
      />
      {(bond.type === BondTypes.single || bond.type === BondTypes.triple) && (
        <Line
          strokeWidth={10}
          key={"line1-" + bond.id}
          points={linePoints}
          fill={"black"}
          stroke={"black"}
        />
      )}
      {(bond.type === BondTypes.double || bond.type === BondTypes.triple) && (
        <>
          <Line
            strokeWidth={10}
            key={"line2-" + bond.id}
            points={leftTwoBondLine}
            fill={"black"}
            stroke={"black"}
          />
          <Line
            strokeWidth={10}
            key={"line3-" + bond.id}
            points={rightTwoBondLine}
            fill={"black"}
            stroke={"black"}
          />
        </>
      )}
    </Group>
  );
};

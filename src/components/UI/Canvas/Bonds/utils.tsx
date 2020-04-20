import { BondDirections, Positions, LinePoints } from "../../../../types";

export const offsetLine = (
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

export const doubleBondLine = (
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

import { BondDirections, Bonds, BondTypes } from "../../types";

export const defaultBonds = (): Bonds => {
  return {
    [BondDirections.left]: null,
    [BondDirections.right]: null,
    [BondDirections.up]: null,
    [BondDirections.down]: null,
  };
};

export const electronsNeededBy = (bondType: BondTypes): number => {
  switch (bondType) {
    case BondTypes.double:
      return 2;
    case BondTypes.triple:
      return 3;
    case BondTypes.single:
    case BondTypes.wedge:
    case BondTypes.hash:
    case BondTypes.wave:
    default:
      return 1;
  }
};

export const opposite = (direction: BondDirections) => {
  switch (direction) {
    case BondDirections.left:
      return BondDirections.right;
    case BondDirections.right:
      return BondDirections.left;
    case BondDirections.up:
      return BondDirections.down;
    case BondDirections.down:
      return BondDirections.up;
  }
};

export const directionToAngle = (direction: BondDirections): number => {
  switch (direction) {
    case BondDirections.left:
      return 180;
    case BondDirections.right:
      return 0;
    case BondDirections.up:
      return 90;
    case BondDirections.down:
      return 270;
  }
};

export const trim = (str: String): String => str.replace(/\s+/g, "");

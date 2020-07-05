import { BondTypes } from "../../types";

export const electronsNeededBy = (bondType: string): number => {
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

export const trim = (str: String): String => str.replace(/\s+/g, "");

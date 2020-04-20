import React from "react";
import { BondLinesProps, BondTypes } from "../../../../types";
import { NormalBonds } from "./NormalBonds";
import { HashBond } from "./HashBond";
import { WedgeBond } from "./WedgeBond";
import { WaveBond } from "./WaveBond";

export const BondLines = ({ bond, k, pos }: BondLinesProps) => {
  switch (bond.type) {
    case BondTypes.single:
    case BondTypes.double:
    case BondTypes.triple:
      return <NormalBonds bond={bond} k={k} pos={pos} />;
    case BondTypes.hash:
      return <HashBond />;
    case BondTypes.wedge:
      return <WedgeBond />;
    case BondTypes.wave:
      return <WaveBond />;
  }
};

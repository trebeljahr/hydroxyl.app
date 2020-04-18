import React from "react";
import { createStyles, makeStyles, Theme } from "@material-ui/core/styles";
import Toolbar from "@material-ui/core/Toolbar";
import { BondButton } from "./BondButton";
import { littleBorderWidth } from "../../styles/styles";
import { v4 } from "uuid";
import { ReactComponent as singleBond } from "../../../images/svg/single-bond.svg";
import { ReactComponent as doubleBond } from "../../../images/svg/double-bond.svg";
import { ReactComponent as tripleBond } from "../../../images/svg/triple-bond.svg";
import { ReactComponent as hashBond } from "../../../images/svg/hash-bond.svg";
import { ReactComponent as wedgeBond } from "../../../images/svg/wedge-bond.svg";

import { ReactComponent as benzene } from "../../../images/svg/benzene.svg";
import { ReactComponent as carbonChain } from "../../../images/svg/carbon-chain.svg";
import { ReactComponent as cyclopentane } from "../../../images/svg/cyclopentane.svg";
import { ReactComponent as cyclohexane } from "../../../images/svg/cyclohexane.svg";
import { ReactComponent as cycloheptane } from "../../../images/svg/cycloheptane.svg";

const bonds = [
  singleBond,
  doubleBond,
  tripleBond,
  hashBond,
  wedgeBond,
  benzene,
  carbonChain,
  cyclopentane,
  cyclohexane,
  cycloheptane,
];

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    bondToolbar: {
      display: "flex",
      paddingTop: 0,
      margin: 0,
      padding: 0,
      paddingRight: `${littleBorderWidth}px`,
      zIndex: 2,
      height: "100%",
      flexDirection: "column",
      alignItems: "flexEnd",
      position: "relative",
    },
  })
);

interface BondsToolbarProps {
  setBond: (e: string) => void;
  bondHighlight: string;
}
export const BondsToolbar = ({ setBond, bondHighlight }: BondsToolbarProps) => {
  const classes = useStyles();
  return (
    <Toolbar className={classes.bondToolbar}>
      {bonds.map((bond) => {
        return (
          <BondButton
            key={`${v4()}-bondButton`}
            bondType={"-"}
            setBond={setBond}
            bondSvg={bond}
            bondHighlight={bondHighlight}
          />
        );
      })}
    </Toolbar>
  );
};

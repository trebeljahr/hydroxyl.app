import React from "react";
import { createStyles, makeStyles, Theme } from "@material-ui/core/styles";
import Toolbar from "@material-ui/core/Toolbar";
import { BondButton } from "./BondButton";
import { v4 } from "uuid";
import { ReactComponent as singleBond } from "../../../images/svg/single-bond.svg";
import { ReactComponent as doubleBond } from "../../../images/svg/double-bond.svg";
import { ReactComponent as tripleBond } from "../../../images/svg/triple-bond.svg";
import { ReactComponent as hashBond } from "../../../images/svg/hash-bond.svg";
import { ReactComponent as wedgeBond } from "../../../images/svg/wedge-bond.svg";
import { ReactComponent as waveBond } from "../../../images/svg/wave-bond.svg";

import { ReactComponent as benzene } from "../../../images/svg/benzene.svg";
import { ReactComponent as carbonChain } from "../../../images/svg/carbon-chain.svg";
import { ReactComponent as cyclopentane } from "../../../images/svg/cyclopentane.svg";
import { ReactComponent as cyclohexane } from "../../../images/svg/cyclohexane.svg";
import { ReactComponent as cycloheptane } from "../../../images/svg/cycloheptane.svg";
import { Typography } from "@material-ui/core";
import { BondsToolbarProps } from "../../../types";

const charge = (c: string) => () => (
  <Typography variant="h4" component="span">
    e<sup>{c}</sup>
  </Typography>
);
const bonds = [
  { svg: singleBond, tooltip: "Single Bond" },
  { svg: doubleBond, tooltip: "Double Bond" },
  { svg: tripleBond, tooltip: "Triple Bond" },
  { svg: hashBond, tooltip: "Hash Bond" },
  { svg: wedgeBond, tooltip: "Wedge Bond" },
  { svg: waveBond, tooltip: "Wave Bond" },
  { svg: benzene, tooltip: "Benzene" },
  { svg: carbonChain, tooltip: "Carbon Chain" },
  { svg: cyclopentane, tooltip: "Cyclopentane" },
  { svg: cyclohexane, tooltip: "Cyclohexane" },
  { svg: cycloheptane, tooltip: "Cycloheptane" },
  { svg: charge("+"), tooltip: "Add Charge" },
  { svg: charge("-"), tooltip: "Subtract Charge" },
];

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    bondToolbar: {
      display: "flex",
      paddingTop: 0,
      margin: 0,
      padding: 0,
      zIndex: 2,
      height: "100%",
      flexDirection: "column",
      alignItems: "flexEnd",
      position: "relative",
    },
  })
);

export const BondsToolbar = ({ setBond, bondHighlight }: BondsToolbarProps) => {
  const classes = useStyles();
  return (
    <Toolbar className={classes.bondToolbar}>
      {bonds.map((bond) => {
        return (
          <BondButton
            key={`${v4()}-bondButton`}
            setBond={setBond}
            bond={bond}
            bondHighlight={bondHighlight}
          />
        );
      })}
    </Toolbar>
  );
};

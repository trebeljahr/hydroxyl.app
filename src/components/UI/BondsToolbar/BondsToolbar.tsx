import React from "react";
import { createStyles, makeStyles, Theme } from "@material-ui/core/styles";
import Toolbar from "@material-ui/core/Toolbar";
import { BondButton } from "./BondButton";
import { littleBorderWidth } from "../../styles/styles";
import { v4 } from "uuid";

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
  const bondTypes = ["-", "=", "≡"];
  return (
    <Toolbar className={classes.bondToolbar}>
      {bondTypes.map((bondType) => {
        return (
          <BondButton
            key={`${v4()}-bondButton`}
            bondType={bondType}
            setBond={setBond}
            bondHighlight={bondHighlight}
          />
        );
      })}
    </Toolbar>
  );
};

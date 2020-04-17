import React from "react";
import { createStyles, makeStyles, Theme } from "@material-ui/core/styles";
import Toolbar from "@material-ui/core/Toolbar";

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    bondToolbar: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      backgroundColor: "yellow",
      position: "relative",
    },
    menuButton: {
      marginRight: theme.spacing(2),
    },
  })
);

interface BondsToolbarProps {
  stage: any;
  setBond: (e: string) => void;
}
export const BondsToolbar = ({ stage, setBond }: BondsToolbarProps) => {
  const classes = useStyles();

  return <Toolbar className={classes.bondToolbar}></Toolbar>;
};

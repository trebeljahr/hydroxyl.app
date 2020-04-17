import React from "react";
import { createStyles, makeStyles, Theme } from "@material-ui/core/styles";
import AppBar from "@material-ui/core/AppBar";
import Toolbar from "@material-ui/core/Toolbar";
import { SimpleMenu } from "./Menu";
import { HydrogenProps } from "../../../types";
import { ShowHydrogenButton } from "./ShowHydrogenButton";

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    root: {
      position: "relative",
      flexGrow: 1,
      gridColumn: "1/4",
      gridRow: 1,
    },
    menuButton: {
      marginRight: theme.spacing(2),
    },
    title: {
      flexGrow: 1,
    },
  })
);

interface ButtonAppBar extends HydrogenProps {
  stage: any;
}

export const ButtonAppBar = ({
  showHydrogen,
  setShowHydrogen,
  stage,
}: ButtonAppBar) => {
  const classes = useStyles();

  return (
    <div className={classes.root}>
      <AppBar position="static">
        <Toolbar>
          <ShowHydrogenButton
            showHydrogen={showHydrogen}
            setShowHydrogen={setShowHydrogen}
          />
          <SimpleMenu stage={stage} />
        </Toolbar>
      </AppBar>
    </div>
  );
};

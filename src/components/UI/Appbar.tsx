import React from "react";
import { createStyles, makeStyles, Theme } from "@material-ui/core/styles";
import AppBar from "@material-ui/core/AppBar";
import Toolbar from "@material-ui/core/Toolbar";
import Button from "@material-ui/core/Button";
import { SimpleMenu } from "./Menu";
import { ElementButtonStyles } from "./ElementButton";
import { Typography } from "@material-ui/core";
import { HydrogenProps } from "../../types";

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    root: {
      flexGrow: 1,
      gridColumn: "1/4",
      gridRow: 1,
      width: "100%",
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
          <Button color="inherit">Login</Button>
        </Toolbar>
      </AppBar>
    </div>
  );
};

export const ShowHydrogenButton = ({
  showHydrogen,
  setShowHydrogen,
}: HydrogenProps) => {
  const handleClick = () => {
    setShowHydrogen(!showHydrogen);
  };
  const classes = ElementButtonStyles(showHydrogen);

  return (
    <Button
      color="primary"
      className={classes.menuButton}
      onClick={handleClick}
    >
      <Typography variant="h6" component="span">
        {showHydrogen ? "Hide hydrogen" : "Show hydrogen"}
      </Typography>
    </Button>
  );
};

import React, { useState } from "react";
import { createStyles, makeStyles, Theme } from "@material-ui/core/styles";
import Toolbar from "@material-ui/core/Toolbar";
import { PeriodicSystem } from "./PeriodicSystem";

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    atomToolBar: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      backgroundColor: "green",
      position: "relative",
    },
    menuButton: {
      border: "none",
      backgroundColor: "white",
      color: "black",
      borderRadius: 100,
      width: 40,
      height: 40,
      lineHeight: 2.5,
      textAlign: "center",
      marginTop: 20,
      "&:focus": {
        backgroundColor: "rgb(200, 200, 200)",
        outline: "none",
      },
    },
  })
);

export const AtomToolBar = () => {
  const [highlight, setHighlight] = useState("");
  const [drawer, setDrawer] = useState(false);
  const classes = useStyles();
  const handleClick = (e: any) => {
    const symbol = e.target.textContent;
    setHighlight(symbol === highlight ? "" : symbol);
  };
  const openDrawer = () => {
    setDrawer(true);
  };
  const toggleDrawer = () => {
    setDrawer(!drawer);
  };
  const buttons = ["C", "H", "N", "0", "P", "S", "F", "Cl", "Br", "I"];
  return (
    <Toolbar className={classes.atomToolBar}>
      {buttons.map((symbol) => (
        <button className={classes.menuButton} onClick={handleClick}>
          {symbol}
        </button>
      ))}
      <button className={classes.menuButton} onClick={openDrawer}>
        ...
      </button>
      <PeriodicSystem drawer={drawer} toggleDrawer={toggleDrawer} />}
    </Toolbar>
  );
};

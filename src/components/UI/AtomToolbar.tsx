import React, { useState } from "react";
import { createStyles, makeStyles, Theme } from "@material-ui/core/styles";
import Toolbar from "@material-ui/core/Toolbar";
import { PeriodicSystem } from "../PeriodicTable/PeriodicSystem";
import { combinedPeriodicTable } from "../PeriodicTable/data/periodicTable";
import { Element } from "../PeriodicTable/types";
import { ElementButton, ElementButtonStyles } from "./ElementButton";
import { Button, Typography } from "@material-ui/core";

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    atomToolBar: {
      display: "flex",
      paddingRight: 0,
      paddingLeft: 3,
      height: "100%",
      flexDirection: "column",
      alignItems: "flexEnd",
      position: "relative",
    },
  })
);

interface AtomToolBarProps {
  highlight: string;
  setElement: (e: string) => void;
}
export const AtomToolBar = ({ highlight, setElement }: AtomToolBarProps) => {
  const [drawer, setDrawer] = useState(false);
  const classes = useStyles();

  const openDrawer = () => {
    setDrawer(true);
  };
  const toggleDrawer = () => {
    setDrawer(!drawer);
  };
  let defaultElements = ["C", "H", "N", "O", "P", "S", "F", "Cl", "Br", "I"];
  if (highlight && !defaultElements.includes(highlight)) {
    defaultElements[defaultElements.length - 1] = highlight;
  }
  const elements: Element[] = defaultElements.reduce(
    (agg: Element[], symbol: string) => {
      const element: Element | undefined = Object.values(
        combinedPeriodicTable
      ).find((e: Element) => {
        return e.symbol === symbol;
      });
      if (element) {
        return [...agg, element];
      }
      return agg;
    },
    []
  );
  return (
    <Toolbar className={classes.atomToolBar}>
      {elements.map((e: Element) => {
        return (
          <ElementButton
            setElement={setElement}
            element={e}
            highlight={highlight}
          />
        );
      })}
      <OpenDrawerButton openDrawer={openDrawer} />
      <PeriodicSystem
        drawer={drawer}
        toggleDrawer={toggleDrawer}
        setElement={setElement}
      />
    </Toolbar>
  );
};

interface ButtonDrawerProps {
  openDrawer: () => void;
}
const OpenDrawerButton = ({ openDrawer }: ButtonDrawerProps) => {
  const classes = ElementButtonStyles(false);
  return (
    <Button
      key={"...-button"}
      color="primary"
      className={classes.menuButton}
      onClick={openDrawer}
    >
      <Typography variant="h4" component="span">
        ...
      </Typography>
    </Button>
  );
};

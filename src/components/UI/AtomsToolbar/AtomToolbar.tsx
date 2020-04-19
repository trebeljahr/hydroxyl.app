import React, { useState } from "react";
import { createStyles, makeStyles, Theme } from "@material-ui/core/styles";
import Toolbar from "@material-ui/core/Toolbar";
import { PeriodicSystem } from "../PeriodicTable/PeriodicSystem";
import { combinedPeriodicTable } from "../PeriodicTable/data/periodicTable";
import { Element } from "../PeriodicTable/types";
import { ElementButton } from "./ElementButton";
import { OpenDrawerButton } from "./DrawerButton";
import { v4 } from "uuid";
import { AtomToolBarProps } from "../../../types";

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    atomToolBar: {
      display: "flex",
      zIndex: 2,
      margin: 0,
      padding: 0,
      height: "100%",
      flexDirection: "column",
      alignItems: "flexEnd",
      position: "relative",
    },
  })
);

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
            key={`${v4()}-elementButton`}
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

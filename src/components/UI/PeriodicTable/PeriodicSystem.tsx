import React from "react";
import {
  Drawer,
  createStyles,
  makeStyles,
  Theme,
  Fab,
} from "@material-ui/core";
import { SingleElement } from "./SingleElement";
import { combinedPeriodicTable } from "./data/periodicTable";
import { Element } from "./types";

interface PeriodicSystemProps {
  drawer: boolean;
  toggleDrawer: () => void;
  setElement: (symbol: string) => void;
}

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    periodicTable: {
      margin: 20,
      width: "80vw",
      height: "60vh",
      display: "grid",
      gridTemplateColumns: "repeat(18, 1fr)",
      gridTemplateRows: "repeat(10, 1fr)",
    },
    periodicTableContainer: {
      height: "100vh",
      width: "100vw",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
    },
    closeButton: {
      border: "none",
      color: "black",
      position: "absolute",
      top: "3vh",
      right: "3vh",
    },
  })
);
export const PeriodicSystem = ({
  drawer,
  toggleDrawer,
  setElement,
}: PeriodicSystemProps) => {
  const anchor = "right";
  const classes = useStyles();

  return (
    <Drawer
      anchor={anchor}
      open={drawer}
      onClose={toggleDrawer}
      transitionDuration={500}
    >
      <div className={classes.periodicTableContainer}>
        <Fab className={classes.closeButton} onClick={toggleDrawer}>
          X
        </Fab>
        <div className={classes.periodicTable}>
          {Object.values(combinedPeriodicTable).map((e: any) => {
            const element = e as Element;
            return (
              <SingleElement
                key={element.symbol}
                element={element}
                toggleDrawer={toggleDrawer}
                setElement={setElement}
              />
            );
          })}
        </div>
      </div>
    </Drawer>
  );
};

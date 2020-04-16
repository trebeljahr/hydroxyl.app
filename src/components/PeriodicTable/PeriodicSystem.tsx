import React from "react";
import {
  SwipeableDrawer,
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
}: PeriodicSystemProps) => {
  const anchor = "right";
  const classes = useStyles();
  return (
    <SwipeableDrawer
      anchor={anchor}
      open={drawer}
      onClose={toggleDrawer}
      onOpen={toggleDrawer}
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
              />
            );
          })}
        </div>
      </div>
    </SwipeableDrawer>
  );
};

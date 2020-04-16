import React from "react";
import {
  SwipeableDrawer,
  createStyles,
  makeStyles,
  Theme,
} from "@material-ui/core";
import { combinedPeriodicTable as periodicTable } from "../../data/periodicTable";
import { SingleElement } from "./SingleElement";

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
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
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
        <div className={classes.periodicTable}>
          {Object.values(periodicTable).map((element) => {
            return <SingleElement element={element} />;
          })}
        </div>
      </div>
    </SwipeableDrawer>
  );
};

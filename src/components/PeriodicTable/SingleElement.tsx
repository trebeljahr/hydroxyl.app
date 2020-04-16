import React from "react";
import { makeStyles } from "@material-ui/core";
import { Element } from "./types";

const useStyles = makeStyles({
  text: (element: Element) => ({
    color: "inherit",
    fontWeight: "bold",
  }),
  singleElement: (element: Element) => ({
    position: "relative",
    cursor: "pointer",
    outline: "none",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gridRow: element.posX,
    gridColumn: element.posY,
    backgroundColor: element.color,
    marginRight: "-1px",
    marginBottom: "-1px",
    border: "1px white solid",
    color: "black",
    "&::before": {
      content: `""`,
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: -1,
      boxShadow:
        "0px 3px 5px -1px rgba(0,0,0,0.2), 0px 6px 10px 0px rgba(0,0,0,0.14), 0px 1px 18px 0px rgba(0,0,0,0.12)",
    },
    "&:hover": {
      color: "#555555",
      backgroundColor: "white",
    },
  }),
  elementNumber: {
    fontSize: "10px",
    position: "absolute",
    top: "3px",
    left: "3px",
    margin: "0px",
  },
});

export const SingleElement = ({ element }: any) => {
  const classes = useStyles(element);
  return (
    <div className={classes.singleElement}>
      <p className={classes.elementNumber}>{element.id}</p>
      <h2 className={classes.text}>{element.symbol}</h2>
    </div>
  );
};

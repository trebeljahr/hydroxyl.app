import React from "react";
import { makeStyles } from "@material-ui/core";

const useStyles = makeStyles({
  text: (element: any) => ({ color: "black", fontWeight: "bold" }),
  singleElement: (element: any) => ({
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
    "&:hover": {
      backgroundColor: "rgb(200,200,200)",
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

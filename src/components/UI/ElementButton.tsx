import React from "react";
import { Element } from "../PeriodicTable/types";
import { makeStyles, Typography, Button } from "@material-ui/core";

const orange = "rgb(255, 200, 150)";
const darkOrange = "rgb(200, 60, 20)";
export const ElementButtonStyles = makeStyles({
  menuButton: (selected: boolean) => ({
    textTransform: "none",
    border: "none",
    backgroundColor: selected ? orange : "white",
    color: "black",
    borderRadius: 0,
    "&::before": {
      content: `""`,
      position: "absolute",
      top: 0,
      bottom: 0,
      left: selected ? -5 : 0,
      right: 0,
      zIndex: -1,
      boxShadow:
        "0px 3px 5px -1px rgba(0,0,0,0.2), 0px 6px 10px 0px rgba(0,0,0,0.14), 0px 1px 18px 0px rgba(0,0,0,0.12)",
      borderLeft: selected ? `5px solid ${darkOrange}` : "none",
    },
    "&:hover": {
      backgroundColor: selected ? orange : "rgb(230, 230, 230)",
      color: "black",
      "&::before": {
        content: `""`,
        position: "absolute",
        top: 0,
        bottom: 0,
        left: selected ? -5 : -5,
        right: 0,
        borderLeft: selected
          ? `5px solid ${darkOrange}`
          : "5px solid rgb(100, 100, 100)",
      },
    },
  }),
});
export const ElementButton = ({
  element,
  setElement,
  highlight,
}: {
  element: Element;
  setElement: (e: string) => void;
  highlight: string;
}) => {
  const selected = highlight ? element.symbol === highlight : false;
  const classes = ElementButtonStyles(selected);
  return (
    <Button
      key={element.symbol}
      color="primary"
      className={classes.menuButton}
      onClick={() => setElement(element.symbol)}
    >
      <Typography variant="h4" component="span">
        {element.symbol}
      </Typography>
    </Button>
  );
};

import React from "react";
import { Element } from "../PeriodicTable/types";
import { Typography, Button } from "@material-ui/core";
import { ButtonStyle } from "../../styles/styles";

export interface ElementButtonProps {
  element: Element;
  setElement: (e: string) => void;
  highlight: string;
}

export const ElementButton = ({
  element,
  setElement,
  highlight,
}: ElementButtonProps) => {
  const selected = highlight ? element.symbol === highlight : false;
  const classes = ButtonStyle(selected);
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

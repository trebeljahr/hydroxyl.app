import React from "react";
import { Typography, Button } from "@material-ui/core";
import { ButtonStyle } from "../../styles/styles";
import { ElementButtonProps } from "../../../types";

export const ElementButton = ({
  element,
  setElement,
  highlight,
}: ElementButtonProps) => {
  const selected = highlight ? element.symbol === highlight : false;
  const classes = ButtonStyle({ selected, direction: "left" });
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

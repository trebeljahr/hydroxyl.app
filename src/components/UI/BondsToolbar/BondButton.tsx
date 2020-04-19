import React from "react";
import { ButtonStyle } from "../../styles/styles";
import { Button } from "@material-ui/core";
import { BondButtonProps } from "../../../types";

export const BondButton = ({
  bond,
  setBond,
  bondHighlight,
}: BondButtonProps) => {
  const selected = bond.tooltip === bondHighlight;
  const classes = ButtonStyle({ selected, direction: "right" });
  const handleClick = () => {
    setBond(selected ? "" : bond.tooltip);
  };
  const Svg = bond.svg;
  return (
    <Button
      color="primary"
      className={classes.menuButton + " tooltip"}
      onClick={handleClick}
    >
      <span className="tooltiptext">{bond.tooltip}</span>
      <Svg />
    </Button>
  );
};

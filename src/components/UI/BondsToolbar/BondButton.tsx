import React from "react";
import { ButtonStyle } from "../../styles/styles";
import { Button, SvgIcon } from "@material-ui/core";
import { BondButtonProps } from "../../../types";

export const BondButton = ({
  bondType,
  bondSvg,
  setBond,
  bondHighlight,
}: BondButtonProps) => {
  const selected = bondType === bondHighlight;
  const classes = ButtonStyle({ selected, direction: "right" });
  const handleClick = () => {
    setBond(selected ? "" : bondType);
  };
  return (
    <Button
      color="primary"
      className={classes.menuButton}
      onClick={handleClick}
    >
      <SvgIcon component={bondSvg} viewBox="0 0 600 476.6" />
    </Button>
  );
};

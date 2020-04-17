import React from "react";
import { ButtonStyle } from "../../styles/styles";
import { Button, Typography } from "@material-ui/core";
import { BondButtonProps } from "../../../types";

export const BondButton = ({
  bondType,
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
      <Typography variant="h4" component="span">
        {bondType}
      </Typography>
    </Button>
  );
};

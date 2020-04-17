import React from "react";
import { Button, Typography } from "@material-ui/core";
import { ButtonStyle } from "../../styles/styles";
import { ButtonDrawerProps } from "../../../types";

export const OpenDrawerButton = ({ openDrawer }: ButtonDrawerProps) => {
  const classes = ButtonStyle(false);
  return (
    <Button
      key={"...-button"}
      color="primary"
      className={classes.menuButton}
      onClick={openDrawer}
    >
      <Typography variant="h4" component="span">
        ...
      </Typography>
    </Button>
  );
};

import React from "react";
import { HydrogenProps } from "../../../types";
import { Button, Typography } from "@material-ui/core";
import { ButtonStyle } from "../../styles/styles";

export const ShowHydrogenButton = ({
  showHydrogen,
  setShowHydrogen,
}: HydrogenProps) => {
  const handleClick = () => {
    setShowHydrogen(!showHydrogen);
  };
  const classes = ButtonStyle(showHydrogen);

  return (
    <Button
      color="primary"
      className={classes.menuButton}
      onClick={handleClick}
    >
      <Typography variant="h6" component="span">
        {showHydrogen ? "Hide hydrogen" : "Show hydrogen"}
      </Typography>
    </Button>
  );
};

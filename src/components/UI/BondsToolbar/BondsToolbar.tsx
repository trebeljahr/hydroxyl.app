import React from "react";
import { createStyles, makeStyles, Theme } from "@material-ui/core/styles";
import Toolbar from "@material-ui/core/Toolbar";
import { Button, Typography } from "@material-ui/core";
import { ButtonStyle } from "../../styles/styles";

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    bondToolbar: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      backgroundColor: "yellow",
      position: "relative",
    },
    menuButton: {
      marginRight: theme.spacing(2),
    },
  })
);

interface BondsToolbarProps {
  setBond: (e: string) => void;
  bondHighlight: string;
}
export const BondsToolbar = ({ setBond, bondHighlight }: BondsToolbarProps) => {
  const classes = useStyles();
  const bondTypes = ["-", "=", "≡"];
  return (
    <Toolbar className={classes.bondToolbar}>
      {bondTypes.map((bondType) => {
        return (
          <BondButton
            bondType={bondType}
            setBond={setBond}
            bondHighlight={bondHighlight}
          />
        );
      })}
    </Toolbar>
  );
};

interface BondButtonProps {
  bondType: string;
  bondHighlight: string;
  setBond: (e: string) => void;
}

const BondButton = ({ bondType, setBond, bondHighlight }: BondButtonProps) => {
  const selected = bondType === bondHighlight;
  const classes = ButtonStyle(selected);
  const handleClick = () => {
    setBond(selected ? "" : bondType);
  };
  return (
    <Button
      key={`${bondType}-bond`}
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

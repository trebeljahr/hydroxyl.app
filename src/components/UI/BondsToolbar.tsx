import React, { useState } from "react";
import { createStyles, makeStyles, Theme } from "@material-ui/core/styles";
import Toolbar from "@material-ui/core/Toolbar";
import { PDF_BUTTON } from "../PDF_Button";

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    atomToolBar: {
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

export const BondsToolbar = ({ stage }: any) => {
  const [showHydrogen, setShowHydrogen] = useState(true);

  const classes = useStyles();

  return (
    <Toolbar className={classes.atomToolBar}>
      <button onClick={() => setShowHydrogen(!showHydrogen)}>
        {showHydrogen ? "Hide hydrogen" : "Show hydrogen"}
      </button>
      {stage && <PDF_BUTTON stage={stage} />}
    </Toolbar>
  );
};

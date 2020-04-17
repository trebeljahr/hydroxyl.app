import React, { useState } from "react";
import "./App.css";
import Canvas from "./components/Canvas";
import { ButtonAppBar } from "./components/UI/Appbar";
import { Box, makeStyles, createStyles, Theme } from "@material-ui/core";
import { AtomToolBar } from "./components/UI/AtomToolbar";
import { BondsToolbar } from "./components/UI/BondsToolbar";

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    root: {
      width: "100vw",
      height: "100vh",
      overflow: "hidden",
    },
    container: {
      width: "100%",
      maxWidth: "100vw",
      height: "100%",
      display: "flex",
    },
  })
);

function App() {
  const [stage, setStage] = useState(null);
  const [atomHighlight, setAtomHighlight] = useState("");
  const [bondHighlight, setBondHighlight] = useState("");
  const [showHydrogen, setShowHydrogen] = useState(true);

  const classes = useStyles();
  const setElement = (symbol: string) => {
    setAtomHighlight(symbol === atomHighlight ? "" : symbol);
    setBondHighlight("");
  };
  const setBond = (symbol: string) => {
    setBondHighlight(symbol === bondHighlight ? "" : symbol);
    setAtomHighlight("");
  };

  return (
    <Box className={classes.root}>
      <ButtonAppBar
        stage={stage}
        showHydrogen={showHydrogen}
        setShowHydrogen={setShowHydrogen}
      />
      <Box className={classes.container}>
        <BondsToolbar stage={stage} setBond={setBond} />
        <Canvas
          stage={stage}
          setStage={setStage}
          showHydrogen={showHydrogen}
          atomHighlight={atomHighlight}
          bondHighlight={bondHighlight}
        />
        <AtomToolBar highlight={atomHighlight} setElement={setElement} />
      </Box>
    </Box>
  );
}

export default App;

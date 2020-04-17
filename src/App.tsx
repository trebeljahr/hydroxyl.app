import React, { useState } from "react";
import "./App.css";
import Canvas from "./components/UI/Canvas/Canvas";
import { ButtonAppBar } from "./components/UI/Navbar/Appbar";
import { Box, makeStyles, createStyles, Theme } from "@material-ui/core";
import { AtomToolBar } from "./components/UI/AtomsToolbar/AtomToolbar";
import { BondsToolbar } from "./components/UI/BondsToolbar/BondsToolbar";

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    root: {
      display: "grid",
      gridTemplateRows: "auto auto",
      gridTemplateColumns: "1fr 20fr 1fr",
      width: "100vw",
      height: "100vh",
      overflow: "hidden",
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
      <BondsToolbar setBond={setBond} bondHighlight={bondHighlight} />
      <Canvas
        stage={stage}
        setStage={setStage}
        showHydrogen={showHydrogen}
        atomHighlight={atomHighlight}
        bondHighlight={bondHighlight}
      />
      <AtomToolBar highlight={atomHighlight} setElement={setElement} />
    </Box>
  );
}

export default App;

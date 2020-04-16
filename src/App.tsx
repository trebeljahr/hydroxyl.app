import React, { useState } from "react";
import "./App.css";
import Canvas from "./components/Canvas";
import ButtonAppBar from "./components/UI/Appbar";
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

  const classes = useStyles();

  return (
    <Box className={classes.root}>
      <ButtonAppBar />
      <Box className={classes.container}>
        <BondsToolbar stage={stage} />
        <Canvas stage={stage} setStage={setStage} />
        <AtomToolBar />
      </Box>
    </Box>
  );
}

export default App;

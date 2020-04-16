import React, { useRef, useEffect } from "react";
import { Layer, Stage } from "react-konva";
import { KonvaEventObject } from "konva/types/Node";
import { AtomDisplay } from "./AtomDisplay";
import { makeStyles, createStyles, Theme } from "@material-ui/core";

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    root: {
      width: "90%",
      maxWidth: "90%",
      overflow: "hidden",
      height: "100%",
    },
  })
);

const Canvas = ({ stage, setStage }: any) => {
  const stageRef: any = useRef();

  const zoom = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const s = stageRef.current;

    const scaleBy = 1.02;
    const oldScale = s.scaleX();
    const mousePointTo = {
      x: s.getPointerPosition().x / oldScale - s.x() / oldScale,
      y: s.getPointerPosition().y / oldScale - s.y() / oldScale,
    };

    const newScale = e.evt.deltaY > 0 ? oldScale * scaleBy : oldScale / scaleBy;
    s.scale({ x: newScale, y: newScale });

    const newPos = {
      x: -(mousePointTo.x - s.getPointerPosition().x / newScale) * newScale,
      y: -(mousePointTo.y - s.getPointerPosition().y / newScale) * newScale,
    };
    s.position(newPos);
    s.batchDraw();
  };

  useEffect(() => {
    setStage(stageRef.current);
  }, [setStage]);

  const classes = useStyles();
  return (
    <div className={classes.root}>
      <Stage
        style={{ backgroundColor: "white" }}
        draggable
        width={window.innerWidth}
        height={window.innerHeight}
        ref={stageRef}
        onWheel={zoom}
      >
        <Layer>
          <AtomDisplay showHydrogen={true} />
        </Layer>
      </Stage>
    </div>
  );
};

export default Canvas;

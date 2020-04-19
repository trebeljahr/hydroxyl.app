import React, { useRef, useEffect, useState } from "react";
import { Layer, Stage } from "react-konva";
import { KonvaEventObject } from "konva/types/Node";
import { AtomDisplay } from "./AtomDisplay";
import { makeStyles, createStyles, Theme } from "@material-ui/core";
import { combinedPeriodicTable } from "../PeriodicTable/data/periodicTable";
import { Atom, Carbon } from "../../../utils/Atoms";
import { CanvasProps } from "../../../types";
import { getRelativePosition } from "../../../utils/relativePosition";
import { v4 } from "uuid";

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    root: {
      width: "100%",
      overflow: "hidden",
      height: "100%",
      gridRow: 2,
      gridColumn: 2,
    },
  })
);

export const defaultMolecule = new Carbon() as Atom;

const Canvas = ({
  stage,
  setStage,
  showHydrogen,
  atomHighlight,
  bondHighlight,
}: CanvasProps) => {
  const [molecules, setMolecules] = useState([
    { atom: defaultMolecule, pos: { x: 350, y: 350 } },
  ]);
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

  const handleClick = () => {
    if (atomHighlight !== "") {
      const element = Object.values(combinedPeriodicTable).find(
        (element) => element.symbol === atomHighlight
      );
      if (element) {
        const s = stageRef.current;
        const { name, maxBonds, symbol } = element;
        const newAtom = new Atom({ name, maxBonds, symbol });
        setMolecules([
          ...molecules,
          { atom: newAtom, pos: getRelativePosition(s) },
        ]);
      }
    }
  };
  return (
    <div className={classes.root}>
      <Stage
        style={{ backgroundColor: "white" }}
        draggable
        width={window.innerWidth}
        height={window.innerHeight}
        ref={stageRef}
        onWheel={zoom}
        onClick={handleClick}
      >
        <Layer>
          {molecules.map((molecule) => (
            <AtomDisplay
              key={`${v4()}-atomDisplay`}
              molecule={molecule.atom}
              showHydrogen={showHydrogen}
              pos={molecule.pos}
            />
          ))}
        </Layer>
      </Stage>
    </div>
  );
};

export default Canvas;

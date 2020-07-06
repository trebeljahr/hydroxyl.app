import React, { useRef, useEffect, useState } from "react";
import { Layer, Stage, Line } from "react-konva";
import { KonvaEventObject } from "konva/types/Node";
import { AtomDisplay } from "./AtomDisplay";
import { makeStyles, createStyles, Theme } from "@material-ui/core";
import { combinedPeriodicTable } from "../PeriodicTable/data/periodicTable";
import { Atom } from "../../../utils/Atoms/Atom";
import { CanvasProps } from "../../../types";
import { getRelativePosition } from "../../../utils/relativePosition";
import { v4 } from "uuid";
import {
  origin,
  getVectorBetweenPoints,
  getRightAngleVector,
  addVector,
} from "../../../utils/Atoms/utils";
import { Carbon } from "../../../utils/Atoms/elements";

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

export const defaultMolecule: Atom = new Carbon(origin());

export const Canvas = ({
  stage,
  setStage,
  showHydrogen,
  atomHighlight,
  bondHighlight,
}: CanvasProps) => {
  const stageRef: any = useRef();
  const [stageContainer, setStageContainer] = useState();
  const stageContainerRef: any = useRef();
  const [molecules, setMolecules] = useState([defaultMolecule]);
  const [hover, setHover] = useState("");

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
    setStageContainer(stageContainerRef.current);
  }, []);

  useEffect(() => {
    if (stageRef.current) {
      setStage(stageRef.current);
      setMolecules([defaultMolecule]);
    }
  }, [stageContainer, setStage]);

  const classes = useStyles();

  const handleClick = () => {
    const s = stageRef.current;
    const pos = getRelativePosition(s);
    if (atomHighlight !== "") {
      const foundElement = Object.values(combinedPeriodicTable).find(
        (element) => element.symbol === atomHighlight
      );
      if (foundElement) {
        const { name, maxBonds, symbol } = foundElement;
        const newAtom = new Atom({
          name,
          maxBonds,
          symbol,
          pos,
        });
        setMolecules([...molecules, newAtom]);
      }
    }
  };

  const v1 = { x: 0, y: 100 };
  const v2 = { x: 0, y: 100 };
  const lineVector = getVectorBetweenPoints(v1, v2);
  const linePoints = [0, lineVector.x, 0, lineVector.y];
  console.log(lineVector);
  const r2 = getRightAngleVector(v2);
  // const v3 = addVector(rightAngle, v2);
  // const v4 = addVector(rightAngle, v1);
  const rightAngleLine = [r2.x, v2.x, r2.y, v2.y];
  return (
    <div className={classes.root} ref={stageContainerRef}>
      {stageContainerRef.current && (
        <Stage
          style={{ backgroundColor: "white" }}
          draggable
          width={stageContainerRef?.current?.clientWidth}
          height={stageContainerRef?.current?.clientHeight}
          ref={stageRef}
          onWheel={zoom}
          onClick={handleClick}
        >
          <Layer>
            <Line
              points={linePoints}
              strokeWidth={5}
              stroke={"black"}
              lineCap="round"
            />
            <Line
              points={rightAngleLine}
              strokeWidth={5}
              stroke={"black"}
              lineCap="round"
            />
            {/* {molecules.map((molecule) => (
              <AtomDisplay
                bondHighlight={bondHighlight}
                key={`${v4()}-atomDisplay`}
                molecule={molecule}
                showHydrogen={showHydrogen}
                hover={hover}
                setHover={setHover}
                pos={molecule.pos}
              />
            ))} */}
          </Layer>
        </Stage>
      )}
    </div>
  );
};

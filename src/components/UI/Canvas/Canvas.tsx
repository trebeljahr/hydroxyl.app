import React, { useRef, useEffect, useState } from "react";
import { Layer, Stage } from "react-konva";
import { KonvaEventObject } from "konva/types/Node";
import { AtomDisplay } from "./AtomDisplay";
import { makeStyles, createStyles, Theme } from "@material-ui/core";
import { combinedPeriodicTable } from "../PeriodicTable/data/periodicTable";
import { Atom } from "../../../utils/Atoms/Atom";
import { CanvasProps } from "../../../types";
import { getRelativePosition } from "../../../utils/relativePosition";
import { v4 } from "uuid";
import { changeMoleculeRoot, Molecule, addMolecule } from "../../../actions";

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

export const Canvas = ({
  stage,
  setStage,
  showHydrogen,
  atomHighlight,
  bondHighlight,
  ...props
}: CanvasProps) => {
  const stageRef: any = useRef();
  const [stageContainer, setStageContainer] = useState();
  const stageContainerRef: any = useRef();
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
      props.store.dispatch(
        changeMoleculeRoot(props.store.molecules[0], {
          x: stageRef.current.width() / 2,
          y: stageRef.current.height() / 2,
        })
      );
    }
  }, [stageContainer, setStage, props.store]);

  const classes = useStyles();

  const handleClick = () => {
    if (atomHighlight !== "") {
      const element = Object.values(combinedPeriodicTable).find(
        (element) => element.symbol === atomHighlight
      );
      if (element) {
        const s = stageRef.current;
        const { name, maxBonds, symbol } = element;
        const newRoot = new Atom({ name, maxBonds, symbol });
        props.store.dispatch(addMolecule(newRoot, getRelativePosition(s)));
      }
    }
  };
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
            {props.store.molecules.map((molecule: Molecule) => (
              <AtomDisplay
                bondHighlight={bondHighlight}
                key={`${v4()}-atomDisplay`}
                molecule={molecule.root}
                showHydrogen={showHydrogen}
                hover={hover}
                setHover={setHover}
                pos={molecule.pos}
              />
            ))}
          </Layer>
        </Stage>
      )}
    </div>
  );
};

import React, { useRef, useEffect, useState } from "react";
import { Layer, Stage } from "react-konva";
import { KonvaEventObject } from "konva/types/Node";
import { AtomDisplay } from "./AtomDisplay";
import { makeStyles, createStyles, Theme } from "@material-ui/core";
import { combinedPeriodicTable } from "../PeriodicTable/data/periodicTable";
import { Atom } from "../../../utils/Atoms/Atom";
import { CanvasProps, BondTypes } from "../../../types";
import { getRelativePosition } from "../../../utils/relativePosition";
import { v4 } from "uuid";
import { Carbon } from "../../../utils/Atoms/elements";
import { Coordinates } from "../../../utils/functionalAtoms";

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

export const origin = (): Coordinates => {
  return { x: 0, y: 0 };
};

export function makeCarbonChain(length: number): Atom {
  let chain = new Carbon(origin());
  for (let i = 0; i < length - 1; i++) {
    chain = addCarbon(chain, BondTypes.single);
  }
  return chain;
}

export function addCarbon(molecule: Atom, bondType: BondTypes) {
  const secondCarbon = new Carbon(origin());
  const newBond = {
    id: v4(),
    type: bondType,
    atom: secondCarbon,
    angle: 0,
  };
  molecule.changeBond(newBond);
  const index1 = molecule.findBondIndex(secondCarbon.id);
  const bondedAtom = molecule.bonds[index1].atom;
  return bondedAtom;
}

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
            {molecules.map((molecule) => (
              <AtomDisplay
                bondHighlight={bondHighlight}
                key={`${v4()}-atomDisplay`}
                molecule={molecule}
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

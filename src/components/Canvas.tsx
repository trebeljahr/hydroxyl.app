import React, { useRef, useEffect, useState } from "react";
import { Layer, Stage } from "react-konva";
import { KonvaEventObject } from "konva/types/Node";
import { PDF_BUTTON } from "./PDF_Button";
import { AtomDisplay } from "./AtomDisplay";

const Canvas = () => {
  const [showHydrogen, setShowHydrogen] = useState(true);
  const [stage, setStage] = useState(null);
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
  }, []);
  return (
    <>
      <button onClick={() => setShowHydrogen(!showHydrogen)}>
        {showHydrogen ? "Hide hydrogen" : "Show hydrogen"}
      </button>
      <Stage
        style={{ backgroundColor: "white" }}
        draggable
        width={700}
        height={700}
        ref={stageRef}
        onWheel={zoom}
      >
        <Layer>
          <AtomDisplay showHydrogen={showHydrogen} />
        </Layer>
      </Stage>
      {stage && <PDF_BUTTON stage={stageRef.current} />}
    </>
  );
};

export default Canvas;

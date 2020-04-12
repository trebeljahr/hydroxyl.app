import React, { useRef } from "react";
import { Layer, Stage } from "react-konva";
import { NodeSystem } from "./NodeSystem";
import { KonvaEventObject } from "konva/types/Node";

const Canvas = () => {
  const stageRef: any = useRef();
  const zoom = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const scaleBy = 1.04;
    const s = stageRef.current;
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

  return (
    <Stage
      style={{ backgroundColor: "white" }}
      draggable
      width={700}
      height={700}
      ref={stageRef}
      onWheel={zoom}
    >
      <Layer>
        <NodeSystem />
      </Layer>
    </Stage>
  );
};

export default Canvas;

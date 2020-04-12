import React, { useState } from "react";
import { Circle } from "react-konva";
import { KonvaEventObject } from "konva/types/Node";
import { Pos } from "../types";

interface NodeProps {
  setPos: (pos: Pos) => void;
  pos: Pos;
}
export const Node = ({ setPos, pos }: NodeProps) => {
  const [dragging, setDragging] = useState(false);
  const startDragging = () => setDragging(true);
  const endDragging = ({ target }: KonvaEventObject<DragEvent>) => {
    setDragging(false);
    setPos({ x: target.x(), y: target.y() });
  };
  const dragMove = ({ target }: KonvaEventObject<DragEvent>) => {
    const newPos: Pos = { x: target.x(), y: target.y() };
    setPos(newPos);
  };

  return (
    <Circle
      radius={50}
      fill={dragging ? "yellow" : "green"}
      shadowBlur={10}
      stroke="black"
      x={pos.x}
      y={pos.y}
      draggable
      zIndex={dragging ? 10 : 1}
      onDragStart={startDragging}
      onDragMove={dragMove}
      onDragEnd={endDragging}
    />
  );
};

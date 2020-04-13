import React from "react";
import { Text, Rect } from "react-konva";
import { EditingProps } from "../types";

export const Editing = ({ editing, turnOffEditing }: EditingProps) => {
  const editingOffsetY = 10;
  const editingOffsetX = -10;
  const {
    pos: { x, y },
  } = editing;
  return (
    <>
      {editing.on ? (
        <>
          <Rect
            x={x + editingOffsetX}
            y={y + editingOffsetY}
            fill={"yellow"}
            width={20}
            height={40}
          />
          <Text
            onClick={turnOffEditing}
            x={x + editingOffsetX / 2}
            y={y + editingOffsetY + 5}
            text={"C"}
          />
          <Text
            onClick={turnOffEditing}
            x={x + editingOffsetX / 2}
            y={y + editingOffsetY + 25}
            text={"H"}
          />
        </>
      ) : null}
    </>
  );
};

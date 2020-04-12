import React from "react";
import { Pos } from "../types";
import Portal from "./Portal";

interface AddNodeProps {
  addNode: (pos: Pos) => void;
}

export const AddNode = ({ addNode }: AddNodeProps) => {
  return (
    <Portal>
      <button
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          width: "200px",
        }}
        onClick={() => addNode({ x: 50, y: 50 })}
      >
        Add Node
      </button>
    </Portal>
  );
};

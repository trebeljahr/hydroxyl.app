import { Stage } from "konva/types/Stage";
import { Atom } from "../utils/Atoms";

export type Connections = Map<number, Atom>;

export interface Bond {
  type: 1 | 2 | 3 | 4;
  atom: Atom;
}
export enum BondDirections {
  left = "left",
  right = "right",
  up = "up",
  down = "down",
}
export interface Bonds {
  left: Bond | null;
  right: Bond | null;
  up: Bond | null;
  down: Bond | null;
}

export interface AtomConstructor {
  type?: string;
  bonds?: Bonds;
  maxBonds?: number;
  connections?: Connections;
}

export interface Pos {
  x: number;
  y: number;
}
export interface PDF_Props {
  stage: Stage;
}

export interface EditingData {
  on: boolean;
  id: string | null;
  pos: Pos;
  molecule: Atom;
}

export interface EditingProps {
  editing: EditingData;
  turnOffEditing: () => void;
}

export interface AtomDisplayProps {
  showHydrogen: boolean;
}

export interface URLImageProps {
  image: ImageData;
}

export interface ImageData {
  src: string;
  scale: any;
  x: number;
  y: number;
}

export interface AddNodeProps {
  addNode: (pos: Pos) => void;
}

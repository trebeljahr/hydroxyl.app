import { Stage } from "konva/types/Stage";
import { Atom } from "../utils/Atoms";

export interface AtomConstructor {
  type?: string;
  childOf?: Atom | null;
  connectionOn?: number;
}

export interface TwoBonds {
  1: Atom;
  2: Atom;
}

export interface ThreeBonds {
  1: Atom;
  2: Atom;
  3: Atom;
}

export interface FourBonds {
  1: Atom;
  2: Atom;
  3: Atom;
  4: Atom;
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

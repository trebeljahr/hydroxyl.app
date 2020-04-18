import { Stage } from "konva/types/Stage";
import { Atom } from "../utils/Atoms";
import { Element } from "../components/UI/PeriodicTable/types";

export interface Bond {
  type: 1 | 2 | 3 | 4;
  atom: Atom;
}

export interface HydrogenProps {
  setShowHydrogen: (e: boolean) => void;
  showHydrogen: boolean;
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

export interface ButtonDrawerProps {
  openDrawer: () => void;
}

export interface ElementButtonProps {
  element: Element;
  setElement: (e: string) => void;
  highlight: string;
}

export interface BondButtonProps {
  bondType: string;
  bondHighlight: string;
  setBond: (e: string) => void;
  bondSvg: any;
}

export interface AtomConstructor {
  name: string;
  bonds?: Bonds;
  maxBonds: number;
  symbol: string;
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
  molecule: Atom;
  pos: Pos;
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

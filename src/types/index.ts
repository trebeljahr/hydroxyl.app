import { Stage } from "konva/types/Stage";
import { Atom } from "../utils/Atoms/Atom";
import { Element } from "../components/UI/PeriodicTable/types";
import { Coordinates } from "../utils/functionalAtoms";

export enum BondTypes {
  single = "single",
  double = "double",
  triple = "triple",
  wedge = "wedge",
  hash = "hash",
  wave = "wave",
}

export interface SingleAtomProps {
  atom: Atom;
  pos: Pos;
  hover: string;
  setHover: (e: string) => void;
  editing: EditingData;
  toggleEditing: (id: string, molecule: Atom) => void;
}

export interface AtomConnectionsProps {
  atom: Atom;
  pos: Pos;
  hover: string;
  setHover: (e: string) => void;
  showHydrogen: boolean;
  editing: EditingData;
  toggleEditing: (id: string, molecule: Atom) => void;
  traversedNodes: string[];
  bondHighlight: string;
}

export type LinePoints = [number, number, number, number];

export interface Bond {
  id: string;
  type: string;
  atom: Atom;
  angle: number;
}

export interface HydrogenProps {
  setShowHydrogen: (e: boolean) => void;
  showHydrogen: boolean;
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
  bondHighlight: string;
  setBond: (e: string) => void;
  bond: any;
}

export interface ButtonAppBarProps extends HydrogenProps {
  stage: any;
}

export interface BondsToolbarProps {
  setBond: (e: string) => void;
  bondHighlight: string;
}

export interface SimpleMenuProps {
  stage: any;
}

export interface PeriodicSystemProps {
  drawer: boolean;
  toggleDrawer: () => void;
  setElement: (symbol: string) => void;
}

export interface CanvasProps {
  stage: any;
  setStage: (e: any) => void;
  showHydrogen: boolean;
  atomHighlight: string;
  bondHighlight: string;
}
export interface Positions {
  oldPos: Pos;
  newPos: Pos;
}

export interface AtomToolBarProps {
  highlight: string;
  setElement: (e: string) => void;
}

export interface BondLinesProps {
  bond: Bond;
  pos: Positions;
  hover: string;
  setHover: (e: string) => void;
  bondHighlight: string;
}

export interface AtomConstructor {
  name: string;
  bonds?: Bond[];
  maxBonds: number;
  symbol: string;
  pos: Coordinates;
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
  hover: string;
  bondHighlight: string;
  setHover: (e: string) => void;
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

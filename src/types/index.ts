export interface Pos {
  x: number;
  y: number;
}

export interface EditingData {
  on: boolean;
  id: string | null;
  pos: Pos;
}

export interface AtomDisplayProps {
  showHydrogen: boolean;
}

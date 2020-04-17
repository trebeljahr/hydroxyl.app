export interface Element {
  name: string;
  id: number;
  posX: number;
  posY: number;
  color: string;
  symbol: string;
  atomColor: string;
  maxBonds: number;
}

export interface PeriodicTableElements {
  [key: string]: Element;
}

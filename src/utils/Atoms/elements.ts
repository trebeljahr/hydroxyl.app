import { combinedPeriodicTable } from "../../components/UI/PeriodicTable/data/periodicTable";
import { Element } from "../../components/UI/PeriodicTable/types";
import { Atom } from "./Atom";

export class Hydrogen extends Atom {
  constructor() {
    const { maxBonds, symbol, name } = combinedPeriodicTable[
      "Hydrogen"
    ] as Element;
    super({
      name,
      maxBonds,
      symbol,
    });
  }
}

export class Nitrogen extends Atom {
  constructor() {
    const { maxBonds, symbol, name } = combinedPeriodicTable[
      "Nitrogen"
    ] as Element;
    super({
      name,
      maxBonds,
      symbol,
    });
  }
}

export class Oxygen extends Atom {
  constructor() {
    const { maxBonds, symbol, name } = combinedPeriodicTable[
      "Oxygen"
    ] as Element;
    super({
      name,
      maxBonds,
      symbol,
    });
  }
}

export class Carbon extends Atom {
  constructor() {
    const { maxBonds, symbol, name } = combinedPeriodicTable[
      "Carbon"
    ] as Element;
    super({
      name,
      maxBonds,
      symbol,
    });
  }
}

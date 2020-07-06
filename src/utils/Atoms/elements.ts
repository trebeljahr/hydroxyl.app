import {combinedPeriodicTable} from '../../components/UI/PeriodicTable/data/periodicTable';
import {Element} from '../../components/UI/PeriodicTable/types';
import {Vec2D} from '../functionalAtoms';

import {Atom} from './Atom';

export class Hydrogen extends Atom {
  constructor(pos: Vec2D) {
    const {maxBonds, symbol, name} =
        combinedPeriodicTable['Hydrogen'] as Element;
    super({
      name,
      maxBonds,
      symbol,
      pos,
    });
  }
}

export class Nitrogen extends Atom {
  constructor(pos: Vec2D) {
    const {maxBonds, symbol, name} =
        combinedPeriodicTable['Nitrogen'] as Element;
    super({
      name,
      maxBonds,
      symbol,
      pos,
    });
  }
}

export class Oxygen extends Atom {
  constructor(pos: Vec2D) {
    const {maxBonds, symbol, name} = combinedPeriodicTable['Oxygen'] as Element;
    super({
      name,
      maxBonds,
      symbol,
      pos,
    });
  }
}

export class Carbon extends Atom {
  constructor(pos: Vec2D) {
    const {maxBonds, symbol, name} = combinedPeriodicTable['Carbon'] as Element;
    super({
      name,
      maxBonds,
      symbol,
      pos,
    });
  }
}

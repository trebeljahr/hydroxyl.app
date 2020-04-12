import React from "react";
import { Carbon } from "../utils/Atoms";

export const AtomDisplay = () => {
  const molecule = new Carbon({ childOf: null });
  molecule.changeConnection(1, new Carbon({ childOf: molecule }));
  molecule.connections[1].changeConnection(
    2,
    new Carbon({ childOf: molecule.connections[1] })
  );
  molecule.connections[1].changeConnection(
    3,
    new Carbon({ childOf: molecule.connections[1] })
  );
  console.log(molecule);
  console.log(molecule.show());
  return <></>;
};

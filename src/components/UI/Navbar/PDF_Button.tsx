import React from "react";
import jsPDF from "jspdf";
import { PDF_Props } from "../../../types";

export const PDF_BUTTON = ({ stage }: PDF_Props) => {
  const saveAsPDF = () => {
    const pdf = new jsPDF("l", "px", [stage.width(), stage.height()]);
    pdf.setTextColor("#000000");
    pdf.addImage(
      stage.toDataURL({ pixelRatio: 2 }),
      0,
      0,
      stage.width(),
      stage.height()
    );

    pdf.save("canvas.pdf");
  };
  return (
    <div>
      <button onClick={saveAsPDF}>Save as pdf</button>
    </div>
  );
};

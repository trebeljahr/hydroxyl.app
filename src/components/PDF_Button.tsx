import React from "react";
import { Stage } from "konva/types/Stage";
import jsPDF from "jspdf";

interface PDF_Props {
  stage: Stage;
}

export const PDF_Button = ({ stage }: PDF_Props) => {
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

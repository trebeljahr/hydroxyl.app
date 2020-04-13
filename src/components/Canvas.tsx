import React, { useRef, useEffect, useState } from "react";
import { Layer, Stage, Image } from "react-konva";
import { KonvaEventObject } from "konva/types/Node";
import { PDF_BUTTON } from "./PDF_Button";
import { AtomDisplay } from "./AtomDisplay";
import useImage from "use-image";
import alkeneImage from "../images/alkene.jpg";

interface URLImageProps {
  image: ImageData;
}
interface ImageData {
  src: string;
  scale: any;
  x: number;
  y: number;
}
const URLImage = ({ image }: URLImageProps) => {
  const [img] = useImage(image.src);
  return (
    <Image
      image={img}
      x={image.x}
      y={image.y}
      width={img ? img.width / image.scale : 0}
      height={img ? img.height / image.scale : 0}
      offsetX={img ? img.width / 2 : 0}
      offsetY={img ? img.height / 2 : 0}
    />
  );
};

const Canvas = () => {
  const [showHydrogen, setShowHydrogen] = useState(true);
  const [stage, setStage] = useState(null);
  const [images, setImages] = useState<ImageData[]>([]);

  const stageRef: any = useRef();
  const dragUrl: any = useRef();

  const zoom = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const s = stageRef.current;

    const scaleBy = 1.02;
    const oldScale = s.scaleX();
    const mousePointTo = {
      x: s.getPointerPosition().x / oldScale - s.x() / oldScale,
      y: s.getPointerPosition().y / oldScale - s.y() / oldScale,
    };

    const newScale = e.evt.deltaY > 0 ? oldScale * scaleBy : oldScale / scaleBy;
    s.scale({ x: newScale, y: newScale });

    const newPos = {
      x: -(mousePointTo.x - s.getPointerPosition().x / newScale) * newScale,
      y: -(mousePointTo.y - s.getPointerPosition().y / newScale) * newScale,
    };
    s.position(newPos);
    s.batchDraw();
  };

  useEffect(() => {
    setStage(stageRef.current);
  }, []);
  const dragStart = (e: any) => {
    // console.log(e.target);
    dragUrl.current = e.target.src;
  };
  const dragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const s = stageRef.current;
    s.setPointersPositions(e);
    const scale = s.scaleX();
    const mousePointTo = {
      x: s.getPointerPosition().x / scale - s.x() / scale,
      y: s.getPointerPosition().y / scale - s.y() / scale,
    };
    setImages(
      images.concat([
        {
          ...mousePointTo,
          src: dragUrl.current,
          scale: s.scaleX(),
        },
      ])
    );
  };
  return (
    <div>
      <button onClick={() => setShowHydrogen(!showHydrogen)}>
        {showHydrogen ? "Hide hydrogen" : "Show hydrogen"}
      </button>
      {/* <img
        draggable={true}
        onDragStart={dragStart}
        alt="Some alt text"
        src={alkeneImage}
      /> */}
      <div onDrop={onDrop} onDragOver={dragOver}>
        <Stage
          style={{ backgroundColor: "white" }}
          draggable
          width={700}
          height={700}
          ref={stageRef}
          onWheel={zoom}
        >
          <Layer>
            <AtomDisplay showHydrogen={showHydrogen} />
          </Layer>
          <Layer>
            {images.map((image) => {
              return <URLImage image={image} />;
            })}
          </Layer>
        </Stage>
      </div>
      {stage && <PDF_BUTTON stage={stageRef.current} />}
    </div>
  );
};

export default Canvas;

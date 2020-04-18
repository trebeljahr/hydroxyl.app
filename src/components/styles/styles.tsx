import { makeStyles } from "@material-ui/core";

const orange = "rgb(255, 200, 150)";
const darkOrange = "rgb(200, 60, 20)";
export const littleBorderWidth = 5;

export const ButtonStyle = makeStyles({
  menuButton: ({
    selected,
    direction,
  }: {
    selected: boolean;
    direction: string;
  }) => ({
    textTransform: "none",
    border: "none",
    width: direction === "right" || direction === "left" ? "100%" : "auto",
    backgroundColor: selected ? orange : "white",
    color: "black",
    zIndex: 3,
    borderRadius: 0,
    borderLeft:
      direction === "left"
        ? selected
          ? `${littleBorderWidth}px solid ${darkOrange}`
          : `${littleBorderWidth}px solid rgb(200,200,200)`
        : "none",
    borderRight:
      direction === "right"
        ? selected
          ? `${littleBorderWidth}px solid ${darkOrange}`
          : `${littleBorderWidth}px solid rgb(200,200,200)`
        : "none",
    borderTop:
      direction === "top"
        ? selected
          ? `${littleBorderWidth}px solid ${darkOrange}`
          : `${littleBorderWidth}px solid rgb(200,200,200)`
        : "none",
    borderBottom:
      direction === "bottom"
        ? selected
          ? `${littleBorderWidth}px solid ${darkOrange}`
          : `${littleBorderWidth}px solid rgb(200,200,200)`
        : "none",

    "&:hover": {
      backgroundColor: selected ? orange : "rgb(230, 230, 230)",
      color: "black",
      borderLeft:
        direction === "left"
          ? selected
            ? `${littleBorderWidth}px solid ${darkOrange}`
            : `${littleBorderWidth}px solid rgb(100, 100, 100)`
          : "none",
      borderRight:
        direction === "right"
          ? selected
            ? `${littleBorderWidth}px solid ${darkOrange}`
            : `${littleBorderWidth}px solid rgb(100, 100, 100)`
          : "none",
      borderTop:
        direction === "top"
          ? selected
            ? `${littleBorderWidth}px solid ${darkOrange}`
            : `${littleBorderWidth}px solid rgb(100, 100, 100)`
          : "none",
      borderBottom:
        direction === "bottom"
          ? selected
            ? `${littleBorderWidth}px solid ${darkOrange}`
            : `${littleBorderWidth}px solid rgb(100, 100, 100)`
          : "none",
    },
  }),
});

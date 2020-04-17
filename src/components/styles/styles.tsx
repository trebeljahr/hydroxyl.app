import { makeStyles } from "@material-ui/core";

const orange = "rgb(255, 200, 150)";
const darkOrange = "rgb(200, 60, 20)";

export const ButtonStyle = makeStyles({
  menuButton: (selected: boolean) => ({
    textTransform: "none",
    border: "none",
    backgroundColor: selected ? orange : "white",
    color: "black",
    borderRadius: 0,
    "&::before": {
      content: `""`,
      position: "absolute",
      top: 0,
      bottom: 0,
      left: selected ? -5 : 0,
      right: 0,
      zIndex: -1,
      boxShadow:
        "0px 3px 5px -1px rgba(0,0,0,0.2), 0px 6px 10px 0px rgba(0,0,0,0.14), 0px 1px 18px 0px rgba(0,0,0,0.12)",
      borderLeft: selected ? `5px solid ${darkOrange}` : "none",
    },
    "&:hover": {
      backgroundColor: selected ? orange : "rgb(230, 230, 230)",
      color: "black",
      "&::before": {
        content: `""`,
        position: "absolute",
        top: 0,
        bottom: 0,
        left: selected ? -5 : -5,
        right: 0,
        borderLeft: selected
          ? `5px solid ${darkOrange}`
          : "5px solid rgb(100, 100, 100)",
      },
    },
  }),
});

import { makeStyles } from "@material-ui/core";

const orange = "rgb(255, 200, 150)";
const darkOrange = "rgb(200, 60, 20)";
export const littleBorderWidth = 50;

export const ButtonStyle = makeStyles({
  menuButton: ({
    selected,
    direction,
  }: {
    selected: boolean;
    direction: string;
  }) => ({
    textTransform: `none`,
    border: `none`,
    width: `100%`,
    backgroundColor: selected ? orange : `white`,
    color: `black`,
    zIndex: 3,
    borderRadius: 0,
    "&::before": {
      content: "",
      position: `absolute`,
      top: direction === `top` ? (selected ? `-${littleBorderWidth}` : 0) : 0,
      bottom:
        direction === `bottom` ? (selected ? `-${littleBorderWidth}` : 0) : 0,
      left: direction === `left` ? (selected ? `-${littleBorderWidth}` : 0) : 0,
      right:
        direction === `right` ? (selected ? `-${littleBorderWidth}` : 0) : 0,
      zIndex: 2,
      boxShadow: `0px 3px 5px -1px rgba(0,0,0,0.2), 0px 6px 10px 0px rgba(0,0,0,0.14), 0px 1px 18px 0px rgba(0,0,0,0.12)`,
      borderLeft:
        direction === `left`
          ? selected
            ? `${littleBorderWidth}px solid ${darkOrange}`
            : `${littleBorderWidth}px solid rgb(100, 100, 100)`
          : `none`,
      borderRight:
        direction === `right`
          ? selected
            ? `${littleBorderWidth}px solid ${darkOrange}`
            : `${littleBorderWidth}px solid rgb(100, 100, 100)`
          : `none`,
      borderTop:
        direction === `top`
          ? selected
            ? `${littleBorderWidth}px solid ${darkOrange}`
            : `${littleBorderWidth}px solid rgb(100, 100, 100)`
          : `none`,
      borderBottom:
        direction === `bottom`
          ? selected
            ? `${littleBorderWidth}px solid ${darkOrange}`
            : `${littleBorderWidth}px solid rgb(100, 100, 100)`
          : `none`,
    },
    "&:hover": {
      backgroundColor: selected ? orange : `rgb(230, 230, 230)`,
      color: `black`,
      "&::before": {
        content: "",
        position: `absolute`,
        top: direction === `top` ? `-${littleBorderWidth}` : 0,
        bottom: direction === `bottom` ? `-${littleBorderWidth}` : 0,
        left: direction === `left` ? `-${littleBorderWidth}` : 0,
        right: direction === `right` ? `-${littleBorderWidth}` : 0,
        borderLeft:
          direction === `left`
            ? selected
              ? `${littleBorderWidth}px solid ${darkOrange}`
              : `${littleBorderWidth}px solid rgb(100, 100, 100)`
            : `none`,
        borderRight:
          direction === `right`
            ? selected
              ? `${littleBorderWidth}px solid ${darkOrange}`
              : `${littleBorderWidth}px solid rgb(100, 100, 100)`
            : `none`,
        borderTop:
          direction === `top`
            ? selected
              ? `${littleBorderWidth}px solid ${darkOrange}`
              : `${littleBorderWidth}px solid rgb(100, 100, 100)`
            : `none`,
        borderBottom:
          direction === `bottom`
            ? selected
              ? `${littleBorderWidth}px solid ${darkOrange}`
              : `${littleBorderWidth}px solid rgb(100, 100, 100)`
            : `none`,
      },
    },
  }),
});

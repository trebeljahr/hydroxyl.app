import React from "react";
import Button from "@material-ui/core/Button";
import Menu from "@material-ui/core/Menu";
import MenuItem from "@material-ui/core/MenuItem";
import { createStyles, makeStyles, Theme } from "@material-ui/core";
import { PDF_BUTTON } from "./PDF_Button";
import { SimpleMenuProps } from "../../../types";

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    menu: {
      flexGrow: 1,
    },
  })
);

export const SimpleMenu = ({ stage }: SimpleMenuProps) => {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };
  const classes = useStyles();
  return (
    <div className={classes.menu}>
      <Button
        aria-controls="simple-menu"
        aria-haspopup="true"
        onClick={handleClick}
        color="inherit"
      >
        Open Menu
      </Button>
      <Menu
        id="simple-menu"
        anchorEl={anchorEl}
        keepMounted
        open={Boolean(anchorEl)}
        onClose={handleClose}
        color="inherit"
      >
        <MenuItem> {stage && <PDF_BUTTON stage={stage} />}</MenuItem>
      </Menu>
    </div>
  );
};

/**
 * A scene path's `d` string -> PDF path-construction operators.
 *
 * The scene builders write absolute M, L and C only (the bounds pass in
 * scene/bounds.ts reads a path's numbers as x,y pairs, which is why), but
 * this reads the rest of SVG's path grammar too — relative forms, H, V, S, Q,
 * T and Z — so a future builder that reaches for one does not silently drop
 * a mark from the PDF. Q and T become cubics, which is exact: PDF has no
 * quadratic operator. The elliptical arc is REFUSED, with the path's id in
 * the message: converting it is real work, nothing draws one, and a PDF that
 * quietly lost a curve is worse than an export that says why it stopped.
 */

const TOKEN = /[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/** Coordinates per segment, by command letter (lowercase). */
const ARITY: Readonly<Record<string, number>> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  z: 0,
};

/**
 * `fmt` spells one number; the caller owns precision. Returns the operators
 * joined by spaces, without a painting operator.
 */
export function pathOperators(d: string, fmt: (n: number) => string, context: string): string {
  const tokens = d.match(TOKEN) ?? [];
  const out: string[] = [];
  let i = 0;
  let command = "";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // The last control point, for S and T's reflection, and which kind made it.
  let lastCubic: { x: number; y: number } | null = null;
  let lastQuad: { x: number; y: number } | null = null;

  const number = (): number => {
    const token = tokens[i];
    i += 1;
    const value = token === undefined ? Number.NaN : Number(token);
    if (!Number.isFinite(value)) throw new Error(`Malformed path data in ${context}: ${d}`);
    return value;
  };
  const pt = (px: number, py: number): string => `${fmt(px)} ${fmt(py)}`;
  const cubic = (x1: number, y1: number, x2: number, y2: number, ex: number, ey: number): void => {
    out.push(`${pt(x1, y1)} ${pt(x2, y2)} ${pt(ex, ey)} c`);
  };

  while (i < tokens.length) {
    const token = tokens[i] ?? "";
    if (/^[A-Za-z]$/.test(token)) {
      command = token;
      i += 1;
      if (!(command.toLowerCase() in ARITY)) {
        throw new Error(`The PDF export cannot draw path command "${command}" in ${context}.`);
      }
    } else if (command === "") {
      throw new Error(`Malformed path data in ${context}: ${d}`);
    }
    const lower = command.toLowerCase();
    const relative = command !== command.toUpperCase();
    const ox = relative ? x : 0;
    const oy = relative ? y : 0;

    switch (lower) {
      case "z":
        out.push("h");
        x = startX;
        y = startY;
        lastCubic = null;
        lastQuad = null;
        // Z takes no numbers; a number after it needs a new command.
        command = "";
        continue;
      case "m": {
        x = ox + number();
        y = oy + number();
        startX = x;
        startY = y;
        out.push(`${pt(x, y)} m`);
        // Pairs after a moveto are implicit linetos.
        command = relative ? "l" : "L";
        lastCubic = null;
        lastQuad = null;
        break;
      }
      case "l":
        x = ox + number();
        y = oy + number();
        out.push(`${pt(x, y)} l`);
        lastCubic = null;
        lastQuad = null;
        break;
      case "h":
        x = ox + number();
        out.push(`${pt(x, y)} l`);
        lastCubic = null;
        lastQuad = null;
        break;
      case "v":
        y = oy + number();
        out.push(`${pt(x, y)} l`);
        lastCubic = null;
        lastQuad = null;
        break;
      case "c": {
        const x1 = ox + number();
        const y1 = oy + number();
        const x2 = ox + number();
        const y2 = oy + number();
        x = ox + number();
        y = oy + number();
        cubic(x1, y1, x2, y2, x, y);
        lastCubic = { x: x2, y: y2 };
        lastQuad = null;
        break;
      }
      case "s": {
        const x1 = lastCubic === null ? x : 2 * x - lastCubic.x;
        const y1 = lastCubic === null ? y : 2 * y - lastCubic.y;
        const x2 = ox + number();
        const y2 = oy + number();
        x = ox + number();
        y = oy + number();
        cubic(x1, y1, x2, y2, x, y);
        lastCubic = { x: x2, y: y2 };
        lastQuad = null;
        break;
      }
      case "q":
      case "t": {
        const qx: number =
          lower === "q" ? ox + number() : lastQuad === null ? x : 2 * x - lastQuad.x;
        const qy: number =
          lower === "q" ? oy + number() : lastQuad === null ? y : 2 * y - lastQuad.y;
        const ex = ox + number();
        const ey = oy + number();
        // Degree elevation: the cubic's controls sit two thirds of the way
        // from each end to the quadratic's single control.
        cubic(
          x + (2 / 3) * (qx - x),
          y + (2 / 3) * (qy - y),
          ex + (2 / 3) * (qx - ex),
          ey + (2 / 3) * (qy - ey),
          ex,
          ey,
        );
        x = ex;
        y = ey;
        lastQuad = { x: qx, y: qy };
        lastCubic = null;
        break;
      }
    }
  }
  return out.join(" ");
}

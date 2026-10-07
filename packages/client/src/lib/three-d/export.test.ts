import { describe, expect, it } from "vitest";

import { threeDPngSize } from "./export";

describe("threeDPngSize", () => {
  it("takes the figure's printed width and dpi, and the view's shape", () => {
    // 8.25 cm single column at 300 dpi is 974 px, as the 2D export computes.
    expect(threeDPngSize({ width: "single", customWidthCm: 12, dpi: 300, style: "publication", pngBackground: "white" }, 1)).toEqual({
      ok: true,
      widthPx: 974,
      heightPx: 974,
      widthCm: 8.25,
      dpi: 300,
    });
    expect(
      threeDPngSize({ width: "double", customWidthCm: 12, dpi: 600, style: "publication", pngBackground: "white" }, 2),
    ).toMatchObject({ ok: true, widthPx: 4205, heightPx: 2103 });
  });

  it("refuses a custom width out of range with the export dialog's sentence", () => {
    expect(
      threeDPngSize({ width: "custom", customWidthCm: 100, dpi: 300, style: "publication", pngBackground: "white" }, 1),
    ).toEqual({ ok: false, message: "A custom width must be between 2 and 60 cm." });
  });
});

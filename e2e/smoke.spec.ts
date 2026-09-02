import { expect, test } from "@playwright/test";

test("landing page renders benzene derived from chem-core", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Chemistry Sketcher", level: 1 }),
  ).toBeVisible();
  // Produced by molecularFormulaUnicode() in @starter/chem-core, so this
  // fails if the workspace build chain did not reach the served bundle.
  await expect(page.getByText("C₆H₆")).toBeVisible();
});

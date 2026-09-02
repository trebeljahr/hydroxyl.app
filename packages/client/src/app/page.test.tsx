import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LandingPage from "./page";

// LandingPage is a synchronous server component, so RTL renders it
// directly. This harness stops working the moment it becomes `async` or
// grows a canvas that needs "use client" children.
describe("LandingPage", () => {
  it("renders benzene's formula and mass derived from chem-core", () => {
    render(<LandingPage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Chemistry Sketcher",
    );
    // Neither string is hard-coded in the page: molecularFormulaUnicode()
    // and massSummary() in @starter/chem-core produce them, so this test
    // fails if the chem-core dist -> client bundle chain breaks.
    expect(screen.getByText("C₆H₆")).toBeInTheDocument();
    expect(screen.getByText("78.114 g/mol")).toBeInTheDocument();
  });
});

import { benzene, massSummary, molecularFormulaUnicode } from "@starter/chem-core";

/**
 * Placeholder landing page. Its real job right now is to prove the
 * chem-core wiring end to end: a molecule built in the pure core, its
 * properties derived, rendered through the Next build.
 */
export default function LandingPage() {
  const molecule = benzene();
  const summary = massSummary(molecule);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8">
      <main className="mx-auto max-w-2xl text-center">
        <h1 className="mb-4 text-4xl font-bold tracking-tight">
          Chemistry Sketcher
        </h1>
        <p className="text-muted-foreground mb-8 text-lg">
          Structure editor for publication figures. The canvas is not built yet.
        </p>
        <dl className="mx-auto grid max-w-sm grid-cols-2 gap-x-6 gap-y-2 text-left text-sm">
          <dt className="text-muted-foreground">Formula</dt>
          <dd className="font-mono">{molecularFormulaUnicode(molecule)}</dd>
          <dt className="text-muted-foreground">Molecular weight</dt>
          <dd className="font-mono">{summary.molecularWeight.toFixed(3)} g/mol</dd>
          <dt className="text-muted-foreground">Exact mass</dt>
          <dd className="font-mono">{summary.exactMass?.toFixed(4) ?? "—"}</dd>
          <dt className="text-muted-foreground">Heavy atoms</dt>
          <dd className="font-mono">{summary.heavyAtomCount}</dd>
        </dl>
      </main>
    </div>
  );
}

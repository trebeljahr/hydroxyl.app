import { describe, expect, it, vi } from "vitest";

import { benzene, medianBondLength } from "@starter/chem-core";

import type { ChemIoResult, ImportedStructure } from "@/lib/rdkit/types";

import { resolvePubChemLookup } from "./insert";
import type { RdkitImportBridge } from "./open";
import { isCasNumber, lookUpOnPubChem, pubChemPropertyUrl, type FetchLike } from "./pubchem";

/**
 * Every PubChem answer here is a canned Response. No test in this file, or
 * anywhere in CI, reaches pubchem.ncbi.nlm.nih.gov; the shapes below were
 * copied from real PUG-REST replies on 2026-10-07.
 */

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CAFFEINE = {
  PropertyTable: {
    Properties: [{ CID: 2519, SMILES: "CN1C=NC2=C1C(=O)N(C(=O)N2C)C", Title: "Caffeine" }],
  },
};

const NOT_FOUND = {
  Fault: { Code: "PUGREST.NotFound", Message: "No CID found", Details: ["No CID found that matches the given name"] },
};

function mockFetch(response: Response | Error): FetchLike & ReturnType<typeof vi.fn> {
  return vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
}

function bridgeAnswering(read: ChemIoResult<ImportedStructure>): {
  readonly load: () => Promise<RdkitImportBridge>;
  readonly fromSmiles: ReturnType<typeof vi.fn>;
} {
  const fromSmiles = vi.fn(async () => read);
  return { load: async () => ({ fromSmiles }) as RdkitImportBridge, fromSmiles };
}

const BENZENE_READ = {
  ok: true,
  value: { molecule: benzene(1.5), title: "" },
  report: { warnings: [] },
} as unknown as ChemIoResult<ImportedStructure>;

describe("isCasNumber", () => {
  it("accepts real CAS numbers and checks the check digit", () => {
    for (const cas of ["50-78-2", "58-08-2", "64-17-5", "7732-18-5", "7647-14-5"]) {
      expect(isCasNumber(cas), cas).toBe(true);
    }
    // One digit off: the check digit catches it.
    expect(isCasNumber("50-78-3")).toBe(false);
    expect(isCasNumber("58-80-2")).toBe(false);
    expect(isCasNumber("caffeine")).toBe(false);
    expect(isCasNumber("1-2-3")).toBe(false);
  });
});

describe("lookUpOnPubChem", () => {
  it("asks PUG-REST for the typed text only, URL-encoded, with no cookies or referrer", async () => {
    const fetch = mockFetch(json(200, CAFFEINE));
    await lookUpOnPubChem("  1,3,7-trimethylxanthine / caffeine ", { fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/" +
        "1%2C3%2C7-trimethylxanthine%20%2F%20caffeine/property/SMILES,Title/JSON",
    );
    expect(url).toBe(pubChemPropertyUrl("1,3,7-trimethylxanthine / caffeine"));
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.method ?? "GET").toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("returns PubChem's SMILES, CID and title", async () => {
    const result = await lookUpOnPubChem("58-08-2", { fetch: mockFetch(json(200, CAFFEINE)) });
    expect(result).toEqual({
      ok: true,
      value: { cid: 2519, smiles: "CN1C=NC2=C1C(=O)N(C(=O)N2C)C", title: "Caffeine", matches: 1 },
    });
  });

  it("reads the pre-2025 IsomericSMILES key too", async () => {
    const legacy = { PropertyTable: { Properties: [{ CID: 702, IsomericSMILES: "CCO", Title: "Ethanol" }] } };
    const result = await lookUpOnPubChem("ethanol", { fetch: mockFetch(json(200, legacy)) });
    expect(result.ok && result.value.smiles).toBe("CCO");
  });

  it("takes the first of several CIDs and says how many there were", async () => {
    const several = {
      PropertyTable: {
        Properties: [
          { CID: 5793, SMILES: "C([C@@H]1[C@H]([C@@H]([C@H](C(O1)O)O)O)O)O", Title: "Glucose" },
          { CID: 107526, SMILES: "C([C@@H]1[C@H]([C@@H]([C@H]([C@@H](O1)O)O)O)O)O", Title: "beta-D-Glucose" },
        ],
      },
    };
    const result = await lookUpOnPubChem("dextrose", { fetch: mockFetch(json(200, several)) });
    expect(result.ok && result.value.cid).toBe(5793);
    expect(result.ok && result.value.matches).toBe(2);
  });

  it("says plainly when PubChem has no such name", async () => {
    const result = await lookUpOnPubChem("notacompoundxyz", { fetch: mockFetch(json(404, NOT_FOUND)) });
    expect(result).toEqual({
      ok: false,
      message: "PubChem has no compound named “notacompoundxyz”. Check the spelling, or paste a SMILES or a molfile.",
    });
  });

  it("shows any other PubChem fault with PubChem's own message", async () => {
    const busy = { Fault: { Code: "PUGREST.ServerBusy", Message: "Too many requests or server too busy" } };
    const result = await lookUpOnPubChem("caffeine", { fetch: mockFetch(json(503, busy)) });
    expect(result).toEqual({
      ok: false,
      message: "PubChem refused the lookup (PUGREST.ServerBusy): Too many requests or server too busy",
    });
  });

  it("reports an answer with no body", async () => {
    const result = await lookUpOnPubChem("caffeine", { fetch: mockFetch(new Response("", { status: 502 })) });
    expect(result).toEqual({
      ok: false,
      message: "PubChem answered with HTTP 502 and no explanation. Nothing was inserted.",
    });
  });

  it("reports a request that never got an answer, with the browser's reason", async () => {
    const result = await lookUpOnPubChem("caffeine", { fetch: mockFetch(new TypeError("Failed to fetch")) });
    expect(result).toEqual({
      ok: false,
      message: "PubChem could not be reached (Failed to fetch). Check the connection and try again; nothing was inserted.",
    });
  });

  it("does not send an empty query", async () => {
    const fetch = mockFetch(json(200, CAFFEINE));
    const result = await lookUpOnPubChem("   ", { fetch });
    expect(result.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("resolvePubChemLookup", () => {
  it("reads PubChem's SMILES through the RDKit bridge and names the CID", async () => {
    const rdkit = bridgeAnswering(BENZENE_READ);
    const result = await resolvePubChemLookup("caffeine", {
      fetch: mockFetch(json(200, CAFFEINE)),
      loadRdkit: rdkit.load,
    });
    expect(rdkit.fromSmiles).toHaveBeenCalledWith("CN1C=NC2=C1C(=O)N(C(=O)N2C)C");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe("Caffeine (PubChem CID 2519)");
    expect(medianBondLength(result.value.molecule)).toBeCloseTo(1, 3);
  });

  it("never loads RDKit when PubChem has nothing", async () => {
    const rdkit = bridgeAnswering(BENZENE_READ);
    const result = await resolvePubChemLookup("notacompoundxyz", {
      fetch: mockFetch(json(404, NOT_FOUND)),
      loadRdkit: rdkit.load,
    });
    expect(result.ok).toBe(false);
    expect(rdkit.fromSmiles).not.toHaveBeenCalled();
  });

  it("passes RDKit's refusal on, with the CID it came from", async () => {
    const rdkit = bridgeAnswering({
      ok: false,
      error: { code: "parse", message: "SMILES Parse Error" },
    } as unknown as ChemIoResult<ImportedStructure>);
    const result = await resolvePubChemLookup("caffeine", {
      fetch: mockFetch(json(200, CAFFEINE)),
      loadRdkit: rdkit.load,
    });
    expect(result).toEqual({
      ok: false,
      message: "PubChem's SMILES for CID 2519 could not be read: SMILES Parse Error",
    });
  });
});

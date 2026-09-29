import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aboutHref,
  deploymentRoot,
  editorExampleHref,
  editorHref,
  indexablePageUrls,
  isFileExportBuild,
  journalFigureSizeGuideHref,
  recentsHref,
  siteUrl,
  thirdPartyNoticesHref,
} from "./deployment";
import { flatName } from "../../scripts/flatten-export.mjs";

/**
 * The link that used to be `next/link href="/editor?doc=…"` and was runtime
 * dead in the static export: the router pushed `/editor/?doc=…` without
 * loading a document, and every chunk requested after that click 404'd
 * against `/editor/_next/…`. These pin the two builds apart.
 *
 * The LINK answers from the build flag, so the prerendered HTML is already
 * right; the ASSET base answers from the document, because the RDKit worker
 * needs an absolute URL. Both are exercised here.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  document.head.querySelectorAll("script").forEach((s) => s.remove());
  document.head.querySelectorAll("base").forEach((b) => b.remove());
});

function addScript(src: string): void {
  const script = document.createElement("script");
  script.src = src;
  document.head.append(script);
}

describe("the standalone / dev build", () => {
  it("addresses the editor by its route", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "0");
    expect(isFileExportBuild()).toBe(false);
    expect(editorHref()).toBe("/editor");
    expect(editorHref("doc_1")).toBe("/editor?doc=doc_1");
    expect(recentsHref()).toBe("/");
    expect(aboutHref()).toBe("/about");
    expect(journalFigureSizeGuideHref()).toBe("/guides/journal-figure-size");
    // Origin-absolute: `/about` is served as `/about/`, and a relative path
    // would resolve under it.
    expect(thirdPartyNoticesHref()).toBe("/rdkit/THIRD-PARTY-NOTICES.txt");
  });

  it("escapes an id rather than pasting it into the query", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "0");
    expect(editorHref("a b&c=d")).toBe("/editor?doc=a%20b%26c%3Dd");
  });

  it("opens an example with ?example=, never with ?doc=", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "0");
    expect(editorExampleHref("landing")).toBe("/editor?example=landing");
    expect(editorExampleHref("a b")).toBe("/editor?example=a%20b");
  });
});

describe("the static export", () => {
  it("addresses the editor as a FLAT html file beside the current document", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "1");
    expect(isFileExportBuild()).toBe(true);
    // NOT "/editor" — that names a file the export does not contain, and on a
    // subdirectory host it names the wrong origin-absolute path. NOT
    // "/editor/" either, whose relative ./_next/ prefix resolves into a
    // directory with no assets in it.
    expect(editorHref("doc_1")).toBe("editor.html?doc=doc_1");
    expect(editorExampleHref("landing")).toBe("editor.html?example=landing");
    expect(recentsHref()).toBe("index.html");
    expect(aboutHref()).toBe("about.html");
    expect(thirdPartyNoticesHref()).toBe("rdkit/THIRD-PARTY-NOTICES.txt");
  });

  it("addresses a nested page by the flat name the export build moves it to", () => {
    // Decision 137: `/guides/journal-figure-size` would be written one
    // directory down, where `./_next/` finds no assets, so flatten-export.mjs
    // moves it to the root. The href and the script must agree on the name.
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "1");
    expect(journalFigureSizeGuideHref()).toBe(flatName("guides/journal-figure-size.html"));
  });

  it("needs no DOM to answer, because the grid is PRERENDERED", () => {
    // The whole reason this is a build flag rather than a script-tag sniff:
    // during the prerender there is no document to sniff, and an href that
    // only becomes correct at hydration is wrong in the emitted HTML.
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "1");
    expect(editorHref()).toBe("editor.html");
  });
});

describe("the public URL, for sitemap.xml and robots.txt (decision 122)", () => {
  const SITE = "https://chemistry.example.test/";

  it("lists the landing and the about page at the address standalone serves with a 200", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "0");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
    expect(siteUrl()).toBe(SITE);
    // `about/`, not `aboutHref()`'s `/about`: trailingSlash answers that with
    // a 308, and a sitemap entry that redirects is one a crawler reports.
    expect(indexablePageUrls()).toEqual([SITE, `${SITE}about/`]);
  });

  it("lists the export's flat about.html, the file its own links point at", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "1");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
    expect(indexablePageUrls()).toEqual([SITE, `${SITE}about.html`]);
  });

  it("never lists the editor", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
    for (const flag of ["0", "1"]) {
      vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", flag);
      expect(indexablePageUrls().some((url) => url.includes("editor"))).toBe(false);
    }
  });

  it("refuses to guess a host when the build did not supply one", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(() => siteUrl()).toThrow(/hatchkit/);
  });
});

describe("the asset base, which is a different question", () => {
  it("reads the deployment directory off a tag the browser already resolved", () => {
    // `assetPrefix: "./"`, so Next wrote a relative src and the browser has
    // resolved it against wherever the bundle was opened from. `rdkitAssetBase`
    // needs this absolute, because it is handed to `new Worker(...)`.
    const base = document.createElement("base");
    base.href = "https://example.test/app/";
    document.head.append(base);
    addScript("./_next/static/chunks/main-app.js");
    expect(deploymentRoot()).toBe("https://example.test/app/");
  });

  it("falls back to the document's own directory when there is no asset tag", () => {
    const base = document.createElement("base");
    base.href = "https://example.test/app/";
    document.head.append(base);
    expect(deploymentRoot()).toBe("https://example.test/app/");
  });
});

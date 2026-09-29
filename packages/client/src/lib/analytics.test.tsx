import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Analytics } from "@/components/Analytics";

import { PAGEVIEW_SCRIPT_ID, pageviewScript, parsePlausibleSettings } from "./analytics";

/**
 * Decisions 136 and 170: one cookie-less pageview, and only when `hatchkit
 * add` has written the settings. `e2e/analytics.spec.ts` proves the same
 * payload against a real build and a drawn document; these pin the rules.
 */

const DOMAIN = "chemistry.trebeljahr.com";
const SCRIPT_URL = "https://plausible.example/js/script.js";
const SETTINGS = { domain: DOMAIN, endpoint: "https://plausible.example/api/event" };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
  delete (document as { referrer?: string }).referrer;
  delete (navigator as { webdriver?: boolean }).webdriver;
});

describe("parsePlausibleSettings", () => {
  it("is off when neither value is set", () => {
    expect(parsePlausibleSettings(undefined, undefined)).toBeNull();
    expect(parsePlausibleSettings("", " ")).toBeNull();
  });

  it("posts to the script host's /api/event, as Plausible's tracker does", () => {
    expect(parsePlausibleSettings(DOMAIN, SCRIPT_URL)).toEqual(SETTINGS);
    expect(
      parsePlausibleSettings("Chemistry.Trebeljahr.com", "https://stats.example:8443/js/script.js"),
    ).toEqual({ domain: DOMAIN, endpoint: "https://stats.example:8443/api/event" });
  });

  it("is off while a value is still dotenvx ciphertext", () => {
    // What `next build` reads from the committed .env.production without the key.
    expect(parsePlausibleSettings("encrypted:BPbPZ0bp", "encrypted:BAx9")).toBeNull();
    expect(parsePlausibleSettings(DOMAIN, "encrypted:BAx9")).toBeNull();
  });

  it("fails the build when only one value is set", () => {
    expect(() => parsePlausibleSettings(DOMAIN, "")).toThrow(/half-configured/);
    expect(() => parsePlausibleSettings(undefined, SCRIPT_URL)).toThrow(/half-configured/);
  });

  it("fails the build on a malformed value", () => {
    expect(() => parsePlausibleSettings("https://chemistry.trebeljahr.com", SCRIPT_URL)).toThrow(
      /not a host name/,
    );
    expect(() => parsePlausibleSettings(DOMAIN, "plausible.example/js/script.js")).toThrow(
      /not a URL/,
    );
    expect(() => parsePlausibleSettings(DOMAIN, "http://plausible.example/js/script.js")).toThrow(
      /must be https/,
    );
  });
});

describe("<Analytics />", () => {
  it("renders nothing without settings", () => {
    expect(renderToStaticMarkup(<Analytics />)).toBe("");
  });

  it("renders the pageview script when both settings are set", () => {
    vi.stubEnv("NEXT_PUBLIC_PLAUSIBLE_DOMAIN", DOMAIN);
    vi.stubEnv("NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL", SCRIPT_URL);
    const html = renderToStaticMarkup(<Analytics />);
    expect(html).toContain(`id="${PAGEVIEW_SCRIPT_ID}"`);
    expect(html).toContain("https://plausible.example/api/event");
    // Nothing is fetched from the Plausible host but the event itself.
    expect(html).not.toContain("src=");
  });

  it("renders nothing in the static export, settings or not", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "1");
    vi.stubEnv("NEXT_PUBLIC_PLAUSIBLE_DOMAIN", DOMAIN);
    vi.stubEnv("NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL", SCRIPT_URL);
    expect(renderToStaticMarkup(<Analytics />)).toBe("");
  });
});

describe("the pageview script", () => {
  /** Runs the exact source the layout inlines, and returns what it sent. */
  function run(): { url: string; init: RequestInit; body: unknown }[] {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response()),
    );
    vi.stubGlobal("fetch", fetchMock);
    new Function(pageviewScript(SETTINGS))();
    return fetchMock.mock.calls.map(([url, init]) => ({
      url,
      init,
      body: JSON.parse(String(init.body)),
    }));
  }

  function setReferrer(value: string): void {
    Object.defineProperty(document, "referrer", { configurable: true, value });
  }

  it("sends one pageview with no query string, no hash and no cookies", () => {
    window.history.replaceState(null, "", "/editor/?doc=doc_7f3a&example=landing#panel-2");
    const sent = run();
    expect(sent).toHaveLength(1);
    const [event] = sent;
    expect(event?.url).toBe("https://plausible.example/api/event");
    expect(event?.init).toMatchObject({
      method: "POST",
      mode: "no-cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    expect(event?.body).toEqual({
      n: "pageview",
      u: `${window.location.origin}/editor/`,
      d: DOMAIN,
      r: null,
    });
  });

  it("drops a same-origin referrer, which can name a document", () => {
    setReferrer(`${window.location.origin}/editor/?doc=doc_7f3a`);
    expect(run()[0]?.body).toMatchObject({ r: null });
  });

  it("keeps another site's referrer as origin and path only", () => {
    setReferrer("https://news.example/item?id=42#comments");
    expect(run()[0]?.body).toMatchObject({ r: "https://news.example/item" });
  });

  it("sends nothing under automation", () => {
    Object.defineProperty(navigator, "webdriver", { configurable: true, value: true });
    expect(run()).toEqual([]);
  });

  it("sends nothing from a browser that opted out with plausible_ignore", () => {
    window.localStorage.setItem("plausible_ignore", "true");
    expect(run()).toEqual([]);
  });

  it("cannot be closed early by a value that spells </script>", () => {
    const source = pageviewScript({ domain: "a</script><script>alert(1)//", endpoint: "x" });
    expect(source).not.toContain("</script>");
  });
});

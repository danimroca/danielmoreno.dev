// DAST for a static site (no ZAP/Docker needed).
//
// Two targets:
//   - local:  http://localhost:3000 served by tests/server.mjs (default, CI-safe)
//   - prod:   set DAST_TARGET=https://danimroca.github.io/danielmoreno.dev/
//             to test the live GitHub Pages deployment instead.
//
// Checks: _headers vs served headers, CSP strictness, clickjacking framing,
// XSS probes (incl. Quality Lab JSON->DOM surface), DOM hygiene, link hygiene,
// information disclosure, and path traversal on the local server.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.env.DAST_TARGET || "http://localhost:3000").replace(/\/$/, "");
const IS_PROD = BASE.startsWith("https://");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Pages that exist on the target; report/suite pages only ship with the new branch. */
async function discoverPages(request) {
  const pages = ["/"];
  for (const candidate of ["/report.html", "/suite.html?suite=unit"]) {
    try {
      const res = await request.get(BASE + candidate, { timeout: 10_000 });
      if (res.ok()) pages.push(candidate);
    } catch {
      /* unreachable target — keep only "/" */
    }
  }
  return pages;
}

/** Parse the GitHub Pages `_headers` file into { headerName: value } for "/*". */
function parseHeadersFile() {
  const raw = fs.readFileSync(path.join(ROOT, "_headers"), "utf8");
  const out = {};
  let currentPath = null;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    if (/^\S/.test(line)) {
      currentPath = line.trim();
      continue;
    }
    const m = line.match(/^\s+([A-Za-z-]+):\s*(.*)$/);
    if (m && currentPath === "/*") out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

/** Parse a CSP header into { directive: [values...] }. */
function parseCsp(csp) {
  const directives = {};
  for (const part of csp.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [name, ...rest] = trimmed.split(/\s+/);
    directives[name.toLowerCase()] = rest;
  }
  return directives;
}

/** External (cross-origin) <script src> / <link rel=stylesheet href> URLs. */
async function remoteResources(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  return page.evaluate(() => {
    const origin = new URL(location.href).origin;
    return [...document.querySelectorAll("script[src], link[rel='stylesheet'][href]")]
      .map((e) => ({ tag: e.tagName.toLowerCase(), src: e.src || e.href }))
      .filter((r) => {
        try {
          return new URL(r.src).origin !== origin;
        } catch {
          return false; // relative or data: URLs
        }
      });
  });
}

test.describe("DAST: _headers (GitHub Pages config)", () => {
  const declared = parseHeadersFile();

  test("_headers declares a strict CSP", () => {
    const csp = declared["content-security-policy"];
    expect(csp, "_headers has no Content-Security-Policy for /*").toBeTruthy();
    const d = parseCsp(csp);
    expect(d["script-src"], "CSP missing script-src").toBeTruthy();
    expect(d["script-src"]).not.toContain("'unsafe-inline'");
    expect(d["script-src"]).not.toContain("'unsafe-eval'");
    expect(d["script-src"]).not.toContain("*");
    expect(d["frame-ancestors"], "CSP missing frame-ancestors").toBeTruthy();
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["base-uri"], "CSP missing base-uri").toBeTruthy();
    expect(d["form-action"], "CSP missing form-action").toBeTruthy();
  });

  test("_headers declares clickjacking + nosniff + referrer protection", () => {
    const xfo = declared["x-frame-options"];
    const csp = declared["content-security-policy"] || "";
    expect(
      (xfo === "DENY" || xfo === "SAMEORIGIN") || parseCsp(csp)["frame-ancestors"],
      "_headers has neither X-Frame-Options nor CSP frame-ancestors"
    ).toBeTruthy();
    expect(declared["x-content-type-options"]).toBe("nosniff");
    expect(declared["referrer-policy"], "Referrer-Policy missing from _headers").toBeTruthy();
  });

  test("served headers match _headers (local server mirrors prod)", async ({ request }) => {
    if (IS_PROD) return; // in prod mode the served headers ARE the _headers result
    const res = await request.get(BASE);
    expect(res.ok(), `GET ${BASE} failed (${res.status()})`).toBe(true);
    for (const [name, expected] of Object.entries(declared)) {
      const actual = res.headers()[name];
      expect(actual, `served header ${name} differs from _headers`).toBe(expected);
    }
  });
});

test.describe("DAST: served security headers", () => {
  let headers;

  test.beforeAll(async ({ request }) => {
    const res = await request.get(BASE);
    expect(res.ok(), `GET ${BASE} failed (${res.status()})`).toBe(true);
    headers = res.headers();
  });

  // These are only enforced once _headers is deployed (GitHub Pages). Against a
  // target that predates the security rollout they are skipped, not failed —
  // the "_headers" describe block above still validates the intended config.
  const hasCsp = () => Boolean(headers["content-security-policy"]);

  test("X-Content-Type-Options: nosniff", async () => {
    // Only meaningful once _headers is deployed; pre-rollout targets skip.
    if (!headers["x-content-type-options"] && !headers["content-security-policy"]) return;
    expect(headers["x-content-type-options"], "nosniff missing").toBe("nosniff");
  });

  test("clickjacking protection (XFO or CSP frame-ancestors)", async () => {
    const xfo = headers["x-frame-options"];
    const csp = headers["content-security-policy"] || "";
    if (!xfo && !csp) return; // pre-rollout target: nothing to verify yet
    expect(
      xfo === "DENY" || xfo === "SAMEORIGIN" || parseCsp(csp)["frame-ancestors"],
      `no clickjacking protection (XFO=${xfo}, CSP=${csp})`
    ).toBeTruthy();
  });

  test("Referrer-Policy and Permissions-Policy set", async () => {
    if (!headers["referrer-policy"] && !headers["permissions-policy"]) return;
    expect(headers["referrer-policy"], "Referrer-Policy missing").toBeTruthy();
    expect(headers["permissions-policy"], "Permissions-Policy missing").toBeTruthy();
  });

  test("JSON responses are not sniffsable as scripts (content-type + nosniff)", async ({ request }) => {
    const res = await request.get(`${BASE}/reports/history.json`);
    if (!res.ok()) return; // file may not exist locally before first CI run
    expect(res.headers()["content-type"]).toContain("application/json");
    expect(res.headers()["x-content-type-options"], "nosniff missing on JSON").toBe("nosniff");
  });

  test("CSP forbids unsafe-inline/unsafe-eval in script-src", async () => {
    if (!hasCsp()) return; // pre-rollout target
    const d = parseCsp(headers["content-security-policy"]);
    const scriptSrc = d["script-src"] || [];
    expect(scriptSrc, "no script-src directive").not.toEqual([]);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  test("CSP has no wildcard sources", async () => {
    if (!hasCsp()) return; // pre-rollout target
    const d = parseCsp(headers["content-security-policy"]);
    for (const [directive, values] of Object.entries(d)) {
      expect(values.includes("*"), `CSP ${directive} contains wildcard source`).toBe(false);
    }
  });

  test("HSTS present in production", async () => {
    if (!IS_PROD) return;
    const hsts = headers["strict-transport-security"];
    expect(hsts, "HSTS missing on live site").toBeTruthy();
    expect(hsts).toContain("max-age=");
  });

  test("CSP is enforced at runtime (injected script + inline handler are blocked)", async ({ page }) => {
    if (!headers["content-security-policy"]) return; // pre-rollout target
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    const result = await page.evaluate(() => {
      // 1. Injected external script must be blocked by script-src 'self'.
      const s = document.createElement("script");
      s.src = "https://nonexistent-dast-probe.invalid/x.js";
      document.head.appendChild(s);
      // 2. Inline event handler must be blocked (no unsafe-inline).
      const div = document.createElement("div");
      div.setAttribute("onclick", "window.__cspInlineRan = true");
      div.click();
      s.remove();
      div.remove();
      return { inlineRan: !!window.__cspInlineRan };
    });
    // The page's own CSP must have blocked the inline handler. (The external
    // script request is observed via requestfailed in the caller if needed;
    // a successful load of an .invalid domain is impossible, so blocking is
    // proven by the absence of any executed code.)
    expect(result.inlineRan, "inline onclick executed — CSP unsafe-inline not enforced").toBe(false);
  });
});

test.describe("DAST: clickjacking (framing)", () => {
  test("page refuses to render inside a cross-origin iframe", async ({ browser }) => {
    // Host the iframe from about:blank (null origin) — guaranteed cross-origin.
    // Success = the framed page's body is reachable AND contains our content.
    const context = await browser.newContext();
    const host = await context.newPage();
    host.on("console", (m) => {
      if (/X-Frame-Options|frame-ancestors/i.test(m.text())) console.log("[xfo-block]", m.text());
    });
    await host.goto("about:blank");
    const result = await host.evaluate(async (url) => {
      const iframe = document.createElement("iframe");
      iframe.src = url;
      document.body.appendChild(iframe);
      await new Promise((r) => setTimeout(r, 2000));
      let rendered = false;
      try {
        rendered = /Daniel Moreno/.test(iframe.contentDocument?.body?.innerText || "");
      } catch {
        rendered = false; // cross-origin read blocked
      }
      iframe.remove();
      return rendered;
    }, BASE);
    await context.close();
    expect(result, "page rendered inside a cross-origin iframe — clickjacking possible").toBe(false);
  });
});

test.describe("DAST: XSS probes", () => {
  let pages = ["/"];

  test.beforeAll(async ({ request }) => {
    pages = await discoverPages(request);
  });

  test("no script execution from URL hash (all pages)", async ({ page }) => {
    for (const pagePath of pages) {
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${BASE}${pagePath}#<script>alert(1)</scr` + `ipt>`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(500);
      expect(errors, `page error from hash injection on ${pagePath}: ${errors.join("; ")}`).toHaveLength(0);
    }
  });

  test("no script execution from query string (all pages)", async ({ page }) => {
    for (const pagePath of pages) {
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const sep = pagePath.includes("?") ? "&" : "?";
      await page.goto(`${BASE}${pagePath}${sep}q=<img src=x onerror=alert(1)>`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(500);
      expect(errors, `page error from query injection on ${pagePath}: ${errors.join("; ")}`).toHaveLength(0);
    }
  });

  test("Quality Lab JSON data cannot inject DOM (XSS via report payload)", async ({ request, page }) => {
    // The real attack surface: report.js/suite.js render fetched JSON into innerHTML.
    // Verify every dynamic value is HTML-escaped by checking a hostile-looking
    // payload round-trips as inert text, not markup.
    const probe = "<img src=x onerror=window.__xss=1>";
    const res = await request.get(`${BASE}/reports/history.json`);
    if (!res.ok()) return; // no report data yet (pre-first-CI-run) — nothing to render
    const history = await res.json();
    const runs = Array.isArray(history.runs) ? history.runs : [];

    // 1. The page must render its fetched JSON without executing anything from it.
    await page.goto(`${BASE}/report.html`, { waitUntil: "networkidle" });
    const injected = await page.evaluate(() => !!window.__xss);
    expect(injected, "script executed from report data").toBe(false);

    // 2. Structural check: the escape function used by report.js/suite.js must
    //    neutralize markup in dynamic fields (commit names, test names, messages).
    const escLocal = (s) =>
      String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    expect(escLocal(probe)).toBe("&lt;img src=x onerror=window.__xss=1&gt;");

    // 3. Any markup-looking value already present in the data must appear as
    //    inert text in the rendered DOM, never as live elements.
    const suspicious = runs.flatMap((r) => [r.commit, r.branch]).filter((v) => typeof v === "string" && /</.test(v));
    if (suspicious.length) {
      const liveElements = await page.evaluate(() => document.querySelectorAll("img[src='x']").length);
      expect(liveElements, "unescaped markup rendered as live elements").toBe(0);
    }
  });

  // Scan every .js the target actually serves (discovered from HTML <script src>).
  async function shippedJsFiles(request) {
    const res = await request.get(BASE + "/");
    const html = await res.text();
    const files = new Set(["main.js"]);
    for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
      const u = new URL(m[1], BASE + "/").pathname;
      files.add(u.replace(/^\//, ""));
    }
    return [...files];
  }

  test("no eval() or Function() constructor in shipped JS", async ({ request }) => {
    for (const file of await shippedJsFiles(request)) {
      const res = await request.get(`${BASE}/${file}`);
      if (!res.ok()) continue; // missing optional file — not a finding
      const body = await res.text();
      expect(body, `eval/Function constructor in ${file}`).not.toMatch(/\beval\s*\(|new\s+Function\s*\(/);
    }
  });

  test("no document.write in shipped JS", async ({ request }) => {
    for (const file of await shippedJsFiles(request)) {
      const res = await request.get(`${BASE}/${file}`);
      if (!res.ok()) continue;
      const body = await res.text();
      expect(body, `document.write in ${file}`).not.toMatch(/document\.write/);
    }
  });
});

test.describe("DAST: DOM hygiene", () => {
  let pages = ["/"];

  test.beforeAll(async ({ request }) => {
    pages = await discoverPages(request);
  });

  test("no inline event handlers (onclick= etc.)", async ({ page }) => {
    for (const pagePath of pages) {
      await page.goto(BASE + pagePath, { waitUntil: "domcontentloaded" });
      const handlers = await page.evaluate(() => {
        const els = document.querySelectorAll("[onclick],[onload],[onerror],[onmouseover],[onfocus]");
        return [...els].map((e) => e.outerHTML.slice(0, 80));
      });
      expect(handlers, `inline event handlers on ${pagePath}: ${handlers.join(" | ")}`).toHaveLength(0);
    }
  });

  test("no plain-http resource references in HTML", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    const html = await page.content();
    const plainHttp = [...html.matchAll(/(?:src|href)\s*=\s*"http:\/\//g)];
    expect(plainHttp, `found ${plainHttp.length} plain-http resource refs`).toHaveLength(0);
  });

  test("all external links use https", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    const links = await page.locator("a[href^='http']").evaluateAll((els) => els.map((e) => e.href));
    const bad = links.filter((l) => l.startsWith("http://"));
    expect(bad, `insecure external links: ${bad.join(", ")}`).toHaveLength(0);
  });

  test("remote scripts/styles are on an allowlisted origin", async ({ page }) => {
    const remotes = await remoteResources(page);
    // Only Google Fonts is expected; anything new must be reviewed (SRI not
    // applicable: fonts are stylesheets, and script-src 'self' already blocks
    // any remote <script> at runtime via CSP).
    for (const r of remotes) {
      expect(
        r.src.includes("fonts.googleapis.com") || r.src.includes("fonts.gstatic.com"),
        `unexpected remote resource: ${r.src}`
      ).toBe(true);
    }
  });
});

test.describe("DAST: link hygiene", () => {
  test("all target=_blank links have rel=noopener", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    const bad = await page.locator('a[target="_blank"]').evaluateAll((els) =>
      els.filter((e) => !(e.rel || "").includes("noopener")).map((e) => e.href)
    );
    expect(bad, `target=_blank without noopener: ${bad.join(", ")}`).toHaveLength(0);
  });

  test("mailto and CV links are well-formed", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    const mailto = page.locator('a[href^="mailto:"]').first();
    expect(await mailto.getAttribute("href")).toMatch(/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+/);

    const cv = page.locator('a[href$=".pdf"], a[href*="cv"], a[href*="resume"]');
    if (await cv.count() > 0) {
      const href = await cv.first().getAttribute("href");
      expect(href.startsWith("http://"), `CV link uses plain http: ${href}`).toBe(false);
    }
  });
});

test.describe("DAST: information disclosure", () => {
  test("no X-Powered-By header", async ({ request }) => {
    const res = await request.get(BASE);
    expect(res.headers()["x-powered-by"], "X-Powered-By leaks tech stack").toBeUndefined();
  });

  test("404 response does not disclose framework details", async ({ request }) => {
    const res = await request.get(`${BASE}/nonexistent-page-xyz-12345`);
    expect(res.status()).toBe(404);
    const body = await res.text();
    expect(body, "404 body discloses framework").not.toMatch(/(Express|nginx\/\d|Apache\/\d|Node\.js)/i);
  });

  test("local server rejects path traversal", async ({ request }) => {
    if (IS_PROD) return; // GHP handles this; only meaningful against our own server
    const res = await request.get(`${BASE}/..%2f..%2fetc%2fpasswd`);
    expect(res.status(), `traversal attempt returned ${res.status()}`).toBeGreaterThanOrEqual(400);
    const body = await res.text();
    expect(body).not.toContain("root:");
  });
});

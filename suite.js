// Suite detail page — lists every test (or SAST finding) for one suite with
// show/hide filter buttons. Reads ?suite=<key> and reports/latest/summary.json.
// No external libraries (strict CSP: script-src 'self').

const SUITES = {
  unit: { label: "Unit Tests", desc: "Vitest · jsdom — component & logic tests for main.js" },
  e2e: { label: "E2E + DAST + A11y", desc: "Playwright end-to-end, dynamic app security testing and axe-core WCAG 2.1 AA checks across browsers" },
  visual: { label: "Visual Regression", desc: "Playwright pixel-diff screenshots at desktop & mobile viewports" },
  sast: { label: "SAST", desc: "Semgrep static analysis with custom security rules on main.js and index.html" },
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDur = (ms) => (!ms && ms !== 0 ? "—" : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`);

// Active filter state: a Set of statuses currently shown.
let shown = new Set();

async function loadSummary() {
  try {
    const res = await fetch("reports/latest/summary.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error("Failed to load summary", e);
    return null;
  }
}

function init() {
  const params = new URLSearchParams(location.search);
  const key = params.get("suite") || "unit";
  const meta = SUITES[key] || SUITES.unit;

  document.title = `${meta.label} — Quality Lab`;
  $("navLabel").textContent = meta.label;
  $("suiteTitle").textContent = meta.label;
  $("suiteDesc").textContent = meta.desc;

  const summary = loadSummary().then((data) => {
    if (!data) {
      $("results").innerHTML = `<p class="empty">Could not load reports/latest/summary.json.</p>`;
      return;
    }
    const suite = data.suites[key];
    renderMeta(key, suite);
    if (key === "sast") renderSast(suite);
    else renderTests(key, suite);
  });
}

function renderMeta(key, suite) {
  const badge = $("suiteBadge");
  if (!suite) {
    badge.textContent = "no data";
    return;
  }
  badge.textContent = suite.status;
  badge.className = `card__badge ${suite.status === "pass" ? "" : ""}`;
  // color via inline since badge class is shared
  badge.style.background = suite.status === "pass" ? "rgba(95,224,211,0.12)" : "rgba(255,107,129,0.12)";
  badge.style.color = suite.status === "pass" ? "var(--ok)" : "var(--danger)";

  if (key === "sast") {
    $("mTotal").textContent = suite.findings;
    $("mPassed").textContent = "—";
    $("mFailed").textContent = `${suite.errors} rule errors`;
    $("mDur").textContent = "—";
  } else {
    $("mTotal").textContent = suite.total;
    $("mPassed").textContent = suite.passed;
    $("mFailed").textContent = suite.failed;
    $("mDur").textContent = fmtDur(suite.durationMs);
  }
}

// ---- Test suites (unit / e2e / visual) ----
function renderTests(key, suite) {
  if (!suite || !suite.tests?.length) {
    $("filters").innerHTML = "";
    $("results").innerHTML = `<p class="empty">No test data recorded for this suite.</p>`;
    return;
  }
  const tests = suite.tests;

  // Count by status.
  const counts = { passed: 0, failed: 0, skipped: 0 };
  for (const t of tests) {
    if (t.status === "passed") counts.passed++;
    else if (t.status === "failed") counts.failed++;
    else counts.skipped++; // skipped / pending
  }

  // Show everything by default.
  shown = new Set(["passed", "failed", "skipped"]);

  $("filters").innerHTML = [
    filterBtn("passed", "Passed", counts.passed),
    filterBtn("skipped", "Skipped", counts.skipped),
    filterBtn("failed", "Failed", counts.failed),
  ].join("");

  // Render rows, each tagged with its status bucket.
  $("results").innerHTML = `<div class="test-list" id="testList">` +
    tests.map((t) => testRowHtml(t)).join("") + `</div>`;

  // Wire filter buttons.
  $("filters").querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => toggleFilter(btn.dataset.kind));
  });
}

function filterBtn(kind, label, count) {
  return `<button class="filter-btn" data-kind="${kind}" aria-pressed="true">
    ${label}<span class="filter-btn__count">${count}</span>
  </button>`;
}

function statusBucket(status) {
  if (status === "passed") return "passed";
  if (status === "failed") return "failed";
  return "skipped"; // skipped, pending, unknown
}

function testRowHtml(t) {
  const bucket = statusBucket(t.status);
  const proj = t.project ? `<span class="test-row__proj">${esc(t.project)}</span>` : "";
  const file = t.file ? `<div class="test-row__file">${esc(basename(t.file))}</div>` : "";
  const msg = t.message ? `<div class="test-row__msg">${esc(t.message)}</div>` : "";
  return `<div class="test-row" data-status="${bucket}" data-exact="${esc(t.status)}">
    <span class="test-row__status"></span>
    <div><div class="test-row__name">${esc(t.name)}</div>${file}</div>
    ${proj}
    <span class="test-row__dur">${fmtDur(t.durationMs)}</span>
    ${msg}
  </div>`;
}

function toggleFilter(kind) {
  const btn = $( "filters" ).querySelector(`.filter-btn[data-kind="${kind}"]`);
  if (shown.has(kind)) {
    shown.delete(kind);
    btn.setAttribute("aria-pressed", "false");
  } else {
    shown.add(kind);
    btn.setAttribute("aria-pressed", "true");
  }
  applyFilter();
}

function applyFilter() {
  document.querySelectorAll("#testList .test-row").forEach((row) => {
    row.classList.toggle("hidden", !shown.has(row.dataset.status));
  });
}

// ---- SAST: group findings by severity, filter by severity ----
const SEV_ORDER = ["error", "warning", "info"];
const RULE_COUNT = 5;

function renderSast(suite) {
  if (!suite) {
    $("filters").innerHTML = "";
    $("results").innerHTML = `<p class="empty">No SAST data recorded.</p>`;
    return;
  }
  const findings = suite.tests || [];

  // Group by severity.
  const groups = { error: [], warning: [], info: [] };
  for (const f of findings) (groups[f.severity] || (groups[f.severity] = [])).push(f);

  shown = new Set(SEV_ORDER.filter((s) => groups[s]?.length));

  $("filters").innerHTML = SEV_ORDER.map((sev) =>
    `<button class="filter-btn" data-kind="${sev}" aria-pressed="${groups[sev]?.length ? "true" : "false"}">
      ${cap(sev)}<span class="filter-btn__count">${groups[sev]?.length || 0}</span>
    </button>`
  ).join("");

  if (!findings.length) {
    $("results").textContent = `✅ No findings — the codebase is clean against all ${RULE_COUNT} custom rules.`;
    return;
  }

  $("results").innerHTML = SEV_ORDER.filter((s) => groups[s]?.length).map((sev) =>
    `<div class="sev-group" data-sev="${sev}">
      <div class="sev-group__head">
        <span class="sev-dot"></span>
        <span class="sev-group__title">${cap(sev)}</span>
        <span class="sev-group__count">${groups[sev].length} finding${groups[sev].length === 1 ? "" : "s"}</span>
      </div>
      ${groups[sev].map(findingRowHtml).join("")}
    </div>`
  ).join("");

  $("filters").querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => toggleSevFilter(btn.dataset.kind));
  });
}

function findingRowHtml(f) {
  const loc = `${basename(f.file)}:${f.line}`;
  return `<div class="finding-row" data-sev="${esc(f.severity)}">
    <div class="finding-row__top">
      <span class="finding-row__rule">${esc(f.rule)}</span>
      <span class="finding-row__loc">${esc(loc)}</span>
    </div>
    <div class="finding-row__msg">${esc(f.message)}</div>
  </div>`;
}

function toggleSevFilter(sev) {
  const btn = $("filters").querySelector(`.filter-btn[data-kind="${sev}"]`);
  if (shown.has(sev)) {
    shown.delete(sev);
    btn.setAttribute("aria-pressed", "false");
  } else {
    shown.add(sev);
    btn.setAttribute("aria-pressed", "true");
  }
  document.querySelectorAll(".sev-group").forEach((g) => {
    g.classList.toggle("hidden", !shown.has(g.dataset.sev));
  });
}

// ---- helpers ----
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function basename(p) {
  if (!p) return "";
  const parts = p.split("/");
  return parts[parts.length - 1];
}

init();

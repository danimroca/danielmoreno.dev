// Quality Lab dashboard — renders reports/history.json into cards, SVG trends, and a table.
// No external libraries (strict CSP: script-src 'self').

const SUITES = [
  { key: "unit", label: "Unit Tests", desc: "Vitest · jsdom" },
  { key: "e2e", label: "E2E + DAST + A11y", desc: "Playwright · axe-core" },
  { key: "visual", label: "Visual Regression", desc: "Playwright screenshots" },
  { key: "sast", label: "SAST", desc: "Semgrep · custom rules" },
];

const $ = (id) => document.getElementById(id);
const fmtDate = (iso) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---- Data loading ----
async function loadHistory() {
  try {
    const res = await fetch("reports/history.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.runs) ? data.runs : [];
  } catch (e) {
    console.error("Failed to load history", e);
    return null;
  }
}

// ---- Header / status banner ----
function renderHeader(latest, runs) {
  const allPass = latest && Object.values(latest.suites).every((s) => s && s.status === "pass");
  const banner = $("statusBanner");
  if (!latest) {
    banner.dataset.state = "fail";
    $("statusText").textContent = "No runs recorded yet — waiting for first CI run.";
    return;
  }
  banner.dataset.state = allPass ? "pass" : "fail";
  const failedSuites = SUITES.filter((s) => latest.suites[s.key]?.status === "fail").map((s) => s.label);
  $("statusText").textContent = allPass
    ? `All suites passing · ${runs.length} run${runs.length === 1 ? "" : "s"} in history`
    : `Failing: ${failedSuites.join(", ")}`;

  $("metaCommit").textContent = latest.commit || "—";
  $("metaBranch").textContent = latest.branch || "—";
  $("metaDate").textContent = fmtDate(latest.date);
  const total = SUITES.reduce((n, s) => n + (latest.suites[s.key]?.total || 0), 0);
  $("metaTotal").textContent = total || "—";
}

// ---- Suite cards ----
function renderCards(latest) {
  const wrap = $("cards");
  if (!latest) {
    wrap.innerHTML = `<p class="empty">No data yet.</p>`;
    return;
  }
  wrap.innerHTML = SUITES.map((s) => cardHtml(s, latest.suites[s.key])).join("");
}

function cardHtml(meta, data) {
  const href = `suite.html?suite=${meta.key}`;
  if (!data) {
    return `<a class="card card--link" href="${href}" data-state="na">
      <div class="card__head"><span class="card__name">${esc(meta.label)}</span><span class="card__badge">no data</span></div>
      <p style="color:var(--text-faint);font-size:0.9rem;">Not run in the latest pipeline.</p>
    </a>`;
  }
  const state = data.status;
  if (meta.key === "sast") {
    return `<a class="card card--link" href="${href}" data-state="${state}">
      <div class="card__head"><span class="card__name">${esc(meta.label)}</span><span class="card__badge">${state}</span></div>
      <div class="card__stat"><span class="card__num">${data.findings}</span><span class="card__of">findings</span></div>
      <div class="card__bar"><div class="card__bar-fill" style="width:100%"></div></div>
      <div class="card__foot"><span>${esc(meta.desc)}</span><span>${data.errors} rule errors</span></div>
    </a>`;
  }
  const pct = data.total ? Math.round((data.passed / data.total) * 100) : 0;
  return `<a class="card card--link" href="${href}" data-state="${state}">
    <div class="card__head"><span class="card__name">${esc(meta.label)}</span><span class="card__badge">${state}</span></div>
    <div class="card__stat"><span class="card__num">${data.passed}</span><span class="card__of">/ ${data.total} passed</span></div>
    <div class="card__bar"><div class="card__bar-fill" style="width:${pct}%"></div></div>
    <div class="card__foot"><span>${esc(meta.desc)}</span><span>${data.failed} failed · ${fmtDur(data.durationMs)} →</span></div>
  </a>`;
}

function fmtDur(ms) {
  if (!ms && ms !== 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ---- SVG trend charts ----
function renderCharts(runs) {
  const wrap = $("charts");
  // runs are newest-first; reverse to oldest→newest for the x-axis.
  const ordered = [...runs].reverse();
  if (ordered.length < 2) {
    wrap.innerHTML = `<p class="empty">Trends appear after at least 2 CI runs.</p>`;
    return;
  }
  wrap.innerHTML = SUITES.map((s) => chartHtml(s, ordered)).join("");
}

function chartHtml(meta, runs) {
  const W = 460, H = 180, P = { t: 18, r: 14, b: 26, l: 34 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const n = runs.length;

  // Build series. For test suites: pass-rate % (0-100) + failed count.
  // For SAST: findings count only.
  const isSast = meta.key === "sast";
  const passRates = runs.map((r) => {
    const d = r.suites[meta.key];
    if (!d || !d.total) return null;
    return (d.passed / d.total) * 100;
  });
  const fails = runs.map((r) => {
    const d = r.suites[meta.key];
    if (!d) return null;
    return isSast ? d.findings : d.failed;
  });

  const x = (i) => P.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const yPct = (v) => P.t + ih - (v / 100) * ih;
  const maxFail = Math.max(1, ...fails.filter((v) => v != null));
  const yFail = (v) => P.t + ih - (v / maxFail) * ih;

  let grid = "";
  for (let g = 0; g <= 4; g++) {
    const gy = P.t + (g / 4) * ih;
    grid += `<line class="grid-line" x1="${P.l}" y1="${gy}" x2="${W - P.r}" y2="${gy}"/>`;
    grid += `<text class="axis-label" x="${P.l - 6}" y="${gy + 3}" text-anchor="end">${100 - g * 25}</text>`;
  }

  // X labels: commit short or index
  let xlabels = "";
  runs.forEach((r, i) => {
    if (n > 6 && i % 2 !== 0) return; // thin out
    const label = r.commit ? r.commit.slice(0, 7) : `#${i + 1}`;
    xlabels += `<text class="axis-label" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(label)}</text>`;
  });

  // Pass-rate line + area
  const passPts = passRates.map((v, i) => (v == null ? null : [x(i), yPct(v)])).filter(Boolean);
  let passLine = "", area = "";
  if (passPts.length > 1) {
    passLine = `<polyline class="line-pass" points="${passPts.map((p) => p.join(",")).join(" ")}"/>`;
    const baseY = P.t + ih;
    area = `<polygon class="area" points="${P[0] ?? ""}${passPts[0][0]},${baseY} ${passPts.map((p) => p.join(",")).join(" ")} ${passPts[passPts.length - 1][0]},${baseY}"/>`;
  }
  const passDots = passPts.map((p) => `<circle class="dot-pass" cx="${p[0]}" cy="${p[1]}" r="3.5"/>`).join("");

  // Fail line
  const failPts = fails.map((v, i) => (v == null ? null : [x(i), yFail(v)])).filter(Boolean);
  let failLine = "";
  if (failPts.length > 1) {
    failLine = `<polyline class="line-fail" points="${failPts.map((p) => p.join(",")).join(" ")}"/>`;
  }
  const failDots = failPts.map((p) => `<circle class="dot-fail" cx="${p[0]}" cy="${p[1]}" r="3.5"/>`).join("");

  const legend = isSast
    ? `<div class="chart__legend"><span><i style="background:var(--danger)"></i>Findings</span></div>`
    : `<div class="chart__legend"><span><i style="background:var(--accent)"></i>Pass rate %</span><span><i style="background:var(--danger)"></i>Failed</span></div>`;

  return `<article class="chart">
    <div class="chart__title">${esc(meta.label)}</div>
    <div class="chart__sub">${esc(meta.desc)} · ${n} runs</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(meta.label)} trend">
      ${grid}${area}${passLine}${failLine}${passDots}${failDots}${xlabels}
    </svg>
    ${legend}
  </article>`;
}

// ---- History table ----
function renderTable(runs) {
  const body = $("historyBody");
  if (!runs.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty">No runs yet.</td></tr>`;
    return;
  }
  body.innerHTML = runs.map((r, i) => {
    const cells = SUITES.map((s) => suiteCell(r.suites[s.key], s.key)).join("");
    const allPass = Object.values(r.suites).every((x) => x && x.status === "pass");
    return `<tr>
      <td class="mono">${runs.length - i}</td>
      <td class="mono">${esc(r.commit || "—")}</td>
      <td>${fmtDate(r.date)}</td>
      ${cells}
      <td><span class="pill ${allPass ? "pill--pass" : "pill--fail"}">${allPass ? "PASS" : "FAIL"}</span></td>
    </tr>`;
  }).join("");
}

function suiteCell(data, key) {
  if (!data) return `<td><span class="pill pill--na">—</span></td>`;
  const cls = data.status === "pass" ? "pill--pass" : "pill--fail";
  const txt = key === "sast" ? `${data.findings} fnd` : `${data.passed}/${data.total}`;
  return `<td><span class="pill ${cls}">${txt}</span></td>`;
}

// ---- Boot ----
async function init() {
  const runs = await loadHistory();
  if (runs === null) {
    $("statusBanner").dataset.state = "fail";
    $("statusText").textContent = "Could not load reports/history.json.";
    return;
  }
  renderHeader(runs[0], runs);
  renderCards(runs[0]);
  renderCharts(runs);
  renderTable(runs);
}

init();

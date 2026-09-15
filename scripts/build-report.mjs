// Builds the DevSecOps report data from raw test/scanner JSON output.
//
// Inputs (in reports/latest/):
//   vitest.json       - Vitest JSON reporter
//   playwright-*.json - Playwright JSON reporter (one per browser project)
//   semgrep.json      - Semgrep --json output
//
// Outputs:
//   reports/history.json  - capped list of run summaries (newest first, max 10)
//   reports/latest/summary.json - the most recent run's full parsed record
//
// Each history record stores aggregates only (small); the full per-test
// detail for the latest run lives in reports/latest/*.json and summary.json.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const LATEST = path.join(ROOT, "reports", "latest");
const HISTORY_PATH = path.join(ROOT, "reports", "history.json");
const MAX_RUNS = 10;

function git(field) {
  try {
    return execSync(`git ${field}`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function readJson(file) {
  const p = path.join(LATEST, file);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.warn(`[report] could not parse ${file}: ${e.message}`);
    return null;
  }
}

// ---- Parsers: each returns a normalized suite summary ----

function parseVitest(data) {
  if (!data) return null;
  const total = data.numTotalTests || 0;
  const passed = data.numPassedTests || 0;
  const failed = data.numFailedTests || 0;
  const durationMs = computeVitestDuration(data);
  return {
    total,
    passed,
    failed,
    skipped: data.numPendingTests || 0,
    durationMs,
    status: failed > 0 ? "fail" : "pass",
    tests: extractVitestTests(data),
    detail: extractVitestFailures(data),
  };
}

// Full per-test list (all statuses) for the suite detail page.
function extractVitestTests(data) {
  const tests = [];
  for (const tr of data.testResults || []) {
    for (const ar of tr.assertionResults || []) {
      tests.push({
        name: ar.fullName || ar.title,
        file: tr.name || "",
        status: ar.status, // passed | failed | skipped | pending
        durationMs: ar.duration ?? 0,
        message: ar.status === "failed" ? (ar.failureMessages || []).join("\n").replace(/\u001b\[[0-9;]*m/g, "").slice(0, 800) : "",
      });
    }
  }
  return tests;
}

function computeVitestDuration(data) {
  let maxEnd = 0;
  let minStart = Infinity;
  for (const tr of data.testResults || []) {
    if (tr.startTime) minStart = Math.min(minStart, tr.startTime);
    if (tr.endTime) maxEnd = Math.max(maxEnd, tr.endTime);
  }
  return Number.isFinite(minStart) ? maxEnd - minStart : 0;
}

function extractVitestFailures(data) {
  const failures = [];
  for (const tr of data.testResults || []) {
    for (const ar of tr.assertionResults || []) {
      if (ar.status === "failed") {
        failures.push({
          name: ar.fullName || ar.title,
          message: (ar.failureMessages || []).join("\n").slice(0, 800),
        });
      }
    }
  }
  return failures;
}

function parsePlaywright(files) {
  // files: array of raw playwright JSON objects (one per browser)
  const valid = files.filter(Boolean);
  if (!valid.length) return null;

  let total = 0,
    passed = 0,
    failed = 0,
    flaky = 0,
    skipped = 0;
  const projects = {};
  const failures = [];
  const tests = []; // full per-test list for the detail page
  let startMin = Infinity,
    endMax = 0;

  for (const data of valid) {
    const stats = data.stats || {};
    // Each per-file JSON is already filtered to one browser (--project=X), but we
    // bucket by each test's own projectName so the projects map is always correct.
    walkSuites(data.suites || [], (spec) => {
      for (const test of spec.tests || []) {
        const projName = test.projectName || "unknown";
        // Real outcome lives in results[].status (the last result), NOT test.status.
        const lastResult = test.results?.[test.results.length - 1];
        const outcome = lastResult?.status || "unknown"; // passed | failed | skipped
        total++;
        if (!projects[projName]) projects[projName] = { total: 0, passed: 0, failed: 0 };
        projects[projName].total++;
        const err = lastResult?.error;
        tests.push({
          name: spec.title,
          file: spec.file,
          project: projName,
          status: outcome,
          durationMs: Math.round(lastResult?.duration ?? 0),
          message: outcome === "failed" ? (err?.message || "").replace(/\u001b\[[0-9;]*m/g, "").slice(0, 800) : "",
        });
        if (outcome === "passed") {
          passed++;
          projects[projName].passed++;
        } else if (outcome === "failed") {
          failed++;
          projects[projName].failed++;
          failures.push({
            project: projName,
            name: spec.title,
            file: spec.file,
            message: (err?.message || "").replace(/\u001b\[[0-9;]*m/g, "").slice(0, 800),
          });
        } else if (outcome === "skipped") {
          skipped++;
        }
      }
    });
    if (stats.startTime) startMin = Math.min(startMin, new Date(stats.startTime).getTime());
  }

  // duration from stats of each file
  let durationMs = 0;
  for (const data of valid) {
    if (data.stats?.duration) durationMs += data.stats.duration;
  }

  return {
    total,
    passed,
    failed,
    flaky,
    skipped,
    durationMs: Math.round(durationMs),
    status: failed > 0 ? "fail" : "pass",
    projects,
    tests,
    detail: failures,
  };
}

function walkSuites(suites, cb) {
  for (const s of suites) {
    if (s.specs) for (const spec of s.specs) cb(spec);
    if (s.suites) walkSuites(s.suites, cb);
  }
}

function parseSemgrep(data) {
  if (!data) return null;
  const findings = (data.results || []).map((r) => ({
    rule: r.check_id,
    file: r.path,
    line: r.start?.line,
    severity: (r.extra?.severity || "INFO").toLowerCase(), // error | warning | info
    message: (r.extra?.message || "").slice(0, 500),
  }));
  const errors = data.errors || [];
  return {
    findings: findings.length,
    errors: errors.length,
    status: findings.length > 0 || errors.length > 0 ? "fail" : "pass",
    tests: findings, // reuse `tests` as the item list for the detail page
    detail: findings,
  };
}

// ---- Main ----

function main() {
  const vitest = parseVitest(readJson("vitest.json"));
  const pwFiles = fs
    .readdirSync(LATEST)
    .filter((f) => f.startsWith("playwright-") && f.endsWith(".json"))
    .map((f) => readJson(f));
  const playwright = parsePlaywright(pwFiles);
  const semgrep = parseSemgrep(readJson("semgrep.json"));

  // Split visual out of e2e for its own trend: visual tests are in visual.spec.js.
  const visual = extractVisual(playwright, pwFiles);
  const e2e = subtractVisual(playwright, visual);

  const record = {
    date: new Date().toISOString(),
    commit: git("rev-parse --short HEAD"),
    branch: git("rev-parse --abbrev-ref HEAD"),
    suites: {
      unit: vitest,
      e2e,
      visual,
      sast: semgrep,
    },
  };

  // Load existing history, prepend, cap.
  let history = { runs: [] };
  if (fs.existsSync(HISTORY_PATH)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
    } catch {}
  }
  if (!Array.isArray(history.runs)) history.runs = [];
  history.runs.unshift(record);
  history.runs = history.runs.slice(0, MAX_RUNS);

  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
  fs.writeFileSync(path.join(LATEST, "summary.json"), JSON.stringify(record, null, 2));

  console.log(`[report] run ${record.commit} @ ${record.date}`);
  for (const [k, v] of Object.entries(record.suites)) {
    if (!v) {
      console.log(`  ${k}: (no data)`);
      continue;
    }
    if (k === "sast") console.log(`  ${k}: ${v.findings} findings, ${v.errors} errors [${v.status}]`);
    else console.log(`  ${k}: ${v.passed}/${v.total} passed, ${v.failed} failed [${v.status}]`);
  }
  console.log(`[report] history now has ${history.runs.length} run(s)`);
}

function extractVisual(playwrightSummary, pwFiles) {
  // Re-walk playwright files counting only visual.spec.js tests.
  let total = 0,
    passed = 0,
    failed = 0;
  const projects = {};
  const tests = [];
  for (const data of pwFiles.filter(Boolean)) {
    walkSuites(data.suites || [], (spec) => {
      if (!/visual\.spec\.js/.test(spec.file || "")) return;
      for (const test of spec.tests || []) {
        const projName = test.projectName || "unknown";
        const lastResult = test.results?.[test.results.length - 1];
        const o = lastResult?.status;
        total++;
        if (!projects[projName]) projects[projName] = { total: 0, passed: 0, failed: 0 };
        projects[projName].total++;
        tests.push({
          name: spec.title,
          file: spec.file,
          project: projName,
          status: o,
          durationMs: Math.round(lastResult?.duration ?? 0),
          message: o === "failed" ? (lastResult?.error?.message || "").replace(/\u001b\[[0-9;]*m/g, "").slice(0, 800) : "",
        });
        if (o === "passed") {
          passed++;
          projects[projName].passed++;
        } else if (o === "failed") {
          failed++;
          projects[projName].failed++;
        }
      }
    });
  }
  if (!total) return null;
  let durationMs = 0;
  for (const data of pwFiles.filter(Boolean)) if (data.stats?.duration) durationMs += data.stats.duration / 4;
  return {
    total,
    passed,
    failed,
    skipped: 0,
    flaky: 0,
    durationMs: Math.round(durationMs),
    status: failed > 0 ? "fail" : "pass",
    projects,
    tests,
    detail: [],
  };
}

function subtractVisual(playwrightSummary, visual) {
  if (!playwrightSummary || !visual) return playwrightSummary;
  const e2e = { ...playwrightSummary };
  e2e.total = playwrightSummary.total - visual.total;
  e2e.passed = playwrightSummary.passed - visual.passed;
  e2e.failed = playwrightSummary.failed - visual.failed;
  e2e.skipped = (playwrightSummary.skipped || 0) - (visual.skipped || 0);
  e2e.flaky = (playwrightSummary.flaky || 0) - (visual.flaky || 0);
  // per-project subtraction
  for (const [proj, v] of Object.entries(visual.projects)) {
    if (e2e.projects?.[proj]) {
      e2e.projects[proj].total -= v.total;
      e2e.projects[proj].passed -= v.passed;
      e2e.projects[proj].failed -= v.failed;
    }
  }
  e2e.detail = (playwrightSummary.detail || []).filter((d) => !/visual\.spec\.js/.test(d.file || ""));
  e2e.tests = (playwrightSummary.tests || []).filter((t) => !/visual\.spec\.js/.test(t.file || ""));
  e2e.status = e2e.failed > 0 ? "fail" : "pass";
  return e2e;
}

main();

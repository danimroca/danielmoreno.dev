// Runs Playwright per browser project, writing each to reports/latest/playwright-<browser>.json.
// Skips browsers that can't launch locally (e.g. webkit without system deps) so the
// report still builds from whatever is available. In CI all three run.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "reports", "latest");
fs.mkdirSync(OUT_DIR, { recursive: true });

// Browsers to attempt. Override with E2E_BROWSERS="chromium,firefox" env var.
const browsers = (process.env.E2E_BROWSERS || "chromium,firefox,webkit")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

let anyOk = false;
for (const browser of browsers) {
  const outFile = path.join(OUT_DIR, `playwright-${browser}.json`);
  console.log(`[e2e-reports] running ${browser} → ${path.relative(ROOT, outFile)}`);
  const res = spawnSync("npx", ["playwright", "test", `--project=${browser}`, "--reporter=json"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 600_000,
  });
  const stdout = res.stdout || "";
  // Playwright JSON reporter prints the JSON to stdout.
  try {
    const jsonStart = stdout.indexOf("{");
    if (jsonStart === -1) throw new Error("no JSON in output");
    const parsed = JSON.parse(stdout.slice(jsonStart));
    fs.writeFileSync(outFile, JSON.stringify(parsed, null, 2));
    const s = parsed.stats || {};
    console.log(`  ${browser}: ${s.expected ?? "?"} expected, ${s.unexpected ?? "?"} unexpected`);
    anyOk = true;
  } catch (e) {
    console.warn(`  ${browser}: could not capture JSON (${e.message}); skipping`);
    // Remove stale file if present
    if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
  }
}

if (!anyOk) {
  console.error("[e2e-reports] no browser produced a report");
  process.exit(1);
}

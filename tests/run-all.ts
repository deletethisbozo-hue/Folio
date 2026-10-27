/* Run every suite in tests/ and summarise.
 *
 * These are plain scripts rather than a test framework: they drive real
 * Chromium renders, real Pandoc, and a real Express server, and each one prints
 * what it checked so a failure reads as a sentence rather than a stack trace.
 * The runner just sequences them — they can't share a browser or a port.
 * Folio release qualification runs this full list on Linux and Windows
 * before the Windows installer and portable binaries are accepted.
 *
 *   npm test              all suites
 *   npm test -- blues     only suites whose name matches
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

// Slowest last: the ones that render the whole book take minutes, and a fast
// failure in ingestion should surface before you wait for them.
const ORDER = [
  "atomic-write.test.ts",
  "config-concurrency.test.ts",
  "save-queue.test.ts",
  "write-studio.test.ts",
  "writing-analysis-lazy.test.ts",
  "project-file.test.ts",
  "project-file-api.test.ts",
  "project-file-association.test.ts",
  "typesetting-language.test.ts",
  "ingestion.test.ts",
  "versioning.test.ts",
  "immutable-release-guard.test.ts",
  "destinations.test.ts",
  "review-folder.test.ts",
  "dropcap.test.ts",
  "dropcap-filter-regression.test.ts",
  "recent-projects.test.ts",
  "recent-persistence.test.ts",
  "global-library-persistence.test.ts",
  "image-page.test.ts",
  "legacy-illustration.test.ts",
  "legacy-tall-illustration.test.ts",
  "illustration-ui.test.ts",
  "illustration-v2-ui.test.ts",
  "export-download-ui.test.ts",
  "print-preview-ui.test.ts",
  "folio-runtime.test.ts",
  "ui-runtime.test.ts",
  "web-export.test.ts",
  "acceptance.test.ts",
  "blues-format.test.ts",
  "cli.test.ts",
  "v300-second-draft.test.ts",
];

const filter = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const present = (await fs.readdir(HERE)).filter((f) => f.endsWith(".test.ts"));
const unknown = present.filter((f) => !ORDER.includes(f));
if (unknown.length) console.warn(`  ⚠ not in the run order, running last: ${unknown.join(", ")}`);

const suites = [...ORDER.filter((f) => present.includes(f)), ...unknown].filter(
  (f) => filter.length === 0 || filter.some((q) => f.includes(q)),
);

const DEFAULT_SUITE_TIMEOUT_MS = 90_000;
const SUITE_TIMEOUTS_MS: Record<string, number> = {
  "print-preview-ui.test.ts": 180_000,
  "illustration-v2-ui.test.ts": 240_000,
  "export-download-ui.test.ts": 240_000,
  "illustration-preview-ui.test.ts": 150_000,
  // ui-runtime intentionally exercises a 100,000+ word Writer paste and a
  // narrow-device recomposition with an explicit 120s assertion timeout.
  // Keep the runner watchdog above that contract so it reports a real stage
  // failure instead of killing the suite before the assertion can diagnose it.
  "ui-runtime.test.ts": 180_000,
};

function run(file: string): Promise<{ code: number; out: string; timedOut: boolean; timeoutMs: number }> {
  return new Promise((resolve) => {
    const child = spawn("node", ["--import", "tsx", path.join(HERE, file)], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let settled = false;
    const timeoutMs = SUITE_TIMEOUTS_MS[file] ?? DEFAULT_SUITE_TIMEOUT_MS;
    const finish = (code: number, timedOut: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, out, timedOut, timeoutMs });
    };
    const timer = setTimeout(() => {
      out += `\n✗ suite timeout — ${file} exceeded ${Math.round(timeoutMs / 1000)}s\n`;
      child.kill("SIGKILL");
      finish(124, true);
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => finish(code ?? 0, false));
    child.on("error", (error) => {
      out += `\nError starting ${file}: ${error instanceof Error ? error.message : String(error)}\n`;
      finish(1, false);
    });
  });
}

let totalPass = 0;
let totalFail = 0;
const failed: string[] = [];

for (const file of suites) {
  const started = Date.now();
  const { code, out, timedOut, timeoutMs } = await run(file);
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const passed = m ? Number(m[1]) : 0;
  const failedN = m ? Number(m[2]) : code === 0 ? 0 : 1;
  totalPass += passed;
  totalFail += failedN;
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  const status = failedN === 0 && code === 0 ? "✓" : "✗";
  console.log(`${status} ${file.replace(".test.ts", "").padEnd(16)} ${String(passed).padStart(3)} passed  ${String(failedN).padStart(2)} failed  ${secs.padStart(3)}s`);
  if (failedN > 0 || code !== 0) {
    failed.push(file);
    if (timedOut) console.log(`      ✗ ${file} exceeded the ${Math.round(timeoutMs / 1000)}s per-suite watchdog`);
    // Preserve full failing-suite evidence so the exact assertion and stack are available.
    console.log(out);
    // Also repeat the failing lines for the job summary.
    out
      .split("\n")
      .filter((l) => l.includes("✗") || /Error|error TS/.test(l))
      .slice(0, 12)
      .forEach((l) => console.log(`      ${l.trim()}`));
  }
}

console.log(`\n${totalPass} passed, ${totalFail} failed across ${suites.length} suites`);
if (failed.length) console.log(`failing: ${failed.join(", ")}`);
process.exit(totalFail === 0 ? 0 : 1);

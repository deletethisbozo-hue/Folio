import { promises as fs } from "node:fs";

const workflow = ".github/workflows/windows-release.yml";
let source = await fs.readFile(workflow, "utf8");
source = source
  .replace("Verify Folio 2.0.0 version consistency", "Verify Folio 2.0.1 version consistency")
  .replace('if ($version -ne "2.0.0") { throw "Windows release is scoped to Folio 2.0.0, found $version." }', 'if ($version -ne "2.0.1") { throw "Windows release is scoped to Folio 2.0.1, found $version." }')
  .replace(/--notes "Folio 2\.0 is a major workflow and publishing update:[^\n]*"/, '--notes "Folio 2.0.1 is a focused reliability patch: Recent Books now persists across app restarts and changing localhost ports instead of disappearing with browser-origin storage; asynchronous theme switching is qualified without racing the previous preview render; and the Windows package is revalidated end-to-end. The release is gated by typecheck, the complete formatter/UI suite on Linux and Windows, visual/typesetting QA, the full Print PDF matrix, packaged executable smoke tests, EPUB/PDF/print export checks and SHA-256 hashing."');
if (!source.includes('if ($version -ne "2.0.1")')) throw new Error("2.0.1 release guard patch failed");
await fs.writeFile(workflow, source, "utf8");
await fs.rm("scripts/prepare-v201-release-workflow.mjs", { force: true });
await fs.rm(".github/workflows/apply-v201-release-workflow.yml", { force: true });
console.log("Prepared Folio 2.0.1 release workflow and removed one-shot helpers.");

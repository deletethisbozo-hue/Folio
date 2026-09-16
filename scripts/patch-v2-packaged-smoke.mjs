import { readFile, writeFile, rm } from "node:fs/promises";

const smokePath = "scripts/packaged-ui-smoke.mjs";
const workflowPath = ".github/workflows/v2-packaged-smoke-patch.yml";
const scriptPath = "scripts/patch-v2-packaged-smoke.mjs";

let source = await readFile(smokePath, "utf8");

const replacements = [
  ['await page.waitForSelector(".empty-actions", { timeout: 15000 });', 'await page.waitForSelector(".start-actions", { timeout: 15000 });'],
  ['  await page.waitForFunction(() => /Chapter\\s+\\d+\\s+pages\\s+·\\s+Book\\s+~?\\d+\\s+pages/.test(document.querySelector(".page-counts")?.textContent || ""), { timeout: 15000 });\n', ''],
  ['  if (themes !== 29) throw new Error("Packaged style browser expected 29 themes after retiring Black Psalter, found " + themes + ".");', '  if (themes !== 16) throw new Error("Packaged Folio 2.0 style browser expected exactly 16 curated themes, found " + themes + ".");'],
  ['  await page.waitForFunction(() => /Chapter\\s+\\d+\\s+pages\\s+·\\s+Book\\s+~?\\d+\\s+pages/.test(document.querySelector(".page-counts")?.textContent || ""), { timeout: 5000 });\n', ''],
  ['  console.log("Packaged UI passed: page counts, responsive 100,000-word editing, rich-text sample, persistent preview, body-safe rename, 20+ ornaments, 29 themes, 6 device profiles.");', '  console.log("Packaged Folio 2.0 UI passed: startup screen, responsive 100,000-word editing, rich-text sample, persistent preview, body-safe rename, 20+ ornaments, 16 curated themes, and grouped device profiles.");'],
];

for (const [before, after] of replacements) {
  if (!source.includes(before)) throw new Error(`Expected packaged smoke fragment was not found: ${before.slice(0, 100)}`);
  source = source.replace(before, after);
}

await writeFile(smokePath, source);
await rm(workflowPath, { force: true });
await rm(scriptPath, { force: true });

import { promises as fs } from "node:fs";

const file = "tests/ui-runtime.test.ts";
let source = await fs.readFile(file, "utf8");

function replaceOnce(before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Patch anchor missing: ${label}`);
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`Patch anchor is not unique: ${label}`);
  source = source.slice(0, index) + after + source.slice(index + before.length);
}

replaceOnce(
  '  check("sample opens in a genuinely editable rich-text surface", await page.$eval(".rich-editor", (el) => (el as HTMLElement).contentEditable === "true"));\n\n  await page.click(".contents-row:not(.chapter-row)");',
  '  check("sample opens in a genuinely editable rich-text surface", await page.$eval(".rich-editor", (el) => (el as HTMLElement).contentEditable === "true"));\n\n  await page.click(".cover-row");\n  await stage("cover workspace", () => page.waitForSelector(".cover-editor-panel"));\n  await stage("cover preview image", () => page.waitForFunction(() => {\n    const image = document.querySelector(".cover-preview-surface img") as HTMLImageElement | null;\n    return Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0);\n  }));\n  check("cover is a first-class workspace item and appears in device preview", true);\n\n  await page.click(".contents-row:not(.chapter-row):not(.cover-row)");',
  "cover workspace browser regression",
);

source = source.replaceAll(
  '.contents-list > .contents-row:not(.chapter-row)',
  '.contents-list > .contents-row:not(.chapter-row):not(.cover-row)',
);

await fs.writeFile(file, source, "utf8");
console.log("Applied Folio 2.0 cover UI regression patch.");

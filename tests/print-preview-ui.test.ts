import express from "express";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

console.log("\nReader ↔ Print preview lifecycle");
const app = express();
app.use(express.json({ limit: "5mb" }));
registerApi(app);
registerEditorApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "web", "dist", "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

let stage = "open sample";
try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(45_000);
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(base, { waitUntil: "networkidle0" });

  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample button missing");
    (button as HTMLButtonElement).click();
  });
  await page.waitForSelector('.rich-editor[contenteditable="true"]');
  await page.waitForFunction(() => Boolean(document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter")));
  check("reader preview opens on a real chapter", true);

  stage = "switch Reader -> Print";
  console.log(`    stage: ${stage}`);
  await page.select('select[aria-label="Preview device"]', "print");
  await page.waitForFunction(() => {
    const frame = document.querySelector("iframe") as HTMLIFrameElement | null;
    return Boolean(frame?.contentDocument?.querySelector(".pagedjs_pages .pagedjs_page"));
  }, { timeout: 45_000 });
  const printPages = await page.$eval("iframe", (frame) => frame.contentDocument?.querySelectorAll(".pagedjs_page").length ?? 0);
  const printRect = await page.$eval("iframe", (frame) => {
    const pageNode = frame.contentDocument?.querySelector(".pagedjs_page") as HTMLElement | null;
    const rect = pageNode?.getBoundingClientRect();
    return rect ? { width: rect.width, height: rect.height } : { width: 0, height: 0 };
  });
  check("switching Reader → Print displays physical paginated pages", printPages > 0, `${printPages} pages`);
  check("print page is visibly sized, not merely present in hidden DOM", printRect.width > 120 && printRect.height > 160, `${printRect.width.toFixed(1)}×${printRect.height.toFixed(1)}`);

  // Changing trim must re-run Paged.js without losing the preview, surfacing a
  // global error, or leaving behind the dimensions of the previous print size.
  for (const [trim, expectedWidth, expectedHeight] of [
    ["5x8", 5 * 96, 8 * 96],
    ["6x9", 6 * 96, 9 * 96],
    ["5.5x8.5", 5.5 * 96, 8.5 * 96],
  ] as const) {
    stage = `change Print trim -> ${trim}`;
    console.log(`    stage: ${stage}`);
    await page.select('select[aria-label="Print trim"]', trim);
    await page.waitForFunction(({ width, height }) => {
      const frame = document.querySelector("iframe") as HTMLIFrameElement | null;
      const sheet = frame?.contentDocument?.querySelector<HTMLElement>(".pagedjs_page");
      if (!sheet) return false;
      const rect = sheet.getBoundingClientRect();
      return Math.abs(rect.width - width) < 3 && Math.abs(rect.height - height) < 3;
    }, { timeout: 45_000 }, { width: expectedWidth, height: expectedHeight });
    const hasError = await page.evaluate(() => Boolean(document.querySelector(".preview-error, .error-banner, .error-text")));
    check(`changing print trim to ${trim} keeps paginated pages without an error`, !hasError);
  }

  stage = "switch Print -> Reader";
  console.log(`    stage: ${stage}`);
  await page.select('select[aria-label="Preview device"]', "kindle-6-8");
  await page.waitForFunction(() => {
    const frame = document.querySelector("iframe") as HTMLIFrameElement | null;
    const doc = frame?.contentDocument;
    return Boolean(doc?.querySelector("section.chapter") && !doc.querySelector(".pagedjs_pages"));
  });
  check("switching Print → Reader restores the semantic reader preview", true);
} catch (error) {
  console.error(`Error: Print Preview stalled during stage: ${stage}`);
  throw error;
} finally {
  server.close();
  await closeBrowser();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

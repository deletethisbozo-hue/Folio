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

  const sectionHeadings = await page.$eval("iframe", (frame) => [...(frame.contentDocument?.querySelectorAll("section.chapter > h1") ?? [])].map((heading) => heading.textContent?.trim() ?? ""));
  stage = "switch Print preview to entire book";
  console.log(`    stage: ${stage}`);
  await page.select('select[aria-label="Print preview scope"]', "book");
  await page.waitForFunction(() => {
    const frame = document.querySelector("iframe") as HTMLIFrameElement | null;
    const headings = [...(frame?.contentDocument?.querySelectorAll("section.chapter > h1") ?? [])].map((heading) => heading.textContent?.trim() ?? "");
    return ["The Letter", "The Garden", "The Mechanism"].every((title) => headings.includes(title));
  }, { timeout: 90_000 });
  const bookPreview = await page.$eval("iframe", (frame) => ({
    headings: [...(frame.contentDocument?.querySelectorAll("section.chapter > h1") ?? [])].map((heading) => heading.textContent?.trim() ?? ""),
    pages: frame.contentDocument?.querySelectorAll(".pagedjs_pages .pagedjs_page").length ?? 0,
  }));
  check("whole-book print preview paginates all sample chapters together", ["The Letter", "The Garden", "The Mechanism"].every((title) => bookPreview.headings.includes(title)) && bookPreview.pages >= printPages, `${bookPreview.headings.length} chapter headings · ${bookPreview.pages} pages; section had ${sectionHeadings.length} heading`);

  stage = "switch Print preview back to current section";
  console.log(`    stage: ${stage}`);
  await page.select('select[aria-label="Print preview scope"]', "section");
  await page.waitForFunction(() => {
    const frame = document.querySelector("iframe") as HTMLIFrameElement | null;
    const headings = [...(frame?.contentDocument?.querySelectorAll("section.chapter > h1") ?? [])].map((heading) => heading.textContent?.trim() ?? "");
    return headings.includes("The Letter") && !headings.includes("The Garden") && !headings.includes("The Mechanism");
  }, { timeout: 90_000 });
  check("current-section print preview remains available after whole-book preview", true);

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
      // Print preview deliberately zooms the page container to fit the pane, so
      // getBoundingClientRect() is the visible (scaled) size. The computed page
      // box remains the authoritative physical trim at 96 CSS px per inch.
      const style = frame?.contentWindow?.getComputedStyle(sheet);
      const physicalWidth = Number.parseFloat(style?.width ?? "0");
      const physicalHeight = Number.parseFloat(style?.height ?? "0");
      return Math.abs(physicalWidth - width) < 3 && Math.abs(physicalHeight - height) < 3;
    }, { timeout: 45_000 }, { width: expectedWidth, height: expectedHeight });
    const geometry = await page.$eval("iframe", (frame) => {
      const sheet = frame.contentDocument?.querySelector<HTMLElement>(".pagedjs_page");
      if (!sheet) return { visibleWidth: 0, visibleHeight: 0, physicalWidth: 0, physicalHeight: 0 };
      const rect = sheet.getBoundingClientRect();
      const style = frame.contentWindow?.getComputedStyle(sheet);
      return {
        visibleWidth: rect.width,
        visibleHeight: rect.height,
        physicalWidth: Number.parseFloat(style?.width ?? "0"),
        physicalHeight: Number.parseFloat(style?.height ?? "0"),
      };
    });
    const hasError = await page.evaluate(() => Boolean(document.querySelector(".preview-error, .error-banner, .error-text")));
    const fit = await page.$eval("iframe", (frame) => {
      const iframe = frame as HTMLIFrameElement;
      const pages = iframe.contentDocument?.querySelector<HTMLElement>(".pagedjs_pages");
      const sheet = iframe.contentDocument?.querySelector<HTMLElement>(".pagedjs_page");
      const physicalWidth = Number.parseFloat(iframe.contentWindow?.getComputedStyle(sheet!).width ?? "0");
      const expected = Math.max(.28, Math.min(1, (Math.max(280, iframe.clientWidth || iframe.parentElement?.clientWidth || 576) - 28) / physicalWidth));
      return {
        actual: Number(iframe.dataset.folioPrintFitZoom || "0"),
        expected,
        cssZoom: Number.parseFloat(pages?.style.zoom ?? "0"),
        readout: document.querySelector<HTMLElement>(".preview-zoom-readout")?.textContent?.trim() ?? "",
      };
    });
    check(`changing print trim to ${trim} keeps paginated pages without an error`, !hasError);
    check(
      `changing print trim to ${trim} recalculates fit from physical page width without changing user zoom`,
      Math.abs(fit.actual - fit.expected) < .02 && Math.abs(fit.cssZoom - fit.actual) < .02 && fit.readout.includes("100%"),
      JSON.stringify(fit),
    );
    check(
      `changing print trim to ${trim} keeps a visible fitted sheet`,
      geometry.visibleWidth > 120 && geometry.visibleHeight > 160,
      `${geometry.visibleWidth.toFixed(1)}×${geometry.visibleHeight.toFixed(1)} visible; ${geometry.physicalWidth.toFixed(1)}×${geometry.physicalHeight.toFixed(1)} physical`,
    );
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

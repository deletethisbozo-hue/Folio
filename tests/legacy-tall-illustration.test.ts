import assert from "node:assert/strict";
import path from "node:path";
import { promises as fs } from "node:fs";
import { makeBookFixture } from "./fixtures/book.ts";
import { loadBook } from "../server/pipeline/ingest.ts";
import { renderHtml } from "../server/pipeline/render-html.ts";
import { renderPrintPdf, renderPrintPreviewHtml } from "../server/pipeline/render-print.ts";
import { getBrowser, closeBrowser } from "../server/pipeline/render-pdf.ts";
import { DEFAULT_PRINT } from "../server/print.ts";

let checks = 0;
const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const fixture = await makeBookFixture();
try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const imageData = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 200; canvas.height = 2000;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#9b6a35"; context.fillRect(0, 0, 200, 2000);
    context.fillStyle = "#fff"; context.fillRect(20, 20, 160, 1960);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await fs.mkdir(path.join(fixture.bookDir, "assets"), { recursive: true });
  await fs.writeFile(path.join(fixture.bookDir, "assets", "tall-legacy.png"), Buffer.from(imageData, "base64"));
  const { book } = await loadBook(fixture.bookDir);
  const chapter = book.sections.find((section) => section.kind === "chapter")!;
  chapter.markdown = "BEFORE_TALL_ART\n\n![Tall legacy map](assets/tall-legacy.png){.full-page-image .fit-contain}\n\nAFTER_TALL_ART";
  book.sections = [chapter];
  const source = JSON.stringify(book);
  const html = await renderHtml(book, "html");
  check(/class="[^"]*folio-illustration/.test(html), "Legacy artwork must use the ordinary illustration sizing path");
  check(!/class="[^"]*(?:folio-inline-image-page|full-page-image)/.test(html), "No forced chapter page classes may survive");
  check(!/<figcaption[^>]*>[^<]*Tall legacy map/.test(html), "Semantic alt text must not become a visible caption");
  const options = { ...DEFAULT_PRINT, trim: "5x8" };
  const preview = await renderPrintPreviewHtml(book, options);
  await page.emulateMediaType("print");
  await page.setContent(preview.html, { waitUntil: "load" });
  const measured = await page.evaluate(() => {
    const image = document.querySelector<HTMLImageElement>(".pagedjs_page img.folio-illustration");
    const box = image?.getBoundingClientRect();
    const area = image?.closest(".pagedjs_area")?.getBoundingClientRect();
    return { height: image?.naturalHeight, box: box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height } : null, area: area ? { left: area.left, right: area.right, top: area.top, bottom: area.bottom } : null, text: document.body.innerText.replace(/\u00ad/g, "") };
  });
  check(measured.height === 2000 && measured.box && measured.box.height > 20, "The actual tall artwork must remain visible");
  check(measured.box && measured.area && measured.box.top >= measured.area.top - 1 && measured.box.bottom <= measured.area.bottom + 1, "Artwork must fit vertically inside the physical page content box");
  check(measured.box && measured.area && measured.box.left >= measured.area.left - 1 && measured.box.right <= measured.area.right + 1, "Artwork must fit horizontally inside the physical page content box");
  check(measured.text.includes("BEFORE_TALL_ART"), "Text before legacy artwork must remain in print");
  check(measured.text.includes("AFTER_TALL_ART"), "Text after legacy artwork must remain in print");
  const pdf = await renderPrintPdf(book, options);
  check(pdf.buffer.subarray(0, 5).toString() === "%PDF-" && pdf.meta.pages >= 1, "The same source must pass strict PDF export");
  check(JSON.stringify(book) === source, "Preview and export must not rewrite source chapters");
  await page.close();
  console.log(`${checks} passed, 0 failed`);
} finally { await closeBrowser(); await fixture.cleanup(); }

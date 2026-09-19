import path from "node:path";
import { promises as fs } from "node:fs";
import express from "express";
import type { AddressInfo } from "node:net";
import { loadBook } from "../server/pipeline/ingest.ts";
import { renderPrintPdf } from "../server/pipeline/render-print.ts";
import { renderPdf, getBrowser, closeBrowser } from "../server/pipeline/render-pdf.ts";
import { renderEpub } from "../server/pipeline/render-epub.ts";
import { renderHtml } from "../server/pipeline/render-html.ts";
import { NEW_PRODUCTION_THEMES, SUPPORTED_THEMES } from "../server/pipeline/themes.ts";
import { DEFAULT_PRINT } from "../server/print.ts";
import { ROOT } from "../server/pipeline/paths.ts";
import type { Book, ThemeName } from "../server/pipeline/types.ts";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";

const outDir = path.join(ROOT, "build", "qa-theme-expansion");
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const { book } = await loadBook(path.join(ROOT, "samples", "clockwork-garden"));

function themed(source: Book, theme: ThemeName): Book {
  return { ...source, meta: { ...source.meta, theme } };
}
function assertPdf(label: string, buffer: Buffer, pages?: number) {
  if (buffer.subarray(0, 5).toString() !== "%PDF-" || buffer.length < 40_000) {
    throw new Error(`${label}: invalid or implausibly small PDF (${buffer.length} bytes)`);
  }
  if (pages !== undefined && pages < 1) throw new Error(`${label}: no pages`);
}

const results: Array<Record<string, unknown>> = [];
const browser = await getBrowser();
try {
  for (const theme of NEW_PRODUCTION_THEMES) {
    const current = themed(book, theme);

    const paperback = await renderPrintPdf(current, {
      ...DEFAULT_PRINT,
      trim: "5x8",
      binding: "paperback",
    });
    assertPdf(`${theme} 5x8 paperback`, paperback.buffer, paperback.meta.pages);

    const hardcover = await renderPrintPdf(current, {
      ...DEFAULT_PRINT,
      trim: "6x9",
      binding: "hardcover",
    });
    assertPdf(`${theme} 6x9 hardcover`, hardcover.buffer, hardcover.meta.pages);

    const reading = await renderPdf(current);
    assertPdf(`${theme} reading PDF`, reading);

    const epub = await renderEpub(current, "universal");
    if (epub.buffer.subarray(0, 2).toString() !== "PK" || epub.bytes < 20_000) {
      throw new Error(`${theme}: invalid EPUB (${epub.bytes} bytes)`);
    }

    // Capture the actual rendered chapter opening using the same HTML/theme
    // pipeline as the reader. The screenshot is evidence, not a substitute for
    // the strict compositor/overflow gates above.
    const html = await renderHtml(current, "print");
    const page = await browser.newPage();
    await page.setViewport({ width: 760, height: 980, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => {
      const chapter = document.querySelector("section.chapter");
      if (!chapter) throw new Error("Chapter missing from rendered theme proof");
      for (const section of [...document.querySelectorAll("main.book > section")]) {
        if (section !== chapter) section.remove();
      }
      const main = document.querySelector("main.book") as HTMLElement | null;
      if (main) {
        main.style.maxWidth = "34em";
        main.style.margin = "0 auto";
        main.style.padding = "1.4em 2em 4em";
      }
    });
    await page.screenshot({ path: path.join(outDir, `${theme}.png`), fullPage: true });
    await page.close();

    results.push({
      theme,
      paperbackPages: paperback.meta.pages,
      paperbackBytes: paperback.buffer.length,
      hardcoverPages: hardcover.meta.pages,
      hardcoverBytes: hardcover.buffer.length,
      readingBytes: reading.length,
      epubBytes: epub.bytes,
    });
    console.log(`✓ ${theme}: print 5x8 + 6x9 hardcover + reading PDF + EPUB + proof`);
  }

  // The style library itself must expose all 30 themes, not merely the server.
  const app = express();
  app.use(express.json({ limit: "64mb" }));
  registerApi(app);
  registerEditorApi(app);
  app.use(express.static(path.join(ROOT, "web", "dist")));
  app.get("*", (_request, response) => response.sendFile(path.join(ROOT, "web", "dist", "index.html")));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const ui = await browser.newPage();
    await ui.setViewport({ width: 1680, height: 1000, deviceScaleFactor: 1 });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await ui.goto(base, { waitUntil: "networkidle0" });
    await ui.evaluate(() => {
      const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.includes("Open Sample"));
      if (!button) throw new Error("Open Sample missing");
      button.click();
    });
    await ui.waitForSelector('[data-command="design"]');
    await ui.click('[data-command="design"]');
    await ui.waitForSelector(".theme-gallery");
    const visibleThemes = await ui.$$eval(".theme-sample", (nodes) => nodes.map((node) => node.getAttribute("data-theme")));
    if (visibleThemes.length !== 30 || SUPPORTED_THEMES.some((theme) => !visibleThemes.includes(theme))) {
      throw new Error(`Style Library theme mismatch: ${visibleThemes.length} visible`);
    }

    // Temporarily expand the modal only for the QA capture so one image shows
    // the entire production catalog. No product CSS is changed.
    await ui.addStyleTag({ content: `
      .style-overlay{position:absolute!important;inset:0!important;min-height:100vh!important;overflow:visible!important}
      .style-library{height:auto!important;max-height:none!important;overflow:visible!important}
      .style-library-body{height:auto!important;max-height:none!important;overflow:visible!important}
      .style-content,.theme-gallery{height:auto!important;max-height:none!important;overflow:visible!important}
    `});
    await ui.screenshot({ path: path.join(outDir, "gallery-30.png"), fullPage: true });
    await ui.close();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  await fs.writeFile(
    path.join(outDir, "report.json"),
    JSON.stringify({ supportedThemes: SUPPORTED_THEMES, newThemes: NEW_PRODUCTION_THEMES, results }, null, 2),
    "utf8",
  );
  console.log(`\nQualified ${results.length} new themes; production catalog exposes ${SUPPORTED_THEMES.length} themes.`);
} finally {
  await closeBrowser();
}

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Browser, LaunchOptions } from "puppeteer";
import puppeteer from "puppeteer";
import { PDFDocument } from "pdf-lib";
import type { Book } from "./types.ts";
import { renderHtml } from "./render-html.ts";
import { alignDropCaps } from "./dropcap.ts";
import { AppError } from "../errors.ts";
import { applyProfessionalHyphenation } from "./hyphenation.ts";
import { composeProfessionalParagraphs, type CompositionProgress } from "./compositor.ts";

let browserPromise: Promise<Browser> | null = null;
let browserGeneration = 0;

function launchBrowser(): Promise<Browser> {
  const generation = ++browserGeneration;
  const options: LaunchOptions = {
    headless: true,
    args: ["--no-sandbox"],
    // Full-book layout includes browser-side typography and pagination work.
    protocolTimeout: 600_000,
  };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) options.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

  const pending = puppeteer.launch(options)
    .then((browser) => {
      // A bundled Chromium can occasionally disappear underneath a long Paged.js
      // render. Never leave that disconnected Browser cached forever: the next
      // preview/export must be allowed to launch a fresh rendering engine.
      browser.once("disconnected", () => {
        if (browserGeneration === generation) browserPromise = null;
      });
      return browser;
    })
    .catch((e) => {
      if (browserGeneration === generation) browserPromise = null;
      throw new AppError(
        "CHROMIUM_LAUNCH",
        "Couldn't start Folio's bundled PDF rendering engine.",
        { detail: (e as Error).message, cause: e },
      );
    });

  browserPromise = pending;
  return pending;
}

export async function getBrowser(): Promise<Browser> {
  const pending = browserPromise;
  if (pending) {
    const browser = await pending;
    if (browser.connected) return browser;

    // The disconnect event normally clears this first, but checking connected
    // here closes the race where a request arrives between the transport dying
    // and Puppeteer's disconnected event being delivered.
    if (browserPromise === pending) browserPromise = null;
  }
  return launchBrowser();
}

export async function closeBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  browserGeneration++;
  if (!pending) return;

  try {
    const browser = await pending;
    if (browser.connected) await browser.close();
  } catch {
    // Nothing useful remains to close after a failed launch/disconnect.
  }
}

function coverMime(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

async function readingCoverDataUrl(book: Book): Promise<string | null> {
  if (!book.coverPath) return null;
  const data = await fs.readFile(book.coverPath);
  return `data:${coverMime(book.coverPath)};base64,${data.toString("base64")}`;
}

/** Render the cover as its own full-bleed 6×9 page. Mixing a zero-margin first page with
 *  margined body pages in one Chromium print makes Chromium shrink the whole document. */
async function renderCoverPdf(browser: Browser, coverDataUrl: string): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.emulateMediaType("print");
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>
        @page { size: 6in 9in; margin: 0; }
        html, body { margin: 0; padding: 0; background: #fff; }
        .cover { width: 6in; height: 9in; display: grid; place-items: center; overflow: hidden; }
        .cover img { width: 100%; height: 100%; display: block; object-fit: contain; object-position: center; }
      </style></head><body><div class="cover"><img alt="" src="${coverDataUrl}"></div></body></html>`,
      { waitUntil: "load" },
    );
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      width: "6in",
      height: "9in",
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Render a reading PDF from the book's styled HTML via headless Chromium. */
export async function renderPdf(book: Book, onProgress?: (progress: CompositionProgress) => void): Promise<Buffer> {
  const html = await renderHtml(book, "print");
  const coverDataUrl = await readingCoverDataUrl(book);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.emulateMediaType("print");
    await page.setContent(html, { waitUntil: "load" });

    // The reading PDF is 6×9 with 0.7in side margins. Compose against its
    // 4.6in text measure before freezing lines into nowrap compositor spans.
    await page.addStyleTag({
      // base.css gives body a 5% side margin and main.book 1.4em side padding. Left
      // in place they shrink the body while main stays 4.6in wide, which pushes
      // the whole text block to the right of the page centre.
      content: "html,body{margin:0!important;padding:0!important;}main.book{box-sizing:border-box!important;width:4.6in!important;max-width:4.6in!important;margin:0!important;padding-left:0!important;padding-right:0!important;}",
    });
    await applyProfessionalHyphenation(page, book);
    await alignDropCaps(page);
    onProgress?.({ completedParagraphs: 0, totalParagraphs: 1, fraction: 0 });
    await composeProfessionalParagraphs(page, book, onProgress);
    onProgress?.({ completedParagraphs: 1, totalParagraphs: 1, fraction: 1 });
    const body = Buffer.from(await page.pdf({
      printBackground: true,
      width: "6in",
      height: "9in",
      margin: { top: "0.75in", bottom: "0.75in", left: "0.7in", right: "0.7in" },
    }));
    if (!coverDataUrl) return body;

    const merged = await PDFDocument.create();
    const cover = await PDFDocument.load(await renderCoverPdf(browser, coverDataUrl));
    const text = await PDFDocument.load(body);
    for (const source of [cover, text]) {
      for (const copied of await merged.copyPages(source, source.getPageIndices())) merged.addPage(copied);
    }
    return Buffer.from(await merged.save());
  } finally {
    // If Chromium itself disconnected, closing its Page can throw a second
    // "Connection closed" error and hide the operation that actually failed.
    await page.close().catch(() => undefined);
  }
}

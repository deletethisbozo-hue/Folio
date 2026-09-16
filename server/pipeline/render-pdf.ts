import { promises as fs } from "node:fs";
import path from "node:path";
import type { Browser, LaunchOptions } from "puppeteer";
import puppeteer from "puppeteer";
import type { Book } from "./types.ts";
import { renderHtml } from "./render-html.ts";
import { alignDropCaps } from "./dropcap.ts";
import { AppError } from "../errors.ts";
import { applyProfessionalHyphenation } from "./hyphenation.ts";
import { composeProfessionalParagraphs } from "./compositor.ts";

let browserPromise: Promise<Browser> | null = null;
let browserGeneration = 0;

function launchBrowser(): Promise<Browser> {
  const generation = ++browserGeneration;
  const options: LaunchOptions = { headless: true, args: ["--no-sandbox"] };
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

/** Render a reading PDF from the book's styled HTML via headless Chromium. */
export async function renderPdf(book: Book): Promise<Buffer> {
  const html = await renderHtml(book, "print");
  const coverDataUrl = await readingCoverDataUrl(book);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.emulateMediaType("print");
    await page.setContent(html, { waitUntil: "load" });

    if (coverDataUrl) {
      // Reading PDFs are complete reading copies, unlike a print-interior file.
      // Give them the actual cover as page one. The first page has no print
      // margins; the remaining pages keep the existing 6×9 reading layout.
      await page.evaluate((dataUrl) => {
        const main = document.querySelector("main.book");
        if (!main?.parentNode) return;
        const cover = document.createElement("section");
        cover.className = "folio-reading-cover";
        cover.setAttribute("aria-label", "Book cover");
        const image = document.createElement("img");
        image.src = dataUrl;
        image.alt = "";
        cover.appendChild(image);
        main.parentNode.insertBefore(cover, main);

        const style = document.createElement("style");
        style.id = "folio-reading-cover-pages";
        style.textContent = `
          @page { size: 6in 9in; margin: .75in .7in; }
          @page :first { margin: 0; }
          .folio-reading-cover {
            width: 6in;
            height: 9in;
            margin: 0;
            padding: 0;
            display: grid;
            place-items: center;
            overflow: hidden;
            background: #fff;
            break-after: page;
            page-break-after: always;
          }
          .folio-reading-cover img {
            width: 100%;
            height: 100%;
            display: block;
            object-fit: contain;
            object-position: center;
          }
        `;
        document.head.appendChild(style);
      }, coverDataUrl);
    }

    // The reading PDF is 6×9 with 0.7in side margins. Compose against its
    // 4.6in text measure before freezing lines into nowrap compositor spans.
    await page.addStyleTag({
      content: "main.book{width:4.6in!important;max-width:4.6in!important;margin-left:0!important;margin-right:0!important;}",
    });
    await applyProfessionalHyphenation(page, book);
    await alignDropCaps(page);
    await composeProfessionalParagraphs(page, book);
    const pdf = await page.pdf(coverDataUrl
      ? {
          printBackground: true,
          preferCSSPageSize: true,
          width: "6in",
          height: "9in",
          margin: { top: "0", bottom: "0", left: "0", right: "0" },
        }
      : {
          printBackground: true,
          width: "6in",
          height: "9in",
          margin: { top: "0.75in", bottom: "0.75in", left: "0.7in", right: "0.7in" },
        });
    return Buffer.from(pdf);
  } finally {
    // If Chromium itself disconnected, closing its Page can throw a second
    // "Connection closed" error and hide the operation that actually failed.
    await page.close().catch(() => undefined);
  }
}

import type { Browser, LaunchOptions } from "puppeteer";
import puppeteer from "puppeteer";
import type { Book } from "./types.ts";
import { renderHtml } from "./render-html.ts";
import { alignDropCaps } from "./dropcap.ts";
import { AppError } from "../errors.ts";
import { applyProfessionalHyphenation } from "./hyphenation.ts";
import { composeProfessionalParagraphs } from "./compositor.ts";

let browserPromise: Promise<Browser> | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const options: LaunchOptions = { headless: true, args: ["--no-sandbox"] };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) options.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

    browserPromise = puppeteer.launch(options).catch((e) => {
      browserPromise = null;
      throw new AppError(
        "CHROMIUM_LAUNCH",
        "Couldn't start Folio's bundled PDF rendering engine.",
        { detail: (e as Error).message, cause: e },
      );
    });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}

/** Render a reading PDF from the book's styled HTML via headless Chromium. */
export async function renderPdf(book: Book): Promise<Buffer> {
  const html = await renderHtml(book, "print");
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.emulateMediaType("print");
    await page.setContent(html, { waitUntil: "load" });
    // The reading PDF is 6×9 with 0.7in side margins. Compose against its
    // 4.6in text measure before freezing lines into nowrap compositor spans.
    await page.addStyleTag({
      content: "main.book{width:4.6in!important;max-width:4.6in!important;margin-left:0!important;margin-right:0!important;}",
    });
    await applyProfessionalHyphenation(page, book);
    await alignDropCaps(page);
    await composeProfessionalParagraphs(page, book);
    const pdf = await page.pdf({
      printBackground: true,
      width: "6in",
      height: "9in",
      margin: { top: "0.75in", bottom: "0.75in", left: "0.7in", right: "0.7in" },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

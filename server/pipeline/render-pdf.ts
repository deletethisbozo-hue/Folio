import type { Browser, LaunchOptions } from "puppeteer";
import puppeteer from "puppeteer";
import type { Book } from "./types.ts";
import { renderHtml } from "./render-html.ts";
import { alignDropCaps } from "./dropcap.ts";
import { AppError } from "../errors.ts";

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
    await page.setContent(html, { waitUntil: "networkidle0" });
    await alignDropCaps(page);
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

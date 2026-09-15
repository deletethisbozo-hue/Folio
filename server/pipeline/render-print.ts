import path from "node:path";
import { promises as fs } from "node:fs";
import type { Page } from "puppeteer";
import type { Book } from "./types.ts";
import { renderHtml } from "./render-html.ts";
import { insertPrintToc } from "./build-doc.ts";
import { getBrowser } from "./render-pdf.ts";
import { ROOT, THEMES_DIR, resolveAppResource } from "./paths.ts";
import { alignDropCaps } from "./dropcap.ts";
import { autoGutter, buildPageCss, estimatePages, getTrim, printContentWidthIn, type PrintOptions } from "../print.ts";
import { applyProfessionalHyphenation } from "./hyphenation.ts";
import { composeProfessionalParagraphs } from "./compositor.ts";

export interface PrintMeta {
  pages: number; // actual paginated page count
  gutter: number; // inner margin used (inches)
}

const POLYFILL = process.env.FOLIO_RESOURCE_ROOT
  ? resolveAppResource("vendor", "paged.polyfill.min.js")
  : path.join(ROOT, "node_modules", "pagedjs", "dist", "paged.polyfill.min.js");
const PRINT_BASE = path.join(THEMES_DIR, "print-base.css");

declare global {
  interface Window {
    PagedConfig?: { auto: boolean };
    PagedPolyfill?: { preview: () => Promise<unknown> };
  }
}

/**
 * Set up a Chromium page, paginate the book with Paged.js (trim size, mirrored
 * margins, running heads, folios), then hand the page to `fn`. Shared by the PDF
 * export and the in-app print preview so both use the identical layout engine.
 */
/** Body characters that drive the page-count estimate (and thus the gutter). */
function bodyChars(book: Book): number {
  return book.sections
    .filter((s) => s.kind === "chapter" || s.kind === "backmatter")
    .reduce((n, s) => n + s.markdown.length, 0);
}

/** Resolve the inner (gutter) margin: explicit override, else page-count-aware. */
function resolveGutter(book: Book, opts: PrintOptions): number {
  if (typeof opts.gutter === "number") return opts.gutter;
  const chapters = book.sections.filter((s) => s.kind === "chapter").length;
  const others = book.sections.filter((s) => s.kind !== "chapter").length;
  return autoGutter(estimatePages(bodyChars(book), opts.trim, chapters, others), opts.binding);
}

async function withPaginated<T>(
  book: Book,
  opts: PrintOptions,
  fn: (page: Page) => Promise<T>,
): Promise<{ result: T; meta: PrintMeta }> {
  const gutter = resolveGutter(book, opts);
  // The paginated print gets a printed TOC (with page numbers filled in below);
  // the reflowable reading PDF does not.
  const baseHtml = await renderHtml(insertPrintToc(book), "print");
  const printBaseCss = await fs.readFile(PRINT_BASE, "utf8");
  const pageCss = buildPageCss(book.meta, opts, gutter);

  // The print CSS (esp. the @page size) MUST be in the document before Paged.js
  // initializes, or it falls back to US Letter. Inject it into <head>.
  const styleTag = `<style id="book-formatter-print">\n${printBaseCss}\n${pageCss}\n</style>`;
  const html = baseHtml.includes("</head>")
    ? baseHtml.replace("</head>", `${styleTag}\n</head>`)
    : `${styleTag}\n${baseHtml}`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // page.pdf() ultimately uses print media. Compose under the same media from
    // the beginning so @media print font/spacing rules cannot invalidate the
    // line geometry after Folio has already frozen lines into nowrap spans.
    await page.emulateMediaType("print");
    await page.setContent(html, { waitUntil: "load" });

    // Paged.js applies @page margins only during pagination. The professional
    // compositor runs before that, so explicitly give the source book the exact
    // final text measure. Without this, it measures the browser viewport and the
    // resulting nowrap lines can be wider than the physical page and get cropped.
    const contentWidthIn = printContentWidthIn(opts, gutter);
    await page.evaluate((measure) => {
      const sourceMeasure = document.createElement("style");
      sourceMeasure.id = "folio-print-source-measure";
      sourceMeasure.textContent = `main.book{width:${measure}in!important;max-width:${measure}in!important;margin-left:0!important;margin-right:0!important;}`;
      document.head.appendChild(sourceMeasure);
    }, contentWidthIn);

    await applyProfessionalHyphenation(page, book);
    // Seat the drop caps before pagination — the correction changes how text
    // wraps around the float, so it has to settle before pages are measured.
    await alignDropCaps(page);
    await composeProfessionalParagraphs(page, book);
    // Disable Paged.js auto-run (set before the polyfill script loads).
    await page.evaluate(() => {
      window.PagedConfig = { auto: false };
    });
    await page.addScriptTag({ path: POLYFILL });
    await page.evaluate(async () => {
      await window.PagedPolyfill!.preview();
    });
    await new Promise((r) => setTimeout(r, 150));
    // Restart page numbering at the first chapter (front matter is unnumbered, the
    // main text begins at page 1) and fill the printed TOC's page numbers to match.
    // Done in the DOM rather than via CSS counters because Paged.js's page
    // counter-reset / target-counter are unreliable; this is deterministic.
    // NB: only anonymous callbacks here — naming a function inside evaluate makes
    // esbuild (via tsx) inject a __name helper that doesn't exist in the browser.
    await page.evaluate(() => {
      const firstCh = document.querySelector("section.chapter");
      const firstAttr = firstCh ? firstCh.closest(".pagedjs_page")?.getAttribute("data-page-number") : null;
      const offset = (firstAttr ? parseInt(firstAttr, 10) : 1) - 1; // unnumbered pages before chapter 1

      // Relabel the printed folios on chapter pages (front/back/blank stay unnumbered).
      const style = document.createElement("style");
      style.textContent =
        ".pagedjs_margin-bottom-center .pagedjs_margin-content[data-folio]::after{content:attr(data-folio) !important;}";
      document.head.appendChild(style);
      document.querySelectorAll(".pagedjs_page.pagedjs_chapter_page").forEach((p) => {
        if (p.classList.contains("pagedjs_blank_page")) return;
        const phys = parseInt(p.getAttribute("data-page-number") || "", 10);
        const mc = p.querySelector(".pagedjs_margin-bottom-center .pagedjs_margin-content");
        if (!Number.isNaN(phys) && mc) mc.setAttribute("data-folio", String(phys - offset));
      });

      // Fill TOC page numbers with the same logical numbering.
      document.querySelectorAll("nav.toc-print a").forEach((a) => {
        const href = a.getAttribute("href") || "";
        const target = href.startsWith("#") ? document.getElementById(href.slice(1)) : null;
        const attr = target ? target.closest(".pagedjs_page")?.getAttribute("data-page-number") : null;
        if (!attr) return;
        let span = a.querySelector(".toc-pageno");
        if (!span) {
          span = document.createElement("span");
          span.className = "toc-pageno";
          a.appendChild(span);
        }
        span.textContent = String(parseInt(attr, 10) - offset);
      });
    });
    // Paged.js resolves physical page boxes after the compositor has finished.
    // Fractional inch/px conversion and cloned page geometry can therefore leave
    // a tiny final horizontal mismatch even when source composition used the
    // exact calculated text measure. Calibrate those rare lines against the real
    // Paged.js area. Never hide a genuine layout failure: correction is capped at
    // 2% horizontal scale and a strict second pass still blocks the export.
    const overflow = await page.evaluate(() => {
      const lines = [...document.querySelectorAll<HTMLElement>(".folio-composed-line")];
      let corrected = 0;
      let largestCorrection = 0;

      for (const line of lines) {
        const pageNode = line.closest<HTMLElement>(".pagedjs_page");
        const area = pageNode?.querySelector<HTMLElement>(".pagedjs_area")
          ?? pageNode?.querySelector<HTMLElement>(".pagedjs_page_content");
        const content = line.querySelector<HTMLElement>(":scope > .folio-line-content");
        if (!area || !content) continue;
        const areaRect = area.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        if (contentRect.width <= 0) continue;
        const protrusion = Math.max(0, Number(line.dataset.folioRightProtrusion ?? 0));
        const overshoot = contentRect.right - (areaRect.right + protrusion);
        if (overshoot <= 0.25) continue;

        const currentScale = Number(line.dataset.folioGlyphScale ?? 1);
        if (!Number.isFinite(currentScale) || currentScale <= 0) continue;
        const desiredWidth = Math.max(1, contentRect.width - overshoot - 0.35);
        const nextScale = currentScale * desiredWidth / contentRect.width;
        if (nextScale < 0.98) continue;
        largestCorrection = Math.max(largestCorrection, Math.abs(nextScale - currentScale));
        content.style.transform = Math.abs(nextScale - 1) > 0.00001 ? `scaleX(${nextScale})` : "";
        line.dataset.folioGlyphScale = String(nextScale);
        line.dataset.folioPagedFit = "true";
        corrected++;
      }

      let checked = 0;
      let violations = 0;
      let worstPx = 0;
      let sample = "";
      let minimumScale = 1;
      for (const line of lines) {
        const pageNode = line.closest<HTMLElement>(".pagedjs_page");
        const area = pageNode?.querySelector<HTMLElement>(".pagedjs_area")
          ?? pageNode?.querySelector<HTMLElement>(".pagedjs_page_content");
        const content = line.querySelector<HTMLElement>(":scope > .folio-line-content");
        if (!area || !content) continue;
        checked++;
        const areaRect = area.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        const protrusion = Math.max(0, Number(line.dataset.folioRightProtrusion ?? 0));
        const scale = Number(line.dataset.folioGlyphScale ?? 1);
        if (Number.isFinite(scale)) minimumScale = Math.min(minimumScale, scale);
        const leftOverflow = Math.max(0, areaRect.left - contentRect.left);
        const rightOverflow = Math.max(0, contentRect.right - areaRect.right - protrusion);
        const excess = Math.max(leftOverflow, rightOverflow);
        if (excess > 0.50) {
          violations++;
          if (excess > worstPx) {
            worstPx = excess;
            sample = (line.textContent ?? "").replace(/\u00ad/g, "").trim().slice(0, 180);
          }
        }
      }
      return { checked, violations, worstPx, sample, corrected, largestCorrection, minimumScale };
    });
    if (overflow.violations > 0 || overflow.minimumScale < 0.98 - 0.00001) {
      throw new Error(`Print layout overflow after final page calibration: ${JSON.stringify(overflow)}`);
    }

    const pages = await page.evaluate(() => document.querySelectorAll(".pagedjs_page").length);
    const result = await fn(page);
    return { result, meta: { pages, gutter } };
  } finally {
    await page.close();
  }
}

/** Render a print-ready PDF (Paged.js + Chromium). */
export async function renderPrintPdf(book: Book, opts: PrintOptions): Promise<{ buffer: Buffer; meta: PrintMeta }> {
  const pdfFn = async (page: Page) => Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true }));

  let r = await withPaginated(book, opts, pdfFn);
  // In auto-gutter mode, if the actual page count lands in a different KDP band
  // than the estimate assumed, re-render once with the correct gutter so the
  // exported file is always KDP-safe.
  if (opts.gutter === undefined) {
    const correct = autoGutter(r.meta.pages, opts.binding);
    if (Math.abs(correct - r.meta.gutter) > 0.001) {
      r = await withPaginated(book, { ...opts, gutter: correct }, pdfFn);
    }
  }
  return { buffer: r.result, meta: r.meta };
}

/**
 * Render the paginated document as a self-contained HTML string for the in-app
 * print preview — the same pages the PDF will contain, shown in the previewer.
 */
export async function renderPrintPreviewHtml(book: Book, opts: PrintOptions): Promise<{ html: string; meta: PrintMeta }> {
  const t = getTrim(opts.trim);
  const { result, meta } = await withPaginated(book, opts, async (page) => {
    // Paged.js lays the live pages out correctly, but the serialized output sizes
    // pages from a CSS variable that defaults to US Letter. Pin the trim size
    // explicitly so the static preview HTML keeps the right page dimensions, and
    // add a board background so pages read as sheets of paper.
    await page.evaluate(
      (w, h) => {
        // Remove the Paged.js script so the static preview doesn't RE-paginate
        // (double pagination) when displayed in the iframe.
        document.querySelectorAll("script").forEach((s) => s.remove());
        const style = document.createElement("style");
        style.textContent =
          `.pagedjs_pages{background:#e9edf2;}` +
          `.pagedjs_page{width:${w}in !important;height:${h}in !important;background:#fff;margin:12px auto;box-shadow:0 2px 12px rgba(0,0,0,.18);}`;
        document.head.appendChild(style);
      },
      t.w,
      t.h,
    );
    return page.content();
  });
  return { html: result, meta };
}

import assert from "node:assert/strict";
import path from "node:path";
import { loadBook } from "../server/pipeline/ingest.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { renderPrintPreviewHtml } from "../server/pipeline/render-print.ts";
import { DEFAULT_PRINT } from "../server/print.ts";
import { ROOT } from "../server/pipeline/paths.ts";

const { book } = await loadBook(path.join(ROOT, "samples", "clockwork-garden"));
book.meta.language = "pl-PL";
book.typography.dropcap = false;
const paragraph = [
  "Margaret podniosła list, ponieważ wiadomość była niewiększa od starej kartki,",
  "a jednak dziewczyna widziała w niej nieoczekiwaną wskazówkę.",
  "Głośno powiedziała, że dziewczyna naprawia rzeczy, a potem ruszyła w kierunku kamienicy.",
].join(" ");
for (const section of book.sections) {
  if (section.kind === "chapter") {
    section.markdown = Array.from({ length: 28 }, () => paragraph).join("\n\n");
  }
}

const browser = await getBrowser();
const page = await browser.newPage();
try {
  for (const trim of ["5x8", "5.5x8.5", "crown"]) {
    const { html } = await renderPrintPreviewHtml(book, { ...DEFAULT_PRINT, trim });
    await page.setContent(html, { waitUntil: "load" });
    const pages = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".pagedjs_page")]
      .map((page) => {
        const lines = [...page.querySelectorAll<HTMLElement>(".folio-composed-line")]
          .map((line) => (line.textContent ?? "").replace(/\u00ad/g, "").trim())
          .filter(Boolean);
        return { number: page.dataset.pageNumber, lastLine: lines.at(-1) ?? "" };
      })
      .filter((entry) => entry.lastLine.length > 0));
    const bodyPages = pages.filter(({ lastLine }) => lastLine.length > 20);
    assert.ok(bodyPages.length >= 8, `${trim}: expected a multi-page prose proof, got ${bodyPages.length} pages`);
    const splitWords = bodyPages.filter(({ lastLine }) => /-$/.test(lastLine));
    assert.deepEqual(
      splitWords,
      [],
      `${trim}: a discretionary hyphen was stranded at a page foot: ${JSON.stringify(splitWords)}`,
    );
    console.log(`  ✓ ${trim}: ${bodyPages.length} prose pages have no split word stranded at the foot`);
  }
} finally {
  await page.close().catch(() => undefined);
  await closeBrowser();
}

console.log("\n3 passed, 0 failed");

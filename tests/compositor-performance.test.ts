import assert from "node:assert/strict";
import { getBrowser, closeBrowser } from "../server/pipeline/render-pdf.ts";
import { composeProfessionalParagraphs } from "../server/pipeline/compositor.ts";
import type { Book } from "../server/pipeline/types.ts";

const sentence = "The careful compositor chooses appropriate line breaks while preserving every word and manuscript detail for professional publication.";
const paragraphCount = Number(process.env.FOLIO_COMPOSITOR_BENCHMARK_PARAGRAPHS ?? 180);
const paragraphs = Array.from({ length: paragraphCount }, (_, index) =>
  `<p>${Array.from({ length: 3 }, () => sentence).join(" ")} Paragraph ${index}.</p>`,
);
const expectedText = paragraphs.map((paragraph) => paragraph.replace(/^<p>|<\/p>$/g, ""));
const book: Book = {
  meta: { title: "Composition test", author: "Folio", language: "en", theme: "literary" },
  sections: [],
  baseDir: "",
  fonts: [],
  styles: {},
  typography: { bodyAlign: "justify" },
};

const browser = await getBrowser();
const page = await browser.newPage();
try {
  await page.setContent(
    `<html lang="en"><head><style>body{width:4.6in;font:11pt/1.4 serif}p{text-align:justify;margin:0 0 1em}</style></head>` +
    `<body><main class="book"><section class="chapter">${paragraphs.join("")}</section></main></body></html>`,
    { waitUntil: "load" },
  );
  const started = Date.now();
  const progress: Array<{ completedParagraphs: number; totalParagraphs: number; fraction: number }> = [];
  await composeProfessionalParagraphs(page, book, (update) => progress.push(update));
  const compositionMs = Date.now() - started;
  const composedText = await page.$$eval("section.chapter > p", (nodes) => nodes.map((node) => node.textContent ?? ""));
  assert.deepEqual(composedText, expectedText, "paragraph composition must preserve all manuscript text");
  assert.ok(progress.length > 1, "composition should report multiple progress updates");
  assert.equal(progress.at(-1)?.fraction, 1, "composition progress should reach 100% only when complete");
  assert.ok(progress.every((update, index) =>
    update.totalParagraphs === paragraphs.length &&
    (index === 0 || update.completedParagraphs >= progress[index - 1]!.completedParagraphs),
  ), "composition progress should be accurate and monotonic");
  assert.equal(await page.$$eval(".folio-composed", (nodes) => nodes.length), paragraphs.length);
  const quality = await page.evaluate(() => {
    const lines = [...document.querySelectorAll<HTMLElement>(".folio-composed-line[data-folio-min-semantic-gap]")];
    return {
      violations: document.querySelectorAll('[data-folio-gap-violation="true"]').length,
      minimumGap: Math.min(...lines.map((line) => Number(line.dataset.folioMinSemanticGap))),
    };
  });
  assert.equal(quality.violations, 0, "composition must not introduce semantic gap-floor violations");
  assert.ok(quality.minimumGap >= 1.5, `minimum semantic word gap was ${quality.minimumGap}px`);
  assert.ok(compositionMs < (paragraphCount > 180 ? 300_000 : 20_000), `${paragraphCount}-paragraph composition took ${compositionMs}ms`);

  const pdfStarted = Date.now();
  const pdf = await page.pdf({ width: "6in", height: "9in", printBackground: true });
  const pdfMs = Date.now() - pdfStarted;
  assert.equal(Buffer.from(pdf).subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdfMs < (paragraphCount > 180 ? 300_000 : 15_000), `Chromium PDF generation took ${pdfMs}ms`);
  console.log(`  ✓ ${paragraphCount}-paragraph manuscript preserved and rendered to PDF (compose ${compositionMs}ms, PDF ${pdfMs}ms)`);
} finally {
  await page.close().catch(() => undefined);
  await closeBrowser();
}

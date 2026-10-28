import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { makeBookFixture } from "./fixtures/book.ts";
import { loadBook } from "../server/pipeline/ingest.ts";
import { DEFAULT_PRINT } from "../server/print.ts";
import { renderPrintPdf, renderPrintPreviewHtml } from "../server/pipeline/render-print.ts";
import { bookletOrder } from "../server/pipeline/print-production.ts";
import { convertPdfX3, defaultPdfXProfile } from "../server/pipeline/pdfx.ts";
import { closeBrowser } from "../server/pipeline/render-pdf.ts";
import { run } from "../server/pipeline/exec.ts";
import { resolveAppResource } from "../server/pipeline/paths.ts";

const fixture = await makeBookFixture();
try {
  const { book } = await loadBook(fixture.bookDir);
  const firstChapter = book.sections.find((section) => section.kind === "chapter");
  assert.ok(firstChapter, "The fixture must include a chapter for the searchable-text regression");
  firstChapter.markdown += "\n\nFiction official efficient.";
  const original = JSON.stringify(book);
  const options = { ...DEFAULT_PRINT, trim: "a5", bleedMm: 3 };
  const single = await renderPrintPdf(book, options);
  const pdf = await PDFDocument.load(single.buffer);
  assert.equal(pdf.getPageCount(), single.meta.pages);
  for (const page of pdf.getPages()) {
    assert.ok(Math.abs(page.getTrimBox().width - 148 * 72 / 25.4) < 0.01);
    assert.ok(Math.abs(page.getTrimBox().height - 210 * 72 / 25.4) < 0.01);
    assert.ok(Math.abs(page.getMediaBox().width - 154 * 72 / 25.4) < 0.01);
  }
  const converted = await convertPdfX3(single.buffer, { profile: await defaultPdfXProfile(), name: "Artifex CMYK SWOP", title: book.meta.title });
  assert.equal(converted.report.valid, true, JSON.stringify(converted.report));
  assert.ok(converted.report.embeddedFonts > 0);
  const extractText = async (buffer: Buffer) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "folio-pdfx-text-"));
    const input = path.join(dir, "input.pdf");
    const output = path.join(dir, "output.txt");
    const executable = process.env.FOLIO_GS_BIN || resolveAppResource("vendor", "ghostscript", "bin", process.platform === "win32" ? "gswin64c.exe" : "gs");
    try {
      await fs.writeFile(input, buffer);
      const result = await run(executable, ["-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=txtwrite", `-sOutputFile=${output}`, input], { timeoutMs: 90_000, maxOutputBytes: 64 * 1024 * 1024 });
      assert.equal(result.code, 0, "Ghostscript must extract searchable text from each PDF");
      return (await fs.readFile(output, "utf8")).normalize("NFC").replace(/\s/g, "");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  };
  const textBefore = await extractText(single.buffer);
  const textAfter = await extractText(converted.buffer);
  for (const term of ["Fiction", "official", "efficient"]) {
    assert.ok(textBefore.includes(term), `The searchable source PDF must contain regression manuscript text: ${term}`);
  }
  assert.equal(textAfter, textBefore, "PDF/X conversion must preserve the complete searchable manuscript text");
  const preview = await renderPrintPreviewHtml(book, { ...options, spreadMode: "facing" });
  assert.equal(preview.meta.pages, single.meta.pages, "Preview and PDF must use identical final pagination");
  assert.equal(preview.meta.gutter, single.meta.gutter, "Preview and PDF must use the same resolved inner margin");
  assert.match(preview.html, /class="folio-print-spread"/);
  assert.match(preview.html, /class="folio-physical-page"/);
  for (const section of book.sections.filter((section) => section.kind === "chapter")) assert.ok(preview.html.includes(`id="${section.id}"`), `Full-book preview lost ${section.id}`);
  const booklet = await renderPrintPdf(book, { ...options, spreadMode: "booklet", signaturePages: 16 });
  const sheets = await PDFDocument.load(booklet.buffer);
  assert.equal(sheets.getPageCount(), bookletOrder(booklet.meta.pages, 16).length);
  assert.ok(Math.abs(sheets.getPage(0).getWidth() - 302 * 72 / 25.4) < 0.01);
  assert.equal(JSON.stringify(book), original, "Publication transforms must preserve all project source data");
  console.log(`${10 + 3 * pdf.getPageCount() + book.sections.filter((section) => section.kind === "chapter").length} passed, 0 failed`);
} finally { await closeBrowser(); await fixture.cleanup(); }

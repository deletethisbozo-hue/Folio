import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { PDFDict, PDFDocument, PDFNumber } from "pdf-lib";
import { makeBookFixture } from "./fixtures/book.ts";
import { loadBook } from "../server/pipeline/ingest.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { renderPrintPdf } from "../server/pipeline/render-print.ts";
import { flattenThemeImagesForPdfX } from "../server/pipeline/pdfx-flatten.ts";
import { convertPdfX3 } from "../server/pipeline/pdfx.ts";
import { DEFAULT_PRINT } from "../server/print.ts";

// A semi-transparent ornament must not make PDF/X conversion outline (and lose) page text.
const profilePath = process.env.FOLIO_GS_PROFILE;
assert.ok(profilePath && process.env.FOLIO_GS_BIN, "Configure the pinned Ghostscript runtime first");
const profile = await fs.readFile(profilePath);
try {
  const fx = await makeBookFixture();
  const { book } = await loadBook(fx.bookDir);
  const browser = await getBrowser();
  const page = await browser.newPage();
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 240; c.height = 40;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "rgba(120,40,40,.6)";
    ctx.beginPath(); ctx.arc(120, 20, 16, 0, Math.PI * 2); ctx.fill();
    return c.toDataURL("image/png");
  });
  await page.close();
  const withOrnament = {
    ...book,
    typography: { ...book.typography, themeLab: { ...book.typography?.themeLab, enabled: true, chapterOrnament: { dataUrl, opacity: 0.5, width: 30, height: 3 } } },
  };
  const flattened = await flattenThemeImagesForPdfX(withOrnament);
  const transparency = async (b: Buffer) => {
    const doc = await PDFDocument.load(b, { updateMetadata: false });
    let hits = 0;
    const seen = new Set<unknown>();
    const visit = (obj: unknown, depth: number) => {
      const dict = obj instanceof PDFDict ? obj : (obj as { dict?: unknown } | undefined)?.dict instanceof PDFDict ? (obj as { dict: PDFDict }).dict : null;
      if (!dict || depth > 6 || seen.has(dict)) return;
      seen.add(dict);
      for (const [k, v] of dict.entries()) {
        const val = doc.context.lookup(v);
        const key = k.toString();
        if (key === "/SMask" && val && val.toString() !== "/None") hits++;
        if ((key === "/ca" || key === "/CA") && val instanceof PDFNumber && val.asNumber() < 1) hits++;
        visit(val, depth + 1);
      }
    };
    for (const p of doc.getPages()) visit(p.node.Resources(), 0);
    return hits;
  };
  const rawPdf = await renderPrintPdf(withOrnament, DEFAULT_PRINT);
  assert.ok(await transparency(Buffer.from(rawPdf.buffer ?? (rawPdf as unknown as Buffer))) > 0, "fixture must contain transparency before flattening");
  const pdf = await renderPrintPdf(flattened, DEFAULT_PRINT);
  assert.equal(await transparency(Buffer.from(pdf.buffer ?? (pdf as unknown as Buffer))), 0, "no transparency may remain for PDF/X");
  const result = await convertPdfX3(Buffer.from(pdf.buffer ?? (pdf as unknown as Buffer)), { profile, name: "test", title: "Alpha ornament" });
  assert.ok(result.report.valid, JSON.stringify(result.report));
  console.log("2 passed, 0 failed");
} finally {
  await closeBrowser().catch(() => undefined);
}

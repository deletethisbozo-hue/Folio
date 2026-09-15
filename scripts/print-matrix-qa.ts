import path from "node:path";
import { promises as fs } from "node:fs";
import { loadBook } from "../server/pipeline/ingest.ts";
import { renderPrintPdf } from "../server/pipeline/render-print.ts";
import { DEFAULT_PRINT, TRIMS } from "../server/print.ts";
import { closeBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";
import type { Book, ThemeName } from "../server/pipeline/types.ts";

const outDir = path.join(ROOT, "build", "qa-print-matrix");
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const { book } = await loadBook(path.join(ROOT, "samples", "clockwork-garden"));

type Result = {
  label: string;
  trim: string;
  theme: ThemeName;
  binding: "paperback" | "hardcover";
  pages: number;
  bytes: number;
  gutter: number;
};

const results: Result[] = [];

function themed(source: Book, theme: ThemeName): Book {
  return {
    ...source,
    meta: { ...source.meta, theme },
  };
}

async function qualify(
  source: Book,
  label: string,
  trim: string,
  binding: "paperback" | "hardcover" = "paperback",
): Promise<void> {
  const rendered = await renderPrintPdf(source, {
    ...DEFAULT_PRINT,
    trim,
    binding,
  });
  if (rendered.buffer.subarray(0, 5).toString() !== "%PDF-") {
    throw new Error(`${label}: output is not a PDF`);
  }
  if (rendered.buffer.length < 50_000 || rendered.meta.pages < 1) {
    throw new Error(`${label}: implausible output (${rendered.meta.pages} pages, ${rendered.buffer.length} bytes)`);
  }
  const safe = label.replace(/[^a-z0-9.-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  await fs.writeFile(path.join(outDir, `${safe}.pdf`), rendered.buffer);
  results.push({
    label,
    trim,
    theme: source.meta.theme,
    binding,
    pages: rendered.meta.pages,
    bytes: rendered.buffer.length,
    gutter: rendered.meta.gutter,
  });
}

try {
  // Every user-selectable trim must pass renderPrintPdf's strict post-Paged.js
  // overflow gate. A successful return means no composed line remained outside
  // the actual physical page area after final pagination/calibration.
  for (const trim of TRIMS) {
    await qualify(book, `decorative-${trim.key}-paperback`, trim.key, "paperback");
  }

  // Exercise the narrowest page with two materially different theme families,
  // plus hardcover gutter geometry. This catches theme padding/border and inner
  // margin interactions without turning routine CI into a 145-PDF endurance run.
  await qualify(themed(book, "folio"), "folio-5x8-paperback", "5x8", "paperback");
  await qualify(themed(book, "blackletter"), "blackletter-5x8-paperback", "5x8", "paperback");
  await qualify(book, "decorative-5x8-hardcover", "5x8", "hardcover");

  await fs.writeFile(
    path.join(outDir, "report.json"),
    JSON.stringify({ qualified: results.length, results }, null, 2),
    "utf8",
  );
  console.log(JSON.stringify({ qualified: results.length, results }, null, 2));
} finally {
  await closeBrowser();
}

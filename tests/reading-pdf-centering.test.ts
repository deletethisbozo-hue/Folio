import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { makeBookFixture } from "./fixtures/book.ts";
import { loadBook } from "../server/pipeline/ingest.ts";
import { closeBrowser, renderPdf } from "../server/pipeline/render-pdf.ts";

// Reading PDF body text must sit centred on the page (equal left and right margins).
const gs = process.env.FOLIO_GS_BIN;
assert.ok(gs, "FOLIO_GS_BIN is needed to measure the PDF");
try {
  const fx = await makeBookFixture();
  const { book } = await loadBook(fx.bookDir);
  const pdf = await renderPdf(book);
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "folio-reading-")), "r.pdf");
  await fs.writeFile(file, pdf);
  const run = spawnSync(gs, ["-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=bbox", file], { encoding: "utf8" });
  const pageWidth = 432;
  const margins = [...run.stderr.matchAll(/%%HiResBoundingBox: ([\d.]+) [\d.]+ ([\d.]+) [\d.]+/g)].map((m) => ({ left: Number(m[1]), right: pageWidth - Number(m[2]) }));
  assert.ok(margins.length > 3, run.stderr.slice(0, 300));
  const textPages = margins.filter((m) => m.left < 60 && m.right < 90);
  assert.ok(textPages.length >= 3, "expected several full text pages");
  for (const m of textPages) assert.ok(Math.abs(m.left - m.right) < 4, `text is off-centre: left ${m.left}, right ${m.right}`);
  console.log(`${textPages.length} passed, 0 failed`);
} finally {
  await closeBrowser().catch(() => undefined);
}

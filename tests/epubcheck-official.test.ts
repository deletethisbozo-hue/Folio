import { promises as fs } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { makeBookFixture } from "./fixtures/book.ts";
import { loadBook } from "../server/pipeline/ingest.ts";
import { renderEpub } from "../server/pipeline/render-epub.ts";
import { validateEpub } from "../server/validate/epubcheck.ts";

assert.ok(process.env.FOLIO_EPUBCHECK_JAR, "Official EPUBCheck distribution must be configured for integration qualification");
const fixture = await makeBookFixture();
try {
  const { book } = await loadBook(fixture.bookDir);
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await fs.mkdir(path.join(book.baseDir, "assets"), { recursive: true });
  await fs.writeFile(path.join(book.baseDir, "assets", "duplicate-one.png"), image);
  await fs.writeFile(path.join(book.baseDir, "assets", "duplicate-two.png"), image);
  book.sections.find((section) => section.kind === "chapter")!.markdown += "\n\n![First](assets/duplicate-one.png)\n\n![Second](assets/duplicate-two.png)\n";
  const epub = await renderEpub(book, "kdp");
  assert.ok(epub.optimization.removedAssets >= 1, "Identical illustration bytes should be shared without losing either occurrence");
  const valid = await validateEpub(epub.buffer, { requireFullValidation: true });
  assert.equal(valid.tool, "epubcheck", "production validation must use the real official checker");
  assert.equal(valid.complete, true, "structural fallback is not full conformance validation");
  assert.equal(valid.valid, true, JSON.stringify(valid.messages));
  const universal = await renderEpub(book, "universal");
  const universalReport = await validateEpub(universal.buffer, { requireFullValidation: true });
  assert.equal(universalReport.complete, true);
  assert.equal(universalReport.valid, true, JSON.stringify(universalReport.messages));
  const broken = await validateEpub(Buffer.from("This is not an EPUB"), { requireFullValidation: true });
  assert.equal(broken.valid, false, "corrupt EPUB data must never pass");
  assert.equal(broken.tool, "epubcheck", "invalid EPUBs still need the official diagnostic report");
  assert.ok(broken.messages.some((message) => message.severity === "error"));
  console.log("9 passed, 0 failed");
} finally {
  await fixture.cleanup();
}

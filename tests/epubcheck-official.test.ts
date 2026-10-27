import assert from "node:assert/strict";
import { makeBookFixture } from "./fixtures/book.ts";
import { loadBook } from "../server/pipeline/ingest.ts";
import { renderEpub } from "../server/pipeline/render-epub.ts";
import { validateEpub } from "../server/validate/epubcheck.ts";

assert.ok(process.env.FOLIO_EPUBCHECK_JAR, "Official EPUBCheck distribution must be configured for integration qualification");
const fixture = await makeBookFixture();
try {
  const { book } = await loadBook(fixture.bookDir);
  const epub = await renderEpub(book, "kdp");
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
  console.log("8 passed, 0 failed");
} finally {
  await fixture.cleanup();
}

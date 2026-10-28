import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { makeBookFixture } from "./fixtures/book.ts";
import { loadBook } from "../server/pipeline/ingest.ts";
import { publishPreflight } from "../server/validate/preflight.ts";

const fixture = await makeBookFixture();
try {
  const { book } = await loadBook(fixture.bookDir);
  const section = book.sections.find((item) => item.kind === "chapter")!;
  section.markdown = "## Local heading\n\n[Good](#local-heading)\n\n![Missing](missing-art.png)\n\n[Broken](#missing-heading)\n\n`![Code example](not-an-image.png)`\n\n![Reference][art]\n\n[art]: missing-reference.png\n";
  const original = JSON.stringify(book);
  const report = await publishPreflight(book, { format: "epub" });
  assert.equal(report.ready, false);
  assert.ok(report.issues.some((issue) => issue.code === "ASSET_MISSING" && issue.asset === "missing-art.png" && issue.sectionId === section.id));
  assert.ok(report.issues.some((issue) => issue.code === "ASSET_MISSING" && issue.asset === "missing-reference.png"));
  assert.ok(report.issues.some((issue) => issue.code === "LINK_BROKEN" && issue.asset === "#missing-heading"));
  assert.ok(!report.issues.some((issue) => issue.asset === "#local-heading" || issue.asset === "not-an-image.png"));
  assert.equal(JSON.stringify(book), original, "Preflight must never rewrite sources or normalize the live book");
  section.markdown = "A complete chapter.";
  const clean = await publishPreflight(book, { format: "epub" });
  assert.equal(clean.ready, true, JSON.stringify(clean));
  section.markdown = "   ";
  const empty = await publishPreflight(book, { format: "epub" });
  assert.ok(empty.issues.some((issue) => issue.code === "CHAPTER_EMPTY" && issue.severity === "warning"));
  book.fonts.push({ file: path.join(fixture.root, "absent.ttf"), family: "Missing font" });
  const badFont = await publishPreflight(book, { format: "print", print: { trim: "unknown", binding: "paperback", layout: "author-title-bottom", startChaptersRecto: true } });
  assert.ok(badFont.issues.some((issue) => issue.code === "FONT_MISSING"));
  assert.ok(badFont.issues.some((issue) => issue.code === "PRINT_TRIM"));
  assert.ok(badFont.issues.every((issue) => issue.remedy.length > 0));
  console.log("11 passed, 0 failed");
} finally { await fixture.cleanup(); }

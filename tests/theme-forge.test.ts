import assert from "node:assert/strict";
import { validateThemeConfig } from "../shared/theme-validation.ts";
import { makeBookFixture } from "./fixtures/book.ts";
import { loadBook } from "../server/pipeline/ingest.ts";
import { runThemeTypographyQa } from "../server/pipeline/theme-qa.ts";
import { themeCollections, themeMatchesCollection } from "../web/src/theme-collections.ts";
import type { ThemeLibraryEntry } from "../web/src/types.ts";

console.log("\nTheme Forge validation, collections, and typography QA");

const validation = validateThemeConfig({
  paper: "#ffffff",
  ink: "#222222",
  bodySize: 1.1,
  headingSize: 1.8,
  bodyFont: "EB Garamond",
  chapterRule: "none",
}, {
  baseTheme: "literary",
  knownBaseThemes: ["literary"],
  installedFonts: ["EB Garamond"],
});
assert.equal(validation.length, 0);

const invalid = validateThemeConfig({ paper: "not-a-color", bodySize: 2, headingFont: "Missing Family" }, {
  baseTheme: "unknown",
  knownBaseThemes: ["literary"],
  installedFonts: ["EB Garamond"],
});
assert(invalid.some((issue) => issue.severity === "error" && issue.field === "baseTheme"));
assert(invalid.some((issue) => issue.severity === "error" && issue.field === "paper"));
assert(invalid.some((issue) => issue.severity === "error" && issue.field === "bodySize"));
assert(invalid.some((issue) => issue.severity === "warning" && issue.field === "headingFont"));

const themes: ThemeLibraryEntry[] = [
  {
    id: "illustrated", label: "Illustrated", baseTheme: "literary",
    config: { chapterOrnament: { dataUrl: "data:image/png;base64,AAAA" }, headingFont: "Bodoni Moda", dropcap: true },
    createdAt: 1, updatedAt: 2,
  },
  {
    id: "minimal", label: "Minimal", baseTheme: "modern",
    config: { chapterRule: "none", dropcap: false },
    createdAt: 1, updatedAt: 1,
  },
];
const collections = themeCollections(themes);
assert.deepEqual(collections.find((item) => item.id === "all")?.count, 2);
assert.equal(collections.find((item) => item.id === "illustrated")?.count, 1);
assert.equal(collections.find((item) => item.id === "minimal")?.count, 1);
assert.equal(themeMatchesCollection(themes[0], "illustrated"), true);
assert.equal(themeMatchesCollection(themes[1], "illustrated"), false);

const fixture = await makeBookFixture();
try {
  const { book } = await loadBook(fixture.bookDir);
  book.styles = {};
  const lab = {
    enabled: true,
    name: "QA Book Style",
    paper: "#ffffff",
    ink: "#222222",
    bodyFont: "EB Garamond",
    headingFont: "Bodoni Moda",
    dropcap: false,
  };
  book.typography = {
    ...book.typography,
    themeLab: lab,
    bodyFont: lab.bodyFont,
    headingFont: lab.headingFont,
  };
  const report = await runThemeTypographyQa(book);
  assert.deepEqual(report.checks.map((check) => check.target), ["Preview", "PDF / PDF/X", "EPUB"]);
  assert(report.checks.every((check) => check.status === "pass"), JSON.stringify(report.checks));
  book.styles.handwriting = { font: "Unpackaged Family" };
  const fallbackReport = await runThemeTypographyQa(book);
  assert(fallbackReport.checks.every((check) => check.status === "warning"));
  assert(fallbackReport.checks[2].details.some((detail) => detail.includes("Unpackaged Family")));
} finally {
  await fixture.cleanup();
}

console.log("  ✓ Validated constraints, automatic collections and all three typography targets");
console.log("\n1 passed, 0 failed");

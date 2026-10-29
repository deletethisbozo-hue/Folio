import assert from "node:assert/strict";
import path from "node:path";
import type { Book } from "../server/pipeline/types.ts";
import { bookFontFamilies, buildDocCss, epubFontFiles } from "../server/pipeline/doc-css.ts";
import { buildThemeRuntimeCss } from "../server/pipeline/theme-fonts.ts";

console.log("\nExport font footprint regression checks");

const kdp = await buildThemeRuntimeCss("literary", "epub");
assert(kdp.fontFiles.length > 0, "Kindle preset must package the selected theme fonts");
assert.match(kdp.css, /@font-face/i, "Kindle preset must reference its packaged font files");
console.log("  ✓ Kindle preset embeds selected theme fonts and matching @font-face rules");

const universal = await buildThemeRuntimeCss("literary", "epub");
const filenames = universal.fontFiles.map((file) => path.basename(file));
assert(filenames.includes("eb-garamond.ttf"), "Primary body font must remain embedded");
assert(filenames.includes("source-sans-3.ttf"), "Primary font: shorthand for CHAPTER must remain embedded");
assert.deepEqual(kdp.fontFiles.map((file) => path.basename(file)).sort(), filenames.sort(), "Both EPUB presets must embed the active theme's required fonts");
assert(!filenames.includes("vollkorn.ttf"), "Unused body fallback must not be embedded");
assert(!filenames.includes("gelasio.ttf"), "Unused body fallback must not be embedded");
console.log("  ✓ Universal EPUB retains actual body/display fonts without fallback binaries");

const print = await buildThemeRuntimeCss("literary", "print");
assert.match(print.fontCss, /font-family:"EB Garamond"/);
assert.doesNotMatch(print.fontCss, /font-family:"Folio EB Garamond"/);
console.log("  ✓ Print HTML does not duplicate large base64 font data for unused legacy aliases");

const legacy = await buildThemeRuntimeCss("literary", "print", ["Folio EB Garamond"]);
assert.match(legacy.fontCss, /font-family:"Folio EB Garamond"/);
console.log("  ✓ Legacy project can still explicitly request the old font alias");

const themeLabBook = {
  styles: { letter: { font: '"Bodoni Moda", serif' } },
  typography: {
    themeLab: { enabled: true, bodyFont: "Folio EB Garamond", headingFont: "Bodoni Moda" },
  },
} satisfies Pick<Book, "styles" | "typography">;
const selectedFamilies = bookFontFamilies(themeLabBook);
assert.deepEqual(selectedFamilies, ["Bodoni Moda", "Folio EB Garamond"]);
const themeLabPrint = await buildThemeRuntimeCss("literary", "print", selectedFamilies);
assert.match(themeLabPrint.fontCss, /font-family:"Bodoni Moda"/);
assert.match(themeLabPrint.fontCss, /font-family:"Folio EB Garamond"/);
const themeLabEpub = await buildThemeRuntimeCss("literary", "epub", selectedFamilies);
assert(themeLabEpub.fontFiles.some((file) => path.basename(file) === "bodoni-moda.ttf"));
console.log("  ✓ Theme Lab and per-style font selections are embedded in print and EPUB exports");

const registeredFontsBook: Book = {
  meta: { title: "Test", author: "Test", language: "en", theme: "literary" },
  sections: [],
  baseDir: "",
  fonts: [
    { file: "used-body.ttf", family: "Used Body" },
    { file: "used-heading.ttf", family: "Used Heading" },
    { file: "unused-large-font.ttf", family: "Unused Large Font" },
  ],
  styles: { letter: { font: '"Used Heading", serif' } },
  typography: { bodyFont: "Used Body" },
};
const registeredFontCss = await buildDocCss(registeredFontsBook, "epub");
assert.match(registeredFontCss, /font-family: "Used Body"/);
assert.match(registeredFontCss, /font-family: "Used Heading"/);
assert.doesNotMatch(registeredFontCss, /Unused Large Font/);
assert.deepEqual(epubFontFiles(registeredFontsBook), ["used-body.ttf", "used-heading.ttf"]);
console.log("  ✓ Unselected book font assets are excluded from EPUB and print HTML");

console.log("\n6 passed, 0 failed");

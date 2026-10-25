import assert from "node:assert/strict";
import path from "node:path";
import { buildThemeRuntimeCss } from "../server/pipeline/theme-fonts.ts";

console.log("\nExport font footprint regression checks");

const kdp = await buildThemeRuntimeCss("literary", "epub", [], { embedFonts: false });
assert.equal(kdp.fontFiles.length, 0, "Kindle preset must not package TTF/OTF binaries");
assert.doesNotMatch(kdp.css, /@font-face/i, "Kindle preset must not reference unpackaged font files");
console.log("  ✓ Kindle preset carries no font binaries or dangling @font-face URLs");

const universal = await buildThemeRuntimeCss("literary", "epub");
const filenames = universal.fontFiles.map((file) => path.basename(file));
assert(filenames.includes("eb-garamond.ttf"), "Primary body font must remain embedded");
assert(filenames.includes("source-sans-3.ttf"), "Primary font: shorthand for CHAPTER must remain embedded");
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

console.log("\n4 passed, 0 failed");

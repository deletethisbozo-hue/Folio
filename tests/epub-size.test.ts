import assert from "node:assert/strict";
import { writeEpub } from "../server/pipeline/epub-zip.ts";
import { inspectEpubSize } from "../server/pipeline/epub-size.ts";

console.log("\nEPUB export size inspector");
const archive = Buffer.from(writeEpub([
  { name: "mimetype", data: Buffer.from("application/epub+zip"), store: true },
  { name: "EPUB/fonts/book.ttf", data: Buffer.alloc(3000, 19), store: false },
  { name: "EPUB/media/map.png", data: Buffer.alloc(6000, 239), store: false },
  { name: "EPUB/text/one.xhtml", data: Buffer.from("<p>Hello, Folio!</p>"), store: false },
]));
const report = await inspectEpubSize(archive);
assert.equal(report.totalBytes, archive.length);
assert(report.fontsBytes > 0);
assert(report.imagesBytes > 0);
assert(report.contentBytes > 0);
assert(report.overheadBytes > 0);
assert.equal(report.largestAssets.length, 4);
assert.equal(
  report.fontsBytes + report.imagesBytes + report.contentBytes + report.otherBytes + report.overheadBytes,
  report.totalBytes,
);
console.log("  ✓ compressed font, image and content sizes add up to the real EPUB byte count");
console.log("\n1 passed, 0 failed");

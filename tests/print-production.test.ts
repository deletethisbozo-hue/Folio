import assert from "node:assert/strict";
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { applyPrintPageBoxes, bookletOrder, createPrintSpreads } from "../server/pipeline/print-production.ts";
import { getTrim } from "../server/print.ts";

const source = await PDFDocument.create();
const font = await source.embedFont(StandardFonts.Helvetica);
for (let i = 0; i < 9; i++) source.addPage([432, 648]).drawText(`Page ${i + 1}`, { x: 60, y: 550, font });
const bytes = Buffer.from(await source.save());
const boxed = await applyPrintPageBoxes(bytes, "6x9", 3);
const checked = await PDFDocument.load(boxed);
const bleedPt = 3 * 72 / 25.4;
for (const page of checked.getPages()) {
  assert.deepEqual(page.getTrimBox(), { x: 0, y: 0, width: 432, height: 648 });
  assert.ok(Math.abs(page.getBleedBox().width - (432 + 2 * bleedPt)) < 0.0001);
  assert.ok(Math.abs(page.getMediaBox().x + bleedPt) < 0.0001);
}
assert.deepEqual(bookletOrder(8, 8), [[8, 1], [2, 7], [6, 3], [4, 5]]);
assert.deepEqual(bookletOrder(5, 8), [[null, 1], [2, null], [null, 3], [4, 5]]);
assert.deepEqual(bookletOrder(4, 4, true), [[1, 4], [3, 2]]);
assert.throws(() => bookletOrder(8, 6), /signature/i);
const spreads = await createPrintSpreads(boxed, { mode: "booklet", signaturePages: 16 });
const spreadDoc = await PDFDocument.load(spreads);
assert.equal(spreadDoc.getPageCount(), 8);
assert.ok(Math.abs(spreadDoc.getPage(0).getWidth() - (864 + 2 * bleedPt)) < 0.001);
const sheet = spreadDoc.getPage(0), sheetTrim = sheet.getTrimBox();
assert.ok(Math.abs(sheetTrim.x - bleedPt) < 0.001 && Math.abs(sheetTrim.y - bleedPt) < 0.001 && Math.abs(sheetTrim.width - 864) < 0.001 && Math.abs(sheetTrim.height - 648) < 0.001, "Imposed sheet must retain real trim geometry");
assert.ok(sheet.node.has(PDFName.of("TrimBox")), "A fallback MediaBox is not an explicit production TrimBox");
assert.ok(sheet.node.has(PDFName.of("BleedBox")), "Spread bleed must remain explicit");
const facing = await createPrintSpreads(bytes, { mode: "facing" });
assert.equal((await PDFDocument.load(facing)).getPageCount(), 5);
assert.equal(getTrim("a5").w * 25.4, 148);
await assert.rejects(() => applyPrintPageBoxes(bytes, "6x9", -2), /bleed/i);
await assert.rejects(() => applyPrintPageBoxes(bytes, "a5", 0), /size/i);
console.log("40 passed, 0 failed");

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { convertPdfX3, inspectPdfX3, validateCmykProfile } from "../server/pipeline/pdfx.ts";

// Real converter integration runs with the pinned Windows publishing runtime.
const profilePath = process.env.FOLIO_GS_PROFILE;
assert.ok(profilePath && process.env.FOLIO_GS_BIN, "Configure the pinned Ghostscript runtime before PDF/X qualification");
const profile = await fs.readFile(profilePath);
assert.doesNotThrow(() => validateCmykProfile(profile));
assert.throws(() => validateCmykProfile(Buffer.alloc(128)), /ICC/);
const original = await PDFDocument.create();
const font = await original.embedFont(StandardFonts.Helvetica);
const page = original.addPage([432, 648]);
page.drawText("Folio PDF/X preserves publication text.", { font, x: 45, y: 590 });
page.drawRectangle({ x: 45, y: 400, width: 160, height: 100, color: rgb(.2, .4, .65) });
const source = Buffer.from(await original.save());
assert.equal((await inspectPdfX3(source, profile)).valid, false, "A normal PDF is not PDF/X merely because its page looks correct");
const converted = await convertPdfX3(source, { profile, name: "Artifex SWOP test profile", title: "Folio conversion fixture" });
assert.ok(converted.report.valid, JSON.stringify(converted.report));
assert.equal((await PDFDocument.load(converted.buffer)).getPageCount(), 1);
assert.equal(converted.buffer.subarray(0, 8).toString(), "%PDF-1.3");
assert.ok(converted.report.embeddedFonts > 0, "Fonts must be embedded in the actual converted file");
console.log("7 passed, 0 failed");

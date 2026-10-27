import assert from "node:assert/strict";
import { runWritingAnalysisJob } from "../web/src/analysis-job.ts";
const result = runWritingAnalysisJob({ markdown: "spectrometer spectrometer spectrometer spectrometer", language: "en", windowWords: 80 });
assert.ok(result.repeated.some((item) => item.word === "spectrometer"));
const book = runWritingAnalysisJob({ markdown: "", language: "en", windowWords: 80, documents: ["spectrometer spectrometer", "spectrometer spectrometer"] });
assert.ok(book.repeated.some((item) => item.word === "spectrometer"));
assert.equal(runWritingAnalysisJob({ markdown: "", language: "pl", windowWords: 80 }).repeated.length, 0);
console.log("3 passed, 0 failed");

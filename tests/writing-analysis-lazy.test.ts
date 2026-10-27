import assert from "node:assert/strict";
import * as studio from "../web/src/write-studio.ts";

const analyze = (studio as unknown as { analyzeWritingSnapshot?: (active: boolean, source: () => string, language?: string, windowWords?: number) => { repeated: { word: string; count: number }[] } | null }).analyzeWritingSnapshot;
assert.equal(typeof analyze, "function", "writing analysis needs an explicit lazy gate");
assert.equal(analyze!(false, () => { throw new Error("Hidden analysis read the manuscript"); }), null, "closed/inactive analysis must not read or analyze a manuscript");
const result = analyze!(true, () => "spectrometer spectrometer spectrometer", "en", 80);
assert.ok(result?.repeated.some((row) => row.word === "spectrometer" && row.count === 3), "visible analysis still processes the real manuscript");
console.log("3 passed, 0 failed");

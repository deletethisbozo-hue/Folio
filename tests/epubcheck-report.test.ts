import assert from "node:assert/strict";
import { parseEpubcheckReport } from "../server/validate/epubcheck.ts";

const valid = parseEpubcheckReport({ checker: { nError: 0, nFatal: 0 }, messages: [] }, 0);
assert.equal(valid.valid, true);
assert.equal(valid.complete, true);
const invalid = parseEpubcheckReport({ messages: [{ ID: "RSC-005", severity: "ERROR", message: "Invalid content", locations: [{ path: "EPUB/text/chapter.xhtml", line: 12, column: 5 }] }] }, 1);
assert.equal(invalid.valid, false);
assert.deepEqual(invalid.messages[0], { severity: "error", code: "RSC-005", text: "RSC-005 Invalid content", path: "EPUB/text/chapter.xhtml", line: 12, column: 5 });
assert.equal(parseEpubcheckReport({ messages: [] }, 1).valid, false, "nonzero exits cannot be silently accepted");
assert.equal(parseEpubcheckReport({ checker: { nError: 1 }, messages: [] }, 0).valid, false, "summary errors cannot be hidden by empty messages");
assert.equal(parseEpubcheckReport({}, 0).complete, false, "malformed reports cannot count as completed conformance checking");
assert.equal(parseEpubcheckReport({}, 0).valid, false);
assert.equal(parseEpubcheckReport({ messages: [{}] }, 0).valid, false, "malformed diagnostics must not count as valid");
console.log("9 passed, 0 failed");

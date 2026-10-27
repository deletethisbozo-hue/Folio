import assert from "node:assert/strict";
import { paginateToFinalGutter } from "../server/pipeline/print-pagination.ts";
import { DEFAULT_PRINT, autoGutter } from "../server/print.ts";
const calls: Array<number | undefined> = [];
const final = await paginateToFinalGutter(DEFAULT_PRINT, async (options) => {
  calls.push(options.gutter);
  return { result: "rendered", meta: { pages: 151, gutter: options.gutter ?? .5 } };
});
assert.deepEqual(calls, [undefined, autoGutter(151, "paperback")]);
assert.equal(final.meta.gutter, autoGutter(final.meta.pages, "paperback"));
let iterations = 0;
const large = await paginateToFinalGutter(DEFAULT_PRINT, async (options) => ({ result: ++iterations, meta: { pages: iterations === 1 ? 151 : iterations === 2 ? 501 : 702, gutter: options.gutter ?? .5 } }));
assert.equal(large.meta.gutter, autoGutter(702, "paperback"));
assert.equal(iterations, 4, "Every crossed gutter band must be resolved, not only the first");
let manualCalls = 0;
await paginateToFinalGutter({ ...DEFAULT_PRINT, gutter: .75 }, async () => ({ result: ++manualCalls, meta: { pages: 900, gutter: .75 } }));
assert.equal(manualCalls, 1, "A deliberate manual gutter must not be changed");
await assert.rejects(() => paginateToFinalGutter(DEFAULT_PRINT, async (options) => ({ result: null, meta: { pages: options.gutter === .625 ? 100 : 151, gutter: options.gutter ?? .5 } })), /converge/);
console.log("6 passed, 0 failed");

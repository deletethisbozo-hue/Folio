import assert from "node:assert/strict";
import { SerialSaveQueue } from "../web/src/save-queue.ts";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (error) { failed++; console.error(`✗ ${name}`); console.error(error); }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

await test("a delayed older save cannot overwrite a newer save", async () => {
  const queue = new SerialSaveQueue<string>();
  let file = "initial";
  const older = queue.run("chapter-1", async () => {
    await sleep(80);
    file = "older";
  });
  await sleep(5);
  const newer = queue.run("chapter-1", async () => {
    file = "newer";
  });
  await Promise.all([older, newer]);
  assert.equal(file, "newer");
});

await test("a failed save does not prevent the following edit from saving", async () => {
  const queue = new SerialSaveQueue<string>();
  let file = "initial";
  const failedSave = queue.run("chapter-1", async () => { throw new Error("disk full"); });
  const nextSave = queue.run("chapter-1", async () => { file = "recovered"; });
  await assert.rejects(failedSave, /disk full/);
  await nextSave;
  assert.equal(file, "recovered");
});

await test("different sections do not block each other", async () => {
  const queue = new SerialSaveQueue<string>();
  const order: string[] = [];
  const slow = queue.run("chapter-a", async () => { await sleep(60); order.push("a"); });
  const fast = queue.run("chapter-b", async () => { order.push("b"); });
  await Promise.all([slow, fast]);
  assert.deepEqual(order, ["b", "a"]);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

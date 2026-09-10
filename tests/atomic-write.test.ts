import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { atomicWriteUtf8 } from "../server/atomic-write.ts";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "folio-atomic-write-"));

await test("atomically replaces the complete target contents", async () => {
  const target = path.join(root, "chapter.md");
  await fs.writeFile(target, "old chapter\n", "utf8");
  await atomicWriteUtf8(target, "new chapter\nwith final line\n");
  assert.equal(await fs.readFile(target, "utf8"), "new chapter\nwith final line\n");
});

await test("does not leave Folio temp files behind", async () => {
  const target = path.join(root, "clean.md");
  await atomicWriteUtf8(target, "clean\n");
  const entries = await fs.readdir(root);
  assert.equal(entries.some((entry) => entry.includes(".folio-tmp")), false);
});

await test("creates a missing destination directory", async () => {
  const target = path.join(root, "nested", "deep", "book.yaml");
  await atomicWriteUtf8(target, "title: Folio\n");
  assert.equal(await fs.readFile(target, "utf8"), "title: Folio\n");
});

if (process.platform !== "win32") {
  await test("preserves an existing file mode", async () => {
    const target = path.join(root, "mode.md");
    await fs.writeFile(target, "before\n", { encoding: "utf8", mode: 0o640 });
    await fs.chmod(target, 0o640);
    await atomicWriteUtf8(target, "after\n");
    assert.equal((await fs.stat(target)).mode & 0o777, 0o640);
  });
}

await fs.rm(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

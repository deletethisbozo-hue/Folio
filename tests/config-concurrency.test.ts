import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import yaml from "js-yaml";
import { removeMatter, saveMeta, saveTypography } from "../server/matter.ts";
import type { BookMeta } from "../server/pipeline/types.ts";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (error) { failed++; console.error(`✗ ${name}`); console.error(error); }
}

const meta: BookMeta = {
  title: "Concurrent Book",
  author: "Folio",
  language: "en",
  theme: "folio",
};

const root = await fs.mkdtemp(path.join(os.tmpdir(), "folio-config-concurrency-"));

await test("appearance autosave cannot resurrect deleted generated matter", async () => {
  const book = path.join(root, "delete-race");
  await fs.mkdir(book, { recursive: true });
  await fs.writeFile(path.join(book, "book.yaml"), yaml.dump({
    ...meta,
    frontmatter: ["titlepage", "copyright"],
    chapters: "chapters",
    backmatter: [],
  }), "utf8");

  // Invocation order is intentional: the older autosave starts first and the
  // user deletion follows it. The final YAML must reflect the later action.
  await Promise.all([
    saveMeta(book, { ...meta, subtitle: "Autosaved subtitle" }),
    removeMatter(book, "titlepage"),
  ]);

  const config = yaml.load(await fs.readFile(path.join(book, "book.yaml"), "utf8")) as { frontmatter?: string[] };
  assert.deepEqual(config.frontmatter, ["copyright"]);
});

await test("metadata and typography updates merge instead of overwriting each other", async () => {
  const book = path.join(root, "appearance-race");
  await fs.mkdir(book, { recursive: true });
  await fs.writeFile(path.join(book, "book.yaml"), yaml.dump({
    ...meta,
    frontmatter: [],
    chapters: "chapters",
    backmatter: [],
  }), "utf8");

  await Promise.all([
    saveMeta(book, { ...meta, title: "Final Title" }),
    saveTypography(book, meta, { bodyAlign: "justified", dropCaps: true }),
  ]);

  const config = yaml.load(await fs.readFile(path.join(book, "book.yaml"), "utf8")) as {
    title?: string;
    typography?: Record<string, unknown>;
  };
  assert.equal(config.title, "Final Title");
  assert.deepEqual(config.typography, { bodyAlign: "justified", dropCaps: true });
});

await fs.rm(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

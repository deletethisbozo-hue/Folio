import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  buildSearchRegex,
  countMatches,
  diffLines,
  nearbyRepetitions,
  repeatedWords,
  replaceMatches,
} from "../web/src/write-studio.ts";
import {
  addResearchImage,
  createBookSnapshot,
  createResearchNote,
  createSnapshot,
  createWritingComment,
  readResearchImage,
  readWritingWordCounts,
  readWriteStudio,
  restoreBookSnapshot,
  setWritingTargets,
} from "../server/write-studio.ts";
import { closeProject, createProjectFromFolderPath } from "../server/projects.ts";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (error) { failed++; console.error(`✗ ${name}`); console.error(error); }
}

await test("advanced find supports literal, case-sensitive, whole-word and regex modes", () => {
  const text = "Cat cat category CAT\ncat-boat";
  assert.equal(countMatches(text, "cat", { caseSensitive: false, wholeWord: false, regex: false }), 5);
  assert.equal(countMatches(text, "cat", { caseSensitive: true, wholeWord: false, regex: false }), 3);
  assert.equal(countMatches(text, "cat", { caseSensitive: false, wholeWord: true, regex: false }), 4);
  assert.equal(countMatches(text, "c.t", { caseSensitive: false, wholeWord: true, regex: true }), 4);
  assert.equal(replaceMatches(text, "cat", "dog", { caseSensitive: true, wholeWord: true, regex: false }).startsWith("Cat dog category"), true);
  assert.throws(() => buildSearchRegex("(", { caseSensitive: false, wholeWord: false, regex: true }), /Invalid regular expression/);
});

await test("repetition analysis ignores common stop words and ranks repeated terms", () => {
  const words = repeatedWords("the raven and the raven saw another raven beside the tower tower tower", "en");
  assert.deepEqual(words.slice(0, 2), [{ word: "raven", count: 3 }, { word: "tower", count: 3 }]);
  const nearby = nearbyRepetitions("glass one two glass three four glass five six seven tower tower tower", "en", 8);
  assert.equal(nearby.some((item) => item.word === "glass" && item.count >= 3), true);
  assert.equal(nearby.some((item) => item.word === "tower" && item.count >= 3), true);
});

await test("revision diff preserves unchanged lines and marks additions/removals", () => {
  const diff = diffLines("one\ntwo\nthree", "one\nTWO\nthree\nfour");
  assert.deepEqual(diff, [
    { kind: "same", text: "one" },
    { kind: "remove", text: "two" },
    { kind: "add", text: "TWO" },
    { kind: "same", text: "three" },
    { kind: "add", text: "four" },
  ]);
});

await test("Write Studio project data persists beside the manuscript", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "folio-write-studio-"));
  let projectId = "";
  try {
    await fs.mkdir(path.join(root, "chapters"), { recursive: true });
    await fs.writeFile(path.join(root, "book.yaml"), [
      'title: "Write Studio Test"',
      'author: "Folio QA"',
      'language: en',
      'theme: literary',
      'chapters: chapters',
      "",
    ].join("\n"), "utf8");
    await fs.writeFile(path.join(root, "chapters", "01.md"), "# Chapter One\n\nA raven crossed the tower.\n", "utf8");

    projectId = await createProjectFromFolderPath(root);
    let state = await setWritingTargets(projectId, { book: 90000, daily: 1500, session: 700, chapters: { "chapter-one": 4500 } });
    assert.equal(state.targets.book, 90000);

    state = await createResearchNote(projectId, "Architecture", "Check the bell tower.");
    assert.equal(state.research[0]?.title, "Architecture");

    state = await addResearchImage(projectId, "tower.png", "image/png", Buffer.from([137, 80, 78, 71]));
    assert.equal(state.researchImages.length, 1);
    const storedImage = await readResearchImage(projectId, state.researchImages[0].id);
    assert.equal(storedImage.image.filename, "tower.png");
    assert.equal(storedImage.buffer.equals(Buffer.from([137, 80, 78, 71])), true);

    state = await createWritingComment(projectId, "chapter-one", "raven crossed", "Check continuity.");
    assert.equal(state.comments[0]?.body, "Check continuity.");

    state = await createSnapshot(projectId, "chapter-one", "# Chapter One\n\nA raven crossed the tower.\n", "Before rewrite");
    assert.equal(state.revisions.some((item) => item.kind === "snapshot" && item.label === "Before rewrite"), true);

    const counts = await readWritingWordCounts(projectId);
    assert.equal(counts.total > 0, true);
    assert.equal(typeof counts.sections["chapter-one"], "number");

    state = await createBookSnapshot(projectId, "Whole book checkpoint");
    const bookSnapshot = state.revisions.find((item) => item.scope === "book" && item.label === "Whole book checkpoint");
    assert.ok(bookSnapshot);
    await fs.writeFile(path.join(root, "chapters", "01.md"), "# Chapter One\n\nDestroyed content.\n", "utf8");
    const restored = await restoreBookSnapshot(projectId, bookSnapshot.id);
    assert.equal(restored.restored, 1);
    assert.equal((await fs.readFile(path.join(root, "chapters", "01.md"), "utf8")).includes("A raven crossed the tower."), true);

    const reopened = await readWriteStudio(projectId);
    assert.equal(reopened.targets.daily, 1500);
    assert.equal(reopened.research.length, 1);
    assert.equal(reopened.researchImages.length, 1);
    assert.equal(reopened.comments.length, 1);
    assert.equal(reopened.revisions.length, 2);
    assert.equal(reopened.revisions.some((item) => item.scope === "book"), true);

    const metadata = JSON.parse(await fs.readFile(path.join(root, ".folio-data", "write-studio.json"), "utf8")) as { version?: number };
    assert.equal(metadata.version, 1);
  } finally {
    if (projectId) await closeProject(projectId);
    await fs.rm(root, { recursive: true, force: true });
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  buildSearchRegex,
  countMatches,
  diffLines,
  markdownToReadableSnapshotText,
  nearbyRepetitions,
  repeatedWords,
  repetitionOccurrences,
  replaceMatches,
  replacementForMatch,
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
  migrateWriteStudioSectionId,
  restoreBookSnapshot,
  setWritingTargets,
} from "../server/write-studio.ts";
import {
  closeProject,
  createProjectFromFolderPath,
  createProjectFromFolioFile,
  flushProjectContainer,
  importFolderAsFolioProject,
} from "../server/projects.ts";

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
  const lookbehindSource = "foo bar";
  const lookbehindMatch = [...lookbehindSource.matchAll(buildSearchRegex("(?<=foo )(b)(ar)", { caseSensitive: true, wholeWord: false, regex: true }, true))][0];
  assert.ok(lookbehindMatch);
  assert.equal(replacementForMatch(lookbehindSource, lookbehindMatch, "$2$1"), "arb");
  assert.equal(replaceMatches(lookbehindSource, "(?<=foo )(b)(ar)", "$2$1", { caseSensitive: true, wholeWord: false, regex: true }), "foo arb");
  assert.throws(() => buildSearchRegex("(", { caseSensitive: false, wholeWord: false, regex: true }), /Invalid regular expression/);
  const polish = "żaba żabą zażaba ŻABA";
  assert.equal(countMatches(polish, "żaba", { caseSensitive: false, wholeWord: true, regex: false }), 2);
});

await test("repetition analysis ignores stop words and measures actual repetition density", () => {
  const words = repeatedWords("the raven and the raven saw another raven beside the tower tower tower", "en");
  assert.deepEqual(words.slice(0, 2), [{ word: "raven", count: 3 }, { word: "tower", count: 3 }]);

  const nearby = nearbyRepetitions("glass one two glass three four glass five six seven tower tower tower", "en", 12);
  const glass = nearby.find((item) => item.word === "glass");
  const tower = nearby.find((item) => item.word === "tower");
  assert.ok(glass && glass.count >= 3 && glass.spanWords < glass.windowWords);
  assert.ok(tower && tower.count >= 3 && tower.spanWords <= 3);

  const tightPair = nearbyRepetitions("lantern one two lantern", "en", 80).find((item) => item.word === "lantern");
  assert.ok(tightPair && tightPair.count === 2 && tightPair.spanWords === 4);

  const distantPair = "lantern " + Array.from({ length: 30 }, (_, index) => "word" + index).join(" ") + " lantern";
  assert.equal(nearbyRepetitions(distantPair, "en", 80).some((item) => item.word === "lantern"), false);

  const hits = repetitionOccurrences("mirror one two mirror three mirror", "en", 80).filter((item) => item.word === "mirror");
  assert.equal(hits.length, 3);
  assert.equal(hits.every((item) => item.severity === "high"), true);

  const german = repeatedWords("der der der turm turm turm", "de");
  assert.deepEqual(german, [{ word: "turm", count: 3 }]);
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

await test("snapshot comparison strips manuscript source markup", () => {
  const readable = markdownToReadableSnapshotText([
    "# Rozdział 1",
    "",
    "**Gruby tekst** i *kursywa* oraz [odnośnik](https://example.com).",
    "",
    "![Mapa](assets/map.png){scale=80 wrap=left}",
    "",
    "<span style=\"color:#999\">Kolorowy fragment</span>",
  ].join("\n"));
  assert.equal(readable.includes("# Rozdział"), false);
  assert.equal(readable.includes("**"), false);
  assert.equal(readable.includes("*kursywa*"), false);
  assert.equal(readable.includes("https://"), false);
  assert.equal(readable.includes("<span"), false);
  assert.equal(readable.includes("Gruby tekst i kursywa oraz odnośnik."), true);
  assert.equal(readable.includes("[Illustration: Mapa]"), true);
  assert.equal(readable.includes("Kolorowy fragment"), true);
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

    state = await migrateWriteStudioSectionId(projectId, "chapter-one", "renamed-chapter");
    assert.equal(state.targets.chapters["renamed-chapter"], 4500);
    assert.equal(state.targets.chapters["chapter-one"], undefined);
    assert.equal(state.comments.every((item) => item.sectionId !== "chapter-one"), true);
    assert.equal(state.comments.some((item) => item.sectionId === "renamed-chapter"), true);
    assert.equal(state.revisions.filter((item) => item.scope === "section").every((item) => item.sectionId === "renamed-chapter"), true);
    state = await migrateWriteStudioSectionId(projectId, "renamed-chapter", "chapter-one");

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

    const metadata = JSON.parse(await fs.readFile(path.join(root, ".folio-data", "write-studio.json"), "utf8")) as {
      version?: number;
      secondDraft?: { pairs?: Record<string, unknown>; blocks?: unknown[]; carryovers?: unknown[]; issues?: unknown[]; reviews?: Record<string, unknown>; briefs?: Record<string, string> };
    };
    assert.equal(metadata.version, 2);
    assert.deepEqual(metadata.secondDraft, { pairs: {}, blocks: [], carryovers: [], issues: [], reviews: {}, briefs: {} });
  } finally {
    if (projectId) await closeProject(projectId);
    await fs.rm(root, { recursive: true, force: true });
  }
});


await test("whole-book snapshots restore chapters embedded in one combined manuscript", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "folio-write-studio-combined-"));
  let projectId = "";
  try {
    await fs.writeFile(path.join(root, "book.yaml"), [
      'title: "Combined Snapshot Test"',
      'author: "Folio QA"',
      'language: en',
      'theme: literary',
      'chapters: manuscript.md',
      "",
    ].join("\n"), "utf8");
    await fs.writeFile(path.join(root, "manuscript.md"), [
      "# First",
      "",
      "Original first chapter.",
      "",
      "# Second",
      "",
      "Original second chapter.",
      "",
    ].join("\n"), "utf8");

    projectId = await createProjectFromFolderPath(root);
    const state = await createBookSnapshot(projectId, "Combined checkpoint");
    const snapshot = state.revisions.find((item) => item.scope === "book" && item.label === "Combined checkpoint");
    assert.ok(snapshot);
    assert.equal(snapshot.sectionCount, 2);

    await fs.writeFile(path.join(root, "manuscript.md"), [
      "# Broken First",
      "",
      "## Wrong subtitle",
      "",
      "Broken first chapter.",
      "",
      "# Broken Second",
      "",
      "Broken second chapter.",
      "",
    ].join("\n"), "utf8");

    const result = await restoreBookSnapshot(projectId, snapshot.id);
    assert.equal(result.restored, 2);
    assert.deepEqual(result.skipped, []);
    const restored = await fs.readFile(path.join(root, "manuscript.md"), "utf8");
    assert.equal(restored.includes("Original first chapter."), true);
    assert.equal(restored.includes("Original second chapter."), true);
    assert.equal(restored.includes("# First"), true);
    assert.equal(restored.includes("# Second"), true);
    assert.equal(restored.includes("Wrong subtitle"), false);
    assert.equal(restored.includes("Broken first chapter."), false);
    assert.equal(restored.includes("Broken second chapter."), false);
  } finally {
    if (projectId) await closeProject(projectId);
    await fs.rm(root, { recursive: true, force: true });
  }
});


await test("Write Studio metadata survives closing and reopening one .folio file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "folio-write-studio-container-"));
  const source = path.join(root, "source");
  const projectFile = path.join(root, "Persistent Novel.folio");
  let projectId = "";
  let reopenedId = "";
  try {
    await fs.mkdir(path.join(source, "chapters"), { recursive: true });
    await fs.writeFile(path.join(source, "book.yaml"), [
      'title: "Persistent Write Studio"',
      'author: "Folio QA"',
      'language: en',
      'theme: literary',
      'chapters: chapters',
      "",
    ].join("\n"), "utf8");
    await fs.writeFile(path.join(source, "chapters", "01.md"), "# One\n\nPersistent manuscript text.\n", "utf8");

    projectId = await importFolderAsFolioProject(source, projectFile);
    let state = await setWritingTargets(projectId, { book: 70000, daily: 1200, session: 600 });
    state = await createResearchNote(projectId, "Persistent note", "This must survive a reopen.");
    state = await createWritingComment(projectId, "one", "Persistent manuscript", "Keep this comment.", "One ", " text.");
    state = await createBookSnapshot(projectId, "Persistent checkpoint");
    assert.equal(state.revisions.some((item) => item.scope === "book"), true);

    await flushProjectContainer(projectId);
    await closeProject(projectId);
    projectId = "";

    reopenedId = await createProjectFromFolioFile(projectFile);
    const reopened = await readWriteStudio(reopenedId);
    assert.equal(reopened.targets.book, 70000);
    assert.equal(reopened.targets.daily, 1200);
    assert.equal(reopened.research.some((item) => item.title === "Persistent note"), true);
    assert.equal(reopened.comments.some((item) => item.body === "Keep this comment."), true);
    assert.equal(reopened.revisions.some((item) => item.scope === "book" && item.label === "Persistent checkpoint"), true);
  } finally {
    if (projectId) await closeProject(projectId);
    if (reopenedId) await closeProject(reopenedId);
    await fs.rm(root, { recursive: true, force: true });
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

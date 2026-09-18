import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  extractFolioProject,
  importFolderIntoFolioProject,
  watchFolioProject,
} from "../server/project-file.ts";
import {
  closeProject,
  createProjectFromFolioFile,
  flushProjectContainer,
  loadProject,
  projectInfo,
  writableBookDir,
} from "../server/projects.ts";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

console.log("\nStandalone .folio project files");

const root = await fs.mkdtemp(path.join(os.tmpdir(), "folio-project-file-test-"));
const source = path.join(root, "legacy-book");
const projectFile = path.join(root, "Novel.folio");
const extracted = path.join(root, "extracted");
const reopened = path.join(root, "reopened");

try {
  await fs.mkdir(path.join(source, "chapters"), { recursive: true });
  await fs.mkdir(path.join(source, "assets"), { recursive: true });
  await fs.writeFile(path.join(source, "book.yaml"), [
    'title: "Container Test"',
    'author: "Folio QA"',
    'language: en',
    'theme: literary',
    'chapters: chapters',
    "",
  ].join("\n"), "utf8");
  await fs.writeFile(path.join(source, "chapters", "01.md"), "# Chapter One\n\nOriginal manuscript.\n", "utf8");
  await fs.writeFile(path.join(source, "assets", "map.png"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  const imported = await importFolderIntoFolioProject(source, projectFile);
  const stat = await fs.stat(imported);
  const header = await fs.readFile(imported);
  check("imports a legacy folder into one real .folio file", stat.isFile() && imported.endsWith(".folio"));
  check("uses a SQLite single-file container", header.subarray(0, 15).toString("utf8") === "SQLite format 3");

  await extractFolioProject(projectFile, extracted);
  check("restores book.yaml from the container", (await fs.readFile(path.join(extracted, "book.yaml"), "utf8")).includes("Container Test"));
  check("restores chapter text from the container", (await fs.readFile(path.join(extracted, "chapters", "01.md"), "utf8")).includes("Original manuscript."));
  check("restores binary assets byte-for-byte", (await fs.readFile(path.join(extracted, "assets", "map.png"))).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));

  const watcher = watchFolioProject(projectFile, extracted);
  await fs.writeFile(path.join(extracted, "chapters", "01.md"), "# Chapter One\n\nEdited inside Folio.\n", "utf8");
  await fs.writeFile(path.join(extracted, "chapters", "02.md"), "# Chapter Two\n\nSecond chapter.\n", "utf8");
  await fs.rm(path.join(extracted, "assets", "map.png"));
  await watcher.flush();
  await watcher.close();

  await extractFolioProject(projectFile, reopened);
  check("persists changed manuscript text after flush", (await fs.readFile(path.join(reopened, "chapters", "01.md"), "utf8")).includes("Edited inside Folio."));
  check("persists newly created project files", (await fs.readFile(path.join(reopened, "chapters", "02.md"), "utf8")).includes("Second chapter."));
  let removedAssetMissing = false;
  try { await fs.access(path.join(reopened, "assets", "map.png")); }
  catch { removedAssetMissing = true; }
  check("removes deleted files from the container", removedAssetMissing);

  const projectId = await createProjectFromFolioFile(projectFile);
  const info = projectInfo(projectId);
  check("registers .folio as the normal persistent project source", info.source === "folio" && info.projectFile === path.resolve(projectFile));
  const workingDir = await writableBookDir(projectId);
  check("keeps the pipeline on a private working directory", workingDir !== path.dirname(projectFile) && workingDir !== source);
  const loaded = await loadProject(projectId);
  check("loads the book through the existing ingestion pipeline", loaded.book.meta.title === "Container Test");

  await fs.writeFile(path.join(workingDir, "chapters", "01.md"), "# Chapter One\n\nPersisted before close.\n", "utf8");
  await flushProjectContainer(projectId);
  await closeProject(projectId);

  const finalExtract = path.join(root, "final");
  await extractFolioProject(projectFile, finalExtract);
  check("explicit project flush survives closing the working copy", (await fs.readFile(path.join(finalExtract, "chapters", "01.md"), "utf8")).includes("Persisted before close."));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

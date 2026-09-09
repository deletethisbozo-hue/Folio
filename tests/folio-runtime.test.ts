import express from "express";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { ROOT, themeCss } from "../server/pipeline/paths.ts";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const app = express();
app.use(express.json({ limit: "5mb" }));
registerApi(app);
registerEditorApi(app);
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function json(url: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}${url}`, init);
  return { status: response.status, body: await response.json() };
}
const post = (url: string, body: unknown) => json(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

console.log("\nFolio live runtime");
const health = await json("/api/health");
check("health reports Folio", health.status === 200 && health.body.name === "Folio", JSON.stringify(health.body));

const themes = await json("/api/themes");
check("at least 20 real themes are registered", themes.body.length >= 20, String(themes.body.length));
for (const theme of themes.body) {
  const css = await fs.readFile(themeCss(theme.name), "utf8");
  check(`${theme.label} has substantive CSS`, css.length > 180 && css.includes("section.chapter"), `${css.length} bytes`);
}

const newBookDir = path.join(os.tmpdir(), "folio-new-" + crypto.randomUUID());
await fs.mkdir(newBookDir, { recursive: true });
const created = await post("/api/projects/new", { path: newBookDir, title: "Born Tied", author: "Folio Test" });
check("new book creates metadata and a first chapter", created.status === 200 && created.body.meta.title === "Born Tied" && created.body.sections.some((item: any) => item.kind === "chapter"));
const createdChapter = created.body.sections.find((item: any) => item.kind === "chapter");
const createdDocument = await json("/api/projects/" + created.body.projectId + "/sections/" + encodeURIComponent(createdChapter.id));
check("new book's first chapter is editable", createdDocument.body.editable === true);
const addedChapter = await post("/api/projects/" + created.body.projectId + "/chapters", { title: "Second Chapter", meta: created.body.meta });
check("chapter API adds a second real source document", addedChapter.body.sections.filter((item: any) => item.kind === "chapter").length === 2);
const addedMatter = await post("/api/projects/" + created.body.projectId + "/matter", { type: "dedication", placement: "frontmatter", meta: created.body.meta });
const dedication = addedMatter.body.sections.find((item: any) => item.title === "Dedication");
const dedicationDocument = await json("/api/projects/" + created.body.projectId + "/sections/" + encodeURIComponent(dedication.id));
check("content API adds editable front matter", dedicationDocument.body.editable === true);
await fs.rm(newBookDir, { recursive: true, force: true });

const originalPath = path.join(ROOT, "samples", "clockwork-garden", "chapters", "01-the-letter.md");
const original = await fs.readFile(originalPath, "utf8");
const sample = await post("/api/sample", {});
const projectId = sample.body.projectId;
const chapter = sample.body.sections.find((section: any) => section.kind === "chapter");
check("sample opens with a chapter", Boolean(projectId && chapter?.id));

const section = await json(`/api/projects/${projectId}/sections/${encodeURIComponent(chapter.id)}`);
check("sample section is editable through copy-on-write", section.body.editable === true);

const transient = "Transient ink appears before autosave.";
const preview = await post(`/api/projects/${projectId}/preview`, {
  meta: sample.body.meta,
  theme: "blackletter",
  typography: {},
  previewSectionId: chapter.id,
  draft: transient,
});
check("preview contains the transient editor draft", preview.status === 200 && preview.body.html.includes("ransient ink appears before"));
check("preview contains selected theme CSS", preview.body.html.includes("Old English Text MT"));
check("preview renders exactly the selected section", (preview.body.html.match(/<section/g) ?? []).length === 1);

const savedText = `${section.body.markdown}\n\nCopy-on-write save probe.`;
const saved = await json(`/api/projects/${projectId}/sections/${encodeURIComponent(chapter.id)}`, {
  method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ markdown: savedText }),
});
check("PUT section succeeds", saved.status === 200 && saved.body.markdown.includes("save probe"));
const reread = await json(`/api/projects/${projectId}/sections/${encodeURIComponent(chapter.id)}`);
check("saved section reads back from its exact source", reread.body.markdown.includes("save probe"));
check("bundled sample source remains unchanged", (await fs.readFile(originalPath, "utf8")) === original);

const epub = await post(`/api/projects/${projectId}/export`, { format: "epub", preset: "kdp", meta: sample.body.meta, theme: "literary" });
check("sample exports a non-empty EPUB", epub.status === 200 && epub.body.bytes > 1000 && typeof epub.body.dataBase64 === "string", String(epub.body.bytes));
const docx = await post(`/api/projects/${projectId}/export`, { format: "docx", meta: sample.body.meta, theme: "literary" });
check("sample exports a non-empty DOCX", docx.status === 200 && docx.body.bytes > 1000 && typeof docx.body.dataBase64 === "string", String(docx.body.bytes));

const duplicateDir = path.join(os.tmpdir(), `folio-duplicate-${crypto.randomUUID()}`);
await fs.mkdir(path.join(duplicateDir, "chapters"), { recursive: true });
await fs.writeFile(path.join(duplicateDir, "book.yaml"), "title: Duplicate Titles\nauthor: Folio Test\nlanguage: en\ntheme: classic\nchapters: chapters\n");
const firstPath = path.join(duplicateDir, "chapters", "01.md");
const secondPath = path.join(duplicateDir, "chapters", "02.md");
await fs.writeFile(firstPath, "# Echo\n\nFirst file body.\n");
await fs.writeFile(secondPath, "# Echo\n\nSecond file body.\n");
const duplicates = await post("/api/projects/open-folder", { path: duplicateDir });
const secondSection = duplicates.body.sections[1];
await json(`/api/projects/${duplicates.body.projectId}/sections/${encodeURIComponent(secondSection.id)}`, {
  method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ markdown: "Edited second body." }),
});
check("duplicate titles save to the exact ingested file", (await fs.readFile(secondPath, "utf8")).includes("Edited second") && (await fs.readFile(firstPath, "utf8")).includes("First file"));
await fs.rm(duplicateDir, { recursive: true, force: true });

server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

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
app.use(express.json({ limit: "64mb" }));
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
const secondChapter = addedChapter.body.sections.find((item: any) => item.title === "Second Chapter");
const renamedChapter = await json(`/api/projects/${created.body.projectId}/sections/${encodeURIComponent(secondChapter.id)}`, {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Renamed Chapter" }),
});
check("chapter title can be renamed at its source", renamedChapter.status === 200 && renamedChapter.body.title === "Renamed Chapter");
const subtitledChapter = await json(`/api/projects/${created.body.projectId}/sections/${encodeURIComponent(renamedChapter.body.id)}`, {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ subtitle: "A precise second line" }),
});
check("chapter subtitle can be added at its source", subtitledChapter.status === 200 && subtitledChapter.body.subtitle === "A precise second line");
const clearedSubtitle = await json(`/api/projects/${created.body.projectId}/sections/${encodeURIComponent(subtitledChapter.body.id)}`, {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ subtitle: "" }),
});
check("chapter subtitle can be removed completely", clearedSubtitle.status === 200 && clearedSubtitle.body.subtitle === undefined);
const deletedChapter = await json(`/api/projects/${created.body.projectId}/sections/${encodeURIComponent(clearedSubtitle.body.id)}`, { method: "DELETE" });
const afterDelete = await post(`/api/projects/${created.body.projectId}/reload`, {});
check("chapter can be deleted without destroying its source", deletedChapter.status === 200 && afterDelete.body.sections.filter((item: any) => item.kind === "chapter").length === 1 && (await fs.readdir(path.join(newBookDir, ".folio-trash"))).length === 1);
const coverForm = new FormData();
coverForm.append("cover", new Blob([Buffer.from("89504e470d0a1a0a", "hex")], { type: "image/png" }), "folio-cover.png");
const covered = await json(`/api/projects/${created.body.projectId}/cover`, { method: "POST", body: coverForm });
const coverResponse = await fetch(`${base}/api/projects/${created.body.projectId}/cover`);
check("cover upload is persisted and served to the editor", covered.body.hasCover === true && coverResponse.status === 200 && coverResponse.headers.get("content-type") === "image/png");
const addedMatter = await post("/api/projects/" + created.body.projectId + "/matter", { type: "dedication", placement: "frontmatter", meta: created.body.meta });
const dedication = addedMatter.body.sections.find((item: any) => item.title === "Dedication");
const dedicationDocument = await json("/api/projects/" + created.body.projectId + "/sections/" + encodeURIComponent(dedication.id));
check("content API adds editable front matter", dedicationDocument.body.editable === true);
const addedBackMatter = await post("/api/projects/" + created.body.projectId + "/matter", { type: "about-the-author", placement: "backmatter", meta: created.body.meta });
const aboutAuthor = addedBackMatter.body.sections.find((item: any) => item.title === "About the Author");
const removedFront = await json(`/api/projects/${created.body.projectId}/sections/${encodeURIComponent(dedication.id)}`, { method: "DELETE" });
const removedBack = await json(`/api/projects/${created.body.projectId}/sections/${encodeURIComponent(aboutAuthor.id)}`, { method: "DELETE" });
const afterMatterDelete = await post(`/api/projects/${created.body.projectId}/reload`, {});
check("editable front matter can be deleted and unlisted", removedFront.status === 200 && !afterMatterDelete.body.sections.some((item: any) => item.title === "Dedication") && !afterMatterDelete.body.config.frontmatter.some((entry: string) => entry.includes("dedication")));
check("editable back matter can be deleted and unlisted", removedBack.status === 200 && !afterMatterDelete.body.sections.some((item: any) => item.title === "About the Author") && !afterMatterDelete.body.config.backmatter.some((entry: string) => entry.includes("about-the-author")));
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

const longDraft = Array.from({ length: 5200 }, (_, index) =>
  `Akapit ${index + 1}. Najprawdopodobniej profesjonalne formatowanie całej książki powinno zachowywać wszystkie akapity oraz wyróżnienia bez niekontrolowanych odstępów pomiędzy zwyczajnymi słowami podczas dokładnego podglądu czytnika${index === 5199 ? " WHOLE BOOK SERVER MARKER" : ""}.`,
).join("\n\n");
const longPreview = await post(`/api/projects/${projectId}/preview`, {
  meta: { ...sample.body.meta, language: "pl" }, theme: "folio", typography: { bodyAlign: "justify" }, previewSectionId: chapter.id, draft: longDraft,
});
check("100,000-word manuscript survives the exact Pandoc preview", longPreview.status === 200 && longPreview.body.html.includes("WHOLE BOOK SERVER MARKER") && longPreview.body.html.length > longDraft.length);
check("justified preview carries professional hyphenation rules", longPreview.body.html.includes("hyphenate-limit-chars: 7 3 3") && longPreview.body.html.includes("text-align-last: left"));
check("justification excludes and defensively centers ornamental breaks", longPreview.body.html.includes("section.chapter > p:not(.scene-break)") && longPreview.body.html.includes(".book-formatter .scene-break") && longPreview.body.html.includes("text-align: center !important"));
const polishSpacingPreview = await post(`/api/projects/${projectId}/preview`, {
  meta: { ...sample.body.meta, language: "pl" }, theme: "folio", typography: { bodyAlign: "justify" }, previewSectionId: chapter.id, draft: "A kiedy i później w Polsce z przyjaciółmi.",
});
check("Polish one-letter words stay with the following word", polishSpacingPreview.body.html.includes("\u00a0kiedy") && polishSpacingPreview.body.html.includes("i\u00a0później"));

const hiddenLabelPreview = await post(`/api/projects/${projectId}/preview`, {
  meta: sample.body.meta, theme: "literary", typography: { chapterTitle: { showLabel: false } }, previewSectionId: chapter.id, draft: "Label control probe.",
});
check("theme-generated CHAPTER label can be hidden", hiddenLabelPreview.body.html.includes("h1.chapter::before { content: none !important; display: none !important; }"));
const customLabelPreview = await post(`/api/projects/${projectId}/preview`, {
  meta: sample.body.meta, theme: "literary", typography: { chapterTitle: { labelText: "CZĘŚĆ I" } }, previewSectionId: chapter.id, draft: "Custom label probe.",
});
check("theme-generated chapter label can be replaced", customLabelPreview.body.html.includes('content: "CZĘŚĆ I" !important'));

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

const combinedDir = path.join(os.tmpdir(), `folio-combined-${crypto.randomUUID()}`);
await fs.mkdir(combinedDir, { recursive: true });
await fs.writeFile(path.join(combinedDir, "book.yaml"), "title: Combined\nauthor: Folio Test\nlanguage: en\ntheme: classic\nchapters: manuscript.md\n");
const combinedPath = path.join(combinedDir, "manuscript.md");
await fs.writeFile(combinedPath, "# Alpha\n\nAlpha body.\n\n# Beta\n\nBeta body.\n");
const combined = await post("/api/projects/open-folder", { path: combinedDir });
const beta = combined.body.sections.find((item: any) => item.title === "Beta");
const renamedBeta = await json(`/api/projects/${combined.body.projectId}/sections/${encodeURIComponent(beta.id)}`, {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Gamma" }),
});
await json(`/api/projects/${combined.body.projectId}/sections/${encodeURIComponent(renamedBeta.body.id)}`, { method: "DELETE" });
const combinedSource = await fs.readFile(combinedPath, "utf8");
check("combined Markdown chapters rename and delete by exact ordinal", /# Alpha/.test(combinedSource) && !/# (?:Beta|Gamma)/.test(combinedSource));
await fs.rm(combinedDir, { recursive: true, force: true });

server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

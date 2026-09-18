import express from "express";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { AddressInfo } from "node:net";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

console.log("\nFolio project-file API");

const root = await fs.mkdtemp(path.join(os.tmpdir(), "folio-project-api-test-"));
const projectFile = path.join(root, "API Novel.folio");
const exportDir = path.join(root, "exports");

const app = express();
app.use(express.json({ limit: "5mb" }));
registerApi(app);
registerEditorApi(app);
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;

async function request(method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(base + url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = await response.json();
  return { status: response.status, body: parsed };
}

try {
  const created = await request("POST", "/api/projects/new", {
    path: projectFile,
    title: "API Novel",
    author: "Folio QA",
  });
  check("creates a standalone .folio project", created.status === 200 && created.body.source === "folio" && created.body.projectFile === path.resolve(projectFile), JSON.stringify(created.body));
  const projectId = created.body.projectId as string;
  const sectionId = created.body.sections?.find((section: any) => section.kind === "chapter")?.id as string;
  check("creates an editable starter chapter", Boolean(projectId && sectionId));

  const savedText = "# Chapter One\n\nPersisted through the editor API.\n";
  const saved = await request("PUT", `/api/projects/${projectId}/sections/${encodeURIComponent(sectionId)}`, { markdown: savedText });
  check("saves chapter text through the editor API", saved.status === 200 && saved.body.markdown.includes("Persisted through the editor API."));

  const flushed = await request("POST", `/api/projects/${projectId}/flush`, {});
  check("flushes working-copy changes into the .folio file", flushed.status === 200 && flushed.body.ok === true);

  const fileStat = await fs.stat(projectFile);
  check("project remains one on-disk file after editing", fileStat.isFile() && fileStat.size > 1000, String(fileStat.size));

  const closed = await request("POST", `/api/projects/${projectId}/close`, {});
  check("closes the private working copy cleanly", closed.status === 200 && closed.body.ok === true);

  const reopened = await request("POST", "/api/projects/open-file", { path: projectFile });
  check("reopens the same .folio file", reopened.status === 200 && reopened.body.source === "folio");
  const reopenedId = reopened.body.projectId as string;
  const reopenedSectionId = reopened.body.sections?.find((section: any) => section.kind === "chapter")?.id as string;
  const document = await request("GET", `/api/projects/${reopenedId}/sections/${encodeURIComponent(reopenedSectionId)}`);
  check("restores saved manuscript text after reopen", document.status === 200 && document.body.markdown.includes("Persisted through the editor API."));

  const exported = await request("POST", `/api/projects/${reopenedId}/export`, {
    format: "md",
    meta: {},
    theme: "literary",
    outputDir: exportDir,
  });
  check("writes exports to the configured Settings folder", exported.status === 200 && exported.body.written === true && String(exported.body.path).startsWith(path.resolve(exportDir)), exported.body.path);
  check("uses the .folio filename as the export slug", /^api-novel_v\d+_\d{4}-\d{2}-\d{2}\.md$/i.test(exported.body.filename ?? ""), exported.body.filename);

  await request("POST", `/api/projects/${reopenedId}/close`, {});
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(root, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

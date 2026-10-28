import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { makeBookFixture } from "./fixtures/book.ts";

const fixture = await makeBookFixture();
const app = express(); app.use(express.json()); registerApi(app); registerEditorApi(app);
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
async function post(route: string, body: unknown) { return fetch(base + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
try {
  const opened = await (await post("/api/projects/open-folder", { path: fixture.bookDir })).json() as any;
  const chapter = opened.sections.find((section: any) => section.kind === "chapter");
  const preflight = await post(`/api/projects/${opened.projectId}/preflight`, { format: "epub", previewSectionId: chapter.id, draft: "Prose before.\n\n![Lost](missing-test.png)\n\nProse after." });
  const report = await preflight.json() as any;
  assert.equal(preflight.status, 200);
  assert.equal(report.ready, false);
  assert.ok(report.issues.some((issue: any) => issue.code === "ASSET_MISSING" && issue.sectionId === chapter.id));
  const savedBefore = await (await fetch(`${base}/api/projects/${opened.projectId}/sections/${encodeURIComponent(chapter.id)}`)).text();
  assert.ok(!savedBefore.includes("missing-test.png"), "Draft preflight must not write to the manuscript");
  const saved = await fetch(`${base}/api/projects/${opened.projectId}/sections/${encodeURIComponent(chapter.id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ markdown: "![Lost](missing-test.png)" }) });
  assert.equal(saved.status, 200);
  const blocked = await post(`/api/projects/${opened.projectId}/export`, { format: "epub", preset: "kdp" });
  assert.ok(!blocked.ok, "Export must stop before generating an artifact with missing illustrations");
  assert.match((await blocked.json() as any).error, /Publish Preflight.*missing-test.png/);
  console.log("7 passed, 0 failed");
} finally { await new Promise<void>((resolve) => server.close(() => resolve())); await fixture.cleanup(); }

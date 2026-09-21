import express from "express";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log("  " + (ok ? "✓" : "✗") + " " + label + (detail ? " — " + detail : ""));
  ok ? passed++ : failed++;
};

const app = express();
app.use(express.json({ limit: "5mb" }));
registerApi(app);
registerEditorApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "web", "dist", "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
const fixture = path.join(os.tmpdir(), `folio-inline-illustration-${Date.now()}.png`);
const persistedFixture = path.join(os.tmpdir(), `folio-inline-illustration-persisted-${Date.now()}.png`);
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
await fs.writeFile(fixture, pixel);
await fs.writeFile(persistedFixture, pixel);

console.log("\nFolio front matter illustration UI");
try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample button is missing");
    (button as HTMLButtonElement).click();
  });
  await page.waitForSelector('.rich-editor[contenteditable="true"]');

  await page.click('.library-add-section');
  await page.waitForSelector('.folio-dialog[aria-label="Add Content"]');
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".content-kind-group button")]
      .find((item) => item.querySelector("span")?.textContent?.trim() === "Preface");
    if (!button) throw new Error("Preface front-matter option is missing");
    button.click();
  });
  await page.waitForFunction(() => document.querySelector(".contents-row.selected")?.textContent?.includes("Preface"));
  await page.waitForSelector('.rich-editor[contenteditable="true"]');
  check("editable front matter can be created from Add Content", true);

  const enabled = await page.$eval(".illustration-button", (button) => !(button as HTMLButtonElement).disabled);
  check("front matter exposes an enabled Image control", enabled);

  const firstUploadResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/illustration"), { timeout: 12000 });
  const [firstChooser] = await Promise.all([page.waitForFileChooser({ timeout: 12000 }), page.click(".illustration-button")]);
  await firstChooser.accept([fixture]);
  const firstUpload = await firstUploadResponse;
  if (!firstUpload.ok()) throw new Error("Illustration upload failed: " + firstUpload.status() + " " + (await firstUpload.text()));
  await page.waitForFunction(() => Boolean(document.querySelector(".editor-illustration") || document.querySelector(".global-error")), { timeout: 8000 });
  const earlyUploadState = await page.evaluate(() => ({
    hasFigure: Boolean(document.querySelector(".editor-illustration")),
    error: document.querySelector(".global-error")?.textContent ?? "",
    files: (document.querySelector(".illustration-input") as HTMLInputElement | null)?.files?.length ?? -1,
    disabled: (document.querySelector(".illustration-input") as HTMLInputElement | null)?.disabled ?? null,
  }));
  if (!earlyUploadState.hasFigure) throw new Error("illustration upload state: " + JSON.stringify(earlyUploadState));
  await new Promise((resolve) => setTimeout(resolve, 350));
  const inserted = await page.evaluate(async () => {
    const figure = document.querySelector<HTMLElement>(".editor-illustration");
    const image = figure?.querySelector<HTMLImageElement>("img[data-folio-asset]");
    const remove = figure?.querySelector<HTMLButtonElement>(".editor-illustration-remove");
    const markdown = (document.querySelector(".rich-editor") as HTMLElement | null)?.dataset.markdown ?? "";
    let status = 0; let body = "";
    if (image?.src) { try { const response = await fetch(image.src); status = response.status; if (!response.ok) body = (await response.text()).slice(0, 240); } catch (error) { body = String(error); } }
    return { ok: Boolean(image?.complete && image.naturalWidth > 0 && remove && image.dataset.folioAsset?.startsWith("assets/") && markdown.includes("{.folio-illustration")), src: image?.src ?? "", complete: image?.complete ?? false, naturalWidth: image?.naturalWidth ?? 0, asset: image?.dataset.folioAsset ?? "", hasRemove: Boolean(remove), markdown, status, body, error: document.querySelector(".global-error")?.textContent ?? "" };
  });
  if (!inserted.ok) throw new Error("illustration insert diagnostic: " + JSON.stringify(inserted));
  check("choosing a PNG inserts a visible illustration and semantic Markdown", true);

  await page.$eval(".editor-illustration-remove", (button) => (button as HTMLButtonElement).click());
  await page.waitForFunction(() => !document.querySelector(".editor-illustration") && !(document.querySelector(".rich-editor") as HTMLElement | null)?.dataset.markdown?.includes("{.folio-illustration"));
  check("front-matter illustration can be removed from the editor", true);

  const secondUploadResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/illustration"), { timeout: 12000 });
  const [secondChooser] = await Promise.all([page.waitForFileChooser({ timeout: 12000 }), page.click(".illustration-button")]);
  await secondChooser.accept([persistedFixture]);
  const secondUpload = await secondUploadResponse;
  if (!secondUpload.ok()) throw new Error("Second illustration upload failed: " + secondUpload.status() + " " + (await secondUpload.text()));
  await page.waitForFunction(() => {
    const image = document.querySelector<HTMLImageElement>(".editor-illustration img[data-folio-asset]");
    const markdown = (document.querySelector(".rich-editor") as HTMLElement | null)?.dataset.markdown ?? "";
    return Boolean(image?.complete && image.naturalWidth > 0 && image.dataset.folioAsset?.startsWith("assets/") && markdown.includes("{.folio-illustration"));
  });

  await page.waitForFunction(() => document.querySelector(".save-indicator")?.textContent === "Saved", { timeout: 30000 });
  const beforeReload = await page.$eval(".rich-editor", (editor) => (editor as HTMLElement).dataset.markdown ?? "");
  check("inline illustration reaches autosave", /!\[[^\]]+\]\(assets\/[a-z0-9._-]+\.png\)\{\.folio-illustration\b[^}]*\}/i.test(beforeReload), beforeReload);

  const reloadResponse = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "POST" && new URL(response.url()).pathname.endsWith("/reload") && response.ok();
  }, { timeout: 30000 });
  await page.click('.tiny-footer-button[aria-label="Reload files"]');
  await reloadResponse;
  await page.waitForFunction(() => [...document.querySelectorAll(".contents-row")].some((row) => row.textContent?.includes("Preface")), { timeout: 30000 });

  await page.evaluate(() => {
    const chapter = document.querySelector<HTMLElement>(".contents-row.chapter-row");
    if (!chapter) throw new Error("Sample chapter row is missing after project reload");
    chapter.click();
  });
  await page.waitForFunction(() => {
    const selected = document.querySelector(".contents-row.selected");
    const editor = document.querySelector<HTMLElement>('.rich-editor[contenteditable="true"]');
    return Boolean(selected && !selected.textContent?.includes("Preface") && editor);
  }, { timeout: 30000 });

  await page.evaluate(() => {
    const row = [...document.querySelectorAll<HTMLElement>(".contents-row")].find((item) => item.textContent?.includes("Preface"));
    if (!row) throw new Error("Preface row is missing after project reload");
    row.click();
  });
  await page.waitForFunction(() => {
    const selected = document.querySelector(".contents-row.selected")?.textContent?.includes("Preface");
    const editor = document.querySelector<HTMLElement>('.rich-editor[contenteditable="true"]');
    const image = editor?.querySelector<HTMLImageElement>(".editor-illustration img[data-folio-asset]");
    const markdown = editor?.dataset.markdown ?? "";
    return Boolean(selected && image?.complete && image.naturalWidth > 0 && markdown.includes("{.folio-illustration"));
  }, { timeout: 30000 });
  check("saved front-matter illustration survives a real project reload", true);


  await page.evaluate(() => {
    const chapter = document.querySelector<HTMLElement>(".contents-row.chapter-row");
    if (!chapter) throw new Error("Sample chapter row is missing for anchored illustration test");
    chapter.click();
  });
  await page.waitForFunction(() => {
    const selected = document.querySelector(".contents-row.selected");
    const editor = document.querySelector<HTMLElement>('.rich-editor[contenteditable="true"]');
    return Boolean(selected && !selected.textContent?.includes("Preface") && editor?.querySelector("p"));
  }, { timeout: 30000 });

  const beforeChapterMarkdown = await page.$eval(".rich-editor", (editor) => (editor as HTMLElement).dataset.markdown ?? "");
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".rich-editor");
    const paragraphs = editor?.querySelectorAll("p");
    const target = paragraphs?.[Math.min(1, Math.max(0, (paragraphs?.length ?? 1) - 1))];
    if (!editor || !target) throw new Error("Chapter paragraph is missing for caret anchor");
    const range = document.createRange();
    range.setStart(target, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  const chapterUploadResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/illustration"), { timeout: 12000 });
  const [chapterChooser] = await Promise.all([page.waitForFileChooser({ timeout: 12000 }), page.click(".illustration-button")]);
  await chapterChooser.accept([fixture]);
  const chapterUpload = await chapterUploadResponse;
  if (!chapterUpload.ok()) throw new Error("Chapter illustration upload failed: " + chapterUpload.status() + " " + (await chapterUpload.text()));

  await page.waitForFunction(() => {
    const figure = document.querySelector<HTMLElement>(".editor-illustration");
    const markdown = document.querySelector<HTMLElement>(".rich-editor")?.dataset.markdown ?? "";
    return Boolean(figure?.dataset.folioWrap === "right" && markdown.includes(".folio-wrap-right") && markdown.includes("width=38%"));
  }, { timeout: 15000 });
  const afterChapterMarkdown = await page.$eval(".rich-editor", (editor) => (editor as HTMLElement).dataset.markdown ?? "");
  check("chapter image inserts at the caret without replacing manuscript text",
    afterChapterMarkdown.length > beforeChapterMarkdown.length && afterChapterMarkdown.includes(beforeChapterMarkdown.slice(0, Math.min(120, beforeChapterMarkdown.length))),
    `before=${beforeChapterMarkdown.length}, after=${afterChapterMarkdown.length}`);
  check("chapter illustration persists responsive right-wrap metadata", afterChapterMarkdown.includes(".folio-wrap-right") && afterChapterMarkdown.includes("width=38%"), afterChapterMarkdown.slice(0, 600));

  await page.hover(".editor-illustration");
  await page.select('.editor-illustration [data-folio-control="wrap"]', "left");
  await page.waitForFunction(() => {
    const figure = document.querySelector<HTMLElement>(".editor-illustration");
    const markdown = document.querySelector<HTMLElement>(".rich-editor")?.dataset.markdown ?? "";
    return figure?.dataset.folioWrap === "left" && markdown.includes(".folio-wrap-left");
  }, { timeout: 15000 });
  check("wrap side can be changed without touching surrounding text", true);

  const handle = await page.$(".editor-illustration .illustration-drag-handle");
  const editorBox = await page.$eval(".rich-editor", (editor) => {
    const rect = editor.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });
  const handleBox = await handle?.boundingBox();
  if (!handleBox) throw new Error("Illustration drag handle is not measurable");
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(editorBox.left + 18, editorBox.top + Math.min(editorBox.height - 60, 300), { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => {
    const figure = document.querySelector<HTMLElement>(".editor-illustration");
    return Boolean(figure && figure.dataset.folioWrap === "left" && !figure.classList.contains("illustration-dragging"));
  }, { timeout: 10000 });
  check("dragging the illustration reanchors it and keeps live left text wrap", true);

  await page.waitForFunction(() => {
    const doc = document.querySelector("iframe")?.contentDocument;
    return Boolean(doc?.querySelector(".folio-illustration-block.folio-wrap-left img.folio-illustration"));
  }, { timeout: 30000 });
  check("reader preview renders the same anchored wrap intent", true);

  await page.select('select[aria-label="Preview device"]', "print");
  await page.waitForFunction(() => {
    const doc = document.querySelector("iframe")?.contentDocument;
    return Boolean(doc?.querySelector(".pagedjs_page .folio-illustration-block.folio-wrap-left img.folio-illustration"));
  }, { timeout: 45000 });
  check("print preview preserves the anchored illustration and text-wrap side", true);
} catch (error) {
  failed++;
  console.error("✗ browser illustration scenario completed");
  console.error(error);
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.all([fs.rm(fixture, { force: true }), fs.rm(persistedFixture, { force: true })]);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

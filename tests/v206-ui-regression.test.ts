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
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
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
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const mapFixture = path.join(os.tmpdir(), `Folio V206 Map ${Date.now()}.png`);
const mapLabel = path.basename(mapFixture, ".png").replace(/[-_]+/g, " ");
const neutralImageLabel = "Full-page Image";
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAQAAABWESUoAAAADElEQVR42mNk+M8AAAICAQB7CY8fAAAAAElFTkSuQmCC",
  "base64",
);
await fs.writeFile(mapFixture, pixel);

console.log("\nFolio 2.0.7 visual/media regression gate");
try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  let projectId = "";
  page.on("request", (request) => {
    const match = new URL(request.url()).pathname.match(/^\/api\/projects\/([^/]+)\//);
    if (match) projectId = decodeURIComponent(match[1]);
  });
  page.setDefaultTimeout(30000);
  await page.setViewport({ width: 1536, height: 960 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample button missing");
    (button as HTMLButtonElement).click();
  });
  await page.waitForSelector(".folio-shell .command-wordmark");
  await page.waitForFunction(() => document.fonts.check('16px "Pelagiad"') && document.fonts.check('12px "Source Sans 3"'));

  const typography = await page.evaluate(() => {
    const manuscriptElement = document.querySelector(".pane-label");
    const previewElement = document.querySelector(".preview-pane-title");
    const exportElement = document.querySelector(".generate-button");
    const wordmarkElement = document.querySelector(".command-wordmark");
    if (!manuscriptElement || !previewElement || !exportElement || !wordmarkElement) throw new Error("Core UI typography elements missing");
    const manuscript = getComputedStyle(manuscriptElement);
    const preview = getComputedStyle(previewElement);
    const exportButton = getComputedStyle(exportElement);
    const wordmark = getComputedStyle(wordmarkElement);
    return {
      logoFont: wordmark.fontFamily,
      logoTransform: wordmark.textTransform,
      manuscriptFont: manuscript.fontFamily,
      previewFont: preview.fontFamily,
      manuscriptSize: manuscript.fontSize,
      previewSize: preview.fontSize,
      manuscriptWeight: manuscript.fontWeight,
      previewWeight: preview.fontWeight,
      manuscriptTracking: manuscript.letterSpacing,
      previewTracking: preview.letterSpacing,
      exportFont: exportButton.fontFamily,
      exportHeight: Number.parseFloat(exportButton.height),
      exportBackground: exportButton.backgroundColor,
    };
  });
  check("Folio wordmark uses the exact Pelagiad family", typography.logoFont.includes("Pelagiad"), typography.logoFont);
  check("Folio wordmark keeps its lowercase branding treatment", typography.logoTransform === "lowercase", typography.logoTransform);
  check("application chrome uses the single Source Sans UI family", typography.manuscriptFont.includes("Source Sans 3") && typography.previewFont.includes("Source Sans 3") && typography.exportFont.includes("Source Sans 3"), `${typography.manuscriptFont} | ${typography.previewFont} | ${typography.exportFont}`);
  check("Manuscript and Page Preview share the UI family with deliberate label hierarchy",
    typography.manuscriptFont === typography.previewFont &&
    typography.manuscriptWeight === typography.previewWeight &&
    Number.parseFloat(typography.manuscriptSize) >= Number.parseFloat(typography.previewSize) &&
    Number.parseFloat(typography.manuscriptSize) - Number.parseFloat(typography.previewSize) <= 2 &&
    Number.parseFloat(typography.previewTracking) >= Number.parseFloat(typography.manuscriptTracking),
    JSON.stringify(typography));
  check("Export is a full desktop control rather than the old tiny CTA", typography.exportHeight >= 34 && typography.exportBackground !== "rgb(164, 113, 72)", `${typography.exportHeight}px / ${typography.exportBackground}`);

  await page.evaluate(() => {
    const cover = [...document.querySelectorAll<HTMLButtonElement>(".contents-row")].find((item) => item.textContent?.trim().startsWith("Cover"));
    if (!cover) throw new Error("Cover row missing");
    cover.click();
  });
  await page.waitForSelector(".cover-preview-surface img");
  const coverState = await page.evaluate(() => {
    const preview = document.querySelector<HTMLImageElement>(".cover-preview-surface img");
    const button = document.querySelector<HTMLElement>(".cover-upload-button");
    if (!preview || !button) throw new Error("Cover preview or Replace Cover control missing");
    const previewStyle = getComputedStyle(preview);
    const buttonStyle = getComputedStyle(button);
    return {
      fit: previewStyle.objectFit,
      buttonHeight: Number.parseFloat(buttonStyle.height),
      buttonFont: buttonStyle.fontFamily,
      buttonRadius: buttonStyle.borderRadius,
    };
  });
  check("cover preview maximises without cropping", coverState.fit === "contain", coverState.fit);
  check("Replace Cover is a coherent desktop secondary action", coverState.buttonHeight >= 34 && coverState.buttonFont.includes("Source Sans 3") && Number.parseFloat(coverState.buttonRadius) <= 5, JSON.stringify(coverState));

  await page.click(".contents-list button.chapter-row");
  await page.waitForSelector('.rich-editor[contenteditable="true"]');
  check("Full Page insertion is absent from the chapter toolbar", await page.$('button[title^="Insert full-page"]') === null);
  await page.click(".library-add-section");
  await page.waitForSelector('.folio-dialog[aria-label="Add Content"]');
  check("Add Content no longer offers full-page image creation", await page.$(".content-image-kind") === null);
  await page.evaluate(() => {
    const close = [...document.querySelectorAll<HTMLButtonElement>(".folio-dialog button")].find((el) => el.textContent?.trim() === "Close");
    if (!close) throw new Error("Add Content close action missing");
    close.click();
  });

  // Open a real legacy document with an image between two prose paragraphs.
  const sectionId = await page.$eval(".rich-editor", (el) => (el as HTMLElement).dataset.sectionId!);
  if (!projectId) throw new Error("Sample project ID was not observed");
  const upload = new FormData();
  upload.append("image", new Blob([pixel], { type: "image/png" }), "legacy-map.png");
  const uploaded = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/illustration`, { method: "POST", body: upload });
  if (!uploaded.ok) throw new Error(`Legacy fixture image failed: ${await uploaded.text()}`);
  const { asset } = await uploaded.json() as { asset: string };
  const legacy = `BEFORE_LEGACY_IMAGE\n\n![Map](${asset}){.full-page-image .fit-contain}\n\nAFTER_LEGACY_IMAGE`;
  const sectionUrl = `${base}/api/projects/${encodeURIComponent(projectId)}/sections/${encodeURIComponent(sectionId)}`;
  const saved = await fetch(sectionUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markdown: legacy }) });
  if (!saved.ok) throw new Error(`Legacy fixture save failed: ${await saved.text()}`);
  await page.click('.tiny-footer-button[aria-label="Reload files"]');
  await page.waitForFunction(() => document.querySelector<HTMLElement>(".rich-editor")?.dataset.markdown?.includes("BEFORE_LEGACY_IMAGE"));
  await page.waitForSelector('.rich-editor[contenteditable="true"] .editor-illustration img');
  const legacyState = await page.$eval(".rich-editor", (el) => ({ editable: el.getAttribute("contenteditable"), text: (el as HTMLElement).innerText, locked: Boolean(el.closest(".folio-image-page-mode")), fullPage: Boolean(el.querySelector(".editor-full-page-image")) }));
  check("legacy image cannot lock or replace the chapter", legacyState.editable === "true" && !legacyState.locked && !legacyState.fullPage && legacyState.text.includes("BEFORE_LEGACY_IMAGE") && legacyState.text.includes("AFTER_LEGACY_IMAGE"), JSON.stringify(legacyState));
  await page.waitForFunction(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    return doc?.body.textContent?.replace(/[\u00ad-]/g, "").includes("AFTER_LEGACY_IMAGE") && !document.querySelector(".preview-loading");
  }).catch(async (error) => {
    const state = await page.evaluate(() => ({
      device: (document.querySelector('select[aria-label="Preview device"]') as HTMLSelectElement | null)?.value,
      loading: Boolean(document.querySelector(".preview-loading")),
      previewError: document.querySelector(".preview-error")?.textContent,
      editor: document.querySelector<HTMLElement>(".rich-editor")?.dataset.markdown,
      frame: document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument?.body.textContent?.slice(-1800),
    }));
    throw new Error(`Legacy reader did not become ready: ${JSON.stringify(state)}; ${error}`);
  });
  await page.click(".rich-editor");
  await page.keyboard.press("Control+End");
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".rich-editor")!;
    const figure = editor.querySelector(".editor-illustration")!;
    const section = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument?.querySelector("section.chapter, section.level1");
    (window as any).__folioTypingMutations = { figure: 0, preview: 0 };
    const figObserver = new MutationObserver((records) => { (window as any).__folioTypingMutations.figure += records.length; });
    figObserver.observe(figure, { attributes: true, subtree: true });
    const previewObserver = new MutationObserver((records) => { (window as any).__folioTypingMutations.preview += records.filter((r) => r.target === section && r.removedNodes.length > 0).length; });
    if (!section) throw new Error("Reader section missing before typing performance test");
    previewObserver.observe(section, { childList: true });
    (window as any).__folioStopTypingObservers = () => { figObserver.disconnect(); previewObserver.disconnect(); };
  });
  await page.keyboard.type(" RESPONSIVENESS_CHECK_123456789", { delay: 25 });
  const typingMutations = await page.evaluate(() => {
    (window as any).__folioStopTypingObservers();
    return (window as any).__folioTypingMutations as { figure: number; preview: number };
  });
  check("ordinary typing does not rehydrate unrelated illustrations", typingMutations.figure === 0, JSON.stringify(typingMutations));
  check("preview does not rebuild the chapter on every keystroke", typingMutations.preview === 0, JSON.stringify(typingMutations));
  await page.waitForFunction(() => document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument?.body.textContent?.replace(/[\u00ad-]/g, "").includes("RESPONSIVENESS_CHECK_123456789"));
  await page.hover(".editor-illustration");
  await page.click(".editor-illustration-remove");
  await page.waitForFunction(() => {
    const editor = document.querySelector<HTMLElement>(".rich-editor");
    return !editor?.querySelector(".editor-illustration") && editor?.dataset.markdown?.includes("BEFORE_LEGACY_IMAGE") && editor?.dataset.markdown?.includes("AFTER_LEGACY_IMAGE");
  });
  await page.click(".rich-editor");
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" STILL_EDITABLE");
  await page.waitForFunction(() => document.querySelector<HTMLElement>(".rich-editor")?.dataset.markdown?.includes("STILL_EDITABLE"));
  await page.waitForFunction(() => document.querySelector(".folio-shell")?.getAttribute("data-save-state") === "saved");
  await page.click('.tiny-footer-button[aria-label="Reload files"]');
  await page.waitForFunction(() => document.querySelector<HTMLElement>(".rich-editor")?.dataset.markdown?.includes("STILL_EDITABLE"));
  const restored = await (await fetch(sectionUrl)).json() as { markdown: string };
  check("removing legacy art, typing and reloading preserves chapter prose", restored.markdown.includes("BEFORE_LEGACY_IMAGE") && restored.markdown.includes("AFTER_LEGACY_IMAGE") && restored.markdown.includes("STILL_EDITABLE") && !restored.markdown.includes(".full-page-image") && !restored.markdown.includes(asset));
} catch (error) {
  failed++;
  console.error("✗ Folio 2.0.7 browser regression scenario");
  console.error(error);
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(mapFixture, { force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

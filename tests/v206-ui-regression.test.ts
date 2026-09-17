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
  page.setDefaultTimeout(30000);
  await page.setViewport({ width: 1536, height: 960 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample button missing");
    (button as HTMLButtonElement).click();
  });
  await page.waitForSelector(".folio-shell .command-wordmark");
  await page.waitForFunction(() => document.fonts.check('16px "Folio Pelagiad Exact"') && document.fonts.check('12px "Folio Source Sans 3"'));

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
  check("Folio wordmark uses the exact Pelagiad family", typography.logoFont.includes("Folio Pelagiad Exact"), typography.logoFont);
  check("Folio wordmark keeps its lowercase branding treatment", typography.logoTransform === "lowercase", typography.logoTransform);
  check("application chrome uses the single Source Sans UI family", typography.manuscriptFont.includes("Folio Source Sans 3") && typography.previewFont.includes("Folio Source Sans 3") && typography.exportFont.includes("Folio Source Sans 3"), `${typography.manuscriptFont} | ${typography.previewFont} | ${typography.exportFont}`);
  check("Manuscript and Page Preview have identical type metrics", typography.manuscriptFont === typography.previewFont && typography.manuscriptSize === typography.previewSize && typography.manuscriptWeight === typography.previewWeight && typography.manuscriptTracking === typography.previewTracking, JSON.stringify(typography));
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
  check("Replace Cover is a coherent desktop secondary action", coverState.buttonHeight >= 34 && coverState.buttonFont.includes("Folio Source Sans 3") && Number.parseFloat(coverState.buttonRadius) <= 5, JSON.stringify(coverState));

  async function addFullPageImage() {
    const beforeCount = await page.$$eval(".contents-list .contents-row:not(.cover-row)", (rows, label) => rows.filter((row) => (row.textContent ?? "").includes(String(label))).length, neutralImageLabel);
    await page.click('.library-add-section');
    await page.waitForSelector('.folio-dialog[aria-label="Add Content"] .content-image-kind');
    const uploadResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/image-page"), { timeout: 30000 });
    const [chooser] = await Promise.all([
      page.waitForFileChooser({ timeout: 12000 }),
      page.click(".content-image-kind"),
    ]);
    await chooser.accept([mapFixture]);
    const response = await uploadResponse;
    if (!response.ok()) throw new Error(`Full-page image upload failed: ${response.status()} ${await response.text()}`);
    await page.waitForFunction((label, count) => [...document.querySelectorAll(".contents-list .contents-row:not(.cover-row)")].filter((row) => (row.textContent ?? "").includes(String(label))).length > Number(count), { timeout: 30000 }, neutralImageLabel, beforeCount);
    await page.waitForFunction(() => Boolean(document.querySelector(".editor-pane.folio-image-page-mode") || document.querySelector(".global-error")), { timeout: 30000 });
    const error = await page.$eval("body", (body) => body.querySelector(".global-error")?.textContent ?? "");
    if (error) throw new Error(error);
  }

  await addFullPageImage();
  const filenameVisible = await page.$eval(".contents-list", (nav, label) => (nav.textContent ?? "").includes(String(label)), mapLabel);
  check("Full-page Image never exposes the uploaded filename as a visible title", !filenameVisible, mapLabel);
  await page.waitForSelector(".editor-pane.folio-image-page-mode .editor-full-page-art img");
  const workspace = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>(".editor-pane.folio-image-page-mode");
    const toolbar = pane?.querySelector<HTMLElement>(".format-toolbar");
    const paper = pane?.querySelector<HTMLElement>(".editor-paper");
    const editor = pane?.querySelector<HTMLElement>(".folio-image-page-editor");
    const figure = pane?.querySelector<HTMLElement>(".editor-full-page-art");
    const image = figure?.querySelector<HTMLImageElement>("img");
    if (!pane || !toolbar || !paper || !editor || !figure || !image) throw new Error("Dedicated image-page workspace is incomplete");
    const controls = figure.querySelector<HTMLElement>(".editor-illustration-controls");
    const remove = figure.querySelector<HTMLElement>(".editor-illustration-remove");
    return {
      toolbar: getComputedStyle(toolbar).display,
      paperBackground: getComputedStyle(paper).backgroundColor,
      editorBackground: getComputedStyle(editor).backgroundColor,
      editable: editor.getAttribute("contenteditable"),
      fit: getComputedStyle(image).objectFit,
      figureWidth: figure.getBoundingClientRect().width,
      editorWidth: editor.getBoundingClientRect().width,
      controls: controls ? getComputedStyle(controls).display : "missing",
      remove: remove ? getComputedStyle(remove).display : "missing",
    };
  });
  check("Full-page Image has a dedicated non-text workspace", workspace.toolbar === "none" && workspace.editable === "false", JSON.stringify(workspace));
  check("image-page workspace is white and fills the editor surface", workspace.paperBackground === "rgb(255, 255, 255)" && workspace.editorBackground === "rgb(255, 255, 255)" && Math.abs(workspace.figureWidth - workspace.editorWidth) < 2, JSON.stringify(workspace));
  check("full-page artwork never exposes crop/remove-X controls", workspace.fit === "contain" && ["none", "missing"].includes(workspace.controls) && ["none", "missing"].includes(workspace.remove), JSON.stringify(workspace));

  await page.waitForFunction(() => {
    const frame = document.querySelector("iframe") as HTMLIFrameElement | null;
    return Boolean(frame?.contentDocument?.querySelector("section.image-page img.full-page-image"));
  }, { timeout: 30000 });
  const previewImage = await page.$eval("iframe", (frame) => {
    const doc = frame.contentDocument;
    const image = doc?.querySelector<HTMLImageElement>("section.image-page img.full-page-image");
    if (!doc || !image) throw new Error("Reader full-page image missing");
    return {
      fit: getComputedStyle(image).objectFit,
      imageBackground: getComputedStyle(image).backgroundColor,
      bodyBackground: getComputedStyle(doc.body).backgroundColor,
      scrollWidth: doc.documentElement.scrollWidth,
      clientWidth: doc.documentElement.clientWidth,
    };
  });
  check("Reader map preview is contain-fit on white with no horizontal scroll", previewImage.fit === "contain" && previewImage.imageBackground === "rgb(255, 255, 255)" && previewImage.bodyBackground === "rgb(255, 255, 255)" && previewImage.scrollWidth <= previewImage.clientWidth + 1, JSON.stringify(previewImage));

  await addFullPageImage();
  const labels = await page.$$eval(".contents-list .contents-row:not(.cover-row)", (rows, label) => rows.map((row) => row.textContent?.trim() ?? "").filter((text) => text.includes(String(label))), neutralImageLabel);
  check("repeated Full-page Image entries stay neutral and filename-free", labels.length >= 2 && labels.every((label) => label === neutralImageLabel), labels.join(" | "));
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

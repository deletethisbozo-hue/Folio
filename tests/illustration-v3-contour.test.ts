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

const alphaPng = Buffer.from(
  "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",
  "base64",
);

function contourGeometry(doc: Document, figure: HTMLElement): { shape: string; spread: number; intrudes: boolean; lines: number[] } | null {
  let paragraph = figure.nextElementSibling as HTMLElement | null;
  while (paragraph && paragraph.tagName !== "P") paragraph = paragraph.nextElementSibling as HTMLElement | null;
  if (!paragraph) return null;

  const range = doc.createRange();
  range.selectNodeContents(paragraph);
  const figureRect = figure.getBoundingClientRect();
  const rects = [...range.getClientRects()]
    .filter((rect) => rect.height > 4 && rect.top < figureRect.bottom - 3 && rect.bottom > figureRect.top + 3);
  const lefts = rects.map((rect) => rect.left);
  const spread = lefts.length ? Math.max(...lefts) - Math.min(...lefts) : 0;
  return {
    shape: getComputedStyle(figure).shapeOutside,
    spread,
    intrudes: lefts.some((left) => left < figureRect.right - 8),
    lines: lefts.slice(0, 12),
  };
}

const app = express();
app.use(express.json({ limit: "5mb" }));
registerApi(app);
registerEditorApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "web", "dist", "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
const fixture = path.join(os.tmpdir(), `folio-v3-alpha-${Date.now()}.png`);
await fs.writeFile(fixture, alphaPng);

console.log("\nFolio illustration V4 safety contour wrap");

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(35000);
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(base, { waitUntil: "networkidle0" });

  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample button missing");
    (button as HTMLButtonElement).click();
  });
  await page.waitForSelector('.rich-editor[contenteditable="true"]');

  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".rich-editor");
    const paragraphs = [...(editor?.querySelectorAll<HTMLElement>(":scope > p") ?? [])];
    const target = paragraphs.find((paragraph) => (paragraph.textContent?.trim().length ?? 0) > 180);
    if (!editor || !target) throw new Error("No long prose paragraph for contour insertion");
    const range = document.createRange();
    range.setStart(target, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  const response = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/illustration"));
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.click(".illustration-button")]);
  await chooser.accept([fixture]);
  if (!(await response).ok()) throw new Error("Contour fixture upload failed");

  await page.waitForFunction(() => {
    const figure = document.querySelector<HTMLElement>(".editor-illustration");
    const image = figure?.querySelector<HTMLImageElement>("img[data-folio-asset]");
    return Boolean(
      figure?.dataset.folioShape === "contour" &&
      figure.dataset.folioWrap === "none" &&
      figure.dataset.folioGap === "45" &&
      image?.complete && image.naturalWidth > 20
    );
  }, { timeout: 12000 });
  check("PNG defaults to contour metadata without forcing text wrap", true);

  await page.evaluate(() => {
    const image = document.querySelector<HTMLImageElement>(".editor-illustration img[data-folio-asset]");
    if (!image) throw new Error("Contour illustration image missing after hydration");
    image.click();
  });
  await page.waitForFunction(() => document.querySelector('.folio-illustration-overlay .folio-image-inspector[data-open="true"]'));
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('.folio-illustration-overlay [data-folio-wrap-choice="right"]');
    if (!button) throw new Error("Contour wrap-right control missing after selection");
    button.click();
  });
  await page.waitForFunction(() => document.querySelector<HTMLElement>(".editor-illustration")?.dataset.folioWrap === "right");

  const contourMarkdown = await page.waitForFunction(() => {
    const markdown = document.querySelector<HTMLElement>(".rich-editor")?.dataset.markdown ?? "";
    return markdown.includes(".folio-shape-contour") && markdown.includes("data-folio-gap=45")
      ? markdown
      : false;
  }, { timeout: 12000 }).then((handle) => handle.jsonValue() as Promise<string>);
  check("contour state is serialized into manuscript Markdown",
    contourMarkdown.includes(".folio-shape-contour") && contourMarkdown.includes("data-folio-gap=45"),
    contourMarkdown.slice(0, 420));

  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('.folio-illustration-overlay [data-folio-wrap-choice="left"]');
    if (!button) throw new Error("Contour wrap-left control missing after selection");
    button.click();
  });
  await page.$eval<HTMLInputElement>('.folio-illustration-overlay [data-folio-control="scale"]', (input) => {
    input.value = "55";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await page.waitForFunction(() => {
    const figure = document.querySelector<HTMLElement>(".editor-illustration");
    return Boolean(figure && getComputedStyle(figure).shapeOutside.includes("polygon("));
  });

  const editorGeometry = await page.evaluate(() => {
    const figure = document.querySelector<HTMLElement>(".editor-illustration.folio-wrap-left");
    if (!figure) return null;
    let paragraph = figure.nextElementSibling as HTMLElement | null;
    while (paragraph && (paragraph.tagName !== "P" || (paragraph.textContent?.trim().length ?? 0) < 120)) paragraph = paragraph.nextElementSibling as HTMLElement | null;
    if (!paragraph) return null;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const fr = figure.getBoundingClientRect();
    const rects = [...range.getClientRects()].filter((r) => r.height > 4 && r.top < fr.bottom - 3 && r.bottom > fr.top + 3);
    const lefts = rects.map((r) => r.left);
    return {
      shape: getComputedStyle(figure).shapeOutside,
      figure: fr.toJSON(),
      lefts,
      spread: lefts.length ? Math.max(...lefts) - Math.min(...lefts) : 0,
      intrudes: lefts.some((left) => left < fr.right - 8),
    };
  });
  const editorContour = Boolean(editorGeometry && editorGeometry.shape.includes("polygon(") && editorGeometry.spread > 18 && editorGeometry.intrudes);
  check("editor text follows PNG alpha contour instead of a rectangle", editorContour, JSON.stringify(editorGeometry));
  if (!editorContour) throw new Error("Editor contour geometry stayed rectangular.");

  await page.waitForFunction(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const figure = doc?.querySelector<HTMLElement>(".folio-illustration-block.folio-shape-contour.folio-wrap-left");
    const image = figure?.querySelector<HTMLImageElement>("img.folio-illustration");
    if (!doc || !figure || !image?.complete || image.naturalWidth < 50) return false;
    if (!getComputedStyle(figure).shapeOutside.includes("polygon(")) return false;
    let paragraph = figure.nextElementSibling as HTMLElement | null;
    while (paragraph && (paragraph.tagName !== "P" || (paragraph.textContent?.trim().length ?? 0) < 120)) paragraph = paragraph.nextElementSibling as HTMLElement | null;
    if (!paragraph) return false;
    const range = doc.createRange();
    range.selectNodeContents(paragraph);
    const fr = figure.getBoundingClientRect();
    const rects = [...range.getClientRects()].filter((line) =>
      line.width > 2 &&
      line.bottom > fr.top + 1 &&
      line.top < fr.bottom - 1
    );
    return rects.length >= 3;
  }, { timeout: 30000 });

  const readerGeometry = await page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const figure = doc?.querySelector<HTMLElement>(".folio-illustration-block.folio-shape-contour.folio-wrap-left");
    if (!doc || !figure) return null;
    let paragraph = figure.nextElementSibling as HTMLElement | null;
    while (paragraph && (paragraph.tagName !== "P" || (paragraph.textContent?.trim().length ?? 0) < 120)) paragraph = paragraph.nextElementSibling as HTMLElement | null;
    if (!paragraph) return null;
    const range = doc.createRange();
    range.selectNodeContents(paragraph);
    const fr = figure.getBoundingClientRect();
    const rects = [...range.getClientRects()].filter((r) => r.height > 4 && r.top < fr.bottom - 3 && r.bottom > fr.top + 3);
    const lefts = rects.map((r) => r.left);
    return {
      shape: getComputedStyle(figure).shapeOutside,
      lefts,
      spread: lefts.length ? Math.max(...lefts) - Math.min(...lefts) : 0,
      intrudes: lefts.some((left) => left < fr.right - 6),
    };
  });
  const readerContour = Boolean(readerGeometry && readerGeometry.shape.includes("polygon(") && readerGeometry.spread > 10);
  check("Reader Preview preserves non-rectangular contour geometry", readerContour, JSON.stringify(readerGeometry));
  if (!readerContour) throw new Error("Reader Preview contour geometry stayed rectangular.");

  const qaDir = path.join(ROOT, "build", "qa-illustrations-v3");
  await fs.mkdir(qaDir, { recursive: true });
  await page.screenshot({ path: path.join(qaDir, "contour-reader.png"), fullPage: false });

  await page.select('select[aria-label="Preview device"]', "print");
  await page.waitForFunction(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const figure = doc?.querySelector<HTMLElement>(".pagedjs_page .folio-illustration-block.folio-shape-contour.folio-wrap-left");
    return Boolean(figure && getComputedStyle(figure).shapeOutside.includes("polygon("));
  }, { timeout: 45000 });
  check("Print Preview receives resolved alpha shape-outside", true);

  const printShape = await page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const figure = doc?.querySelector<HTMLElement>(".pagedjs_page .folio-illustration-block.folio-shape-contour.folio-wrap-left");
    if (!doc || !figure) return null;
    let paragraph = figure.nextElementSibling as HTMLElement | null;
    while (paragraph && (paragraph.tagName !== "P" || (paragraph.textContent?.trim().length ?? 0) < 120)) paragraph = paragraph.nextElementSibling as HTMLElement | null;
    const result: {
      shape: string;
      gap: string;
      printWrap: string | null;
      spread: number | null;
      lefts: number[];
    } = {
      shape: getComputedStyle(figure).shapeOutside,
      gap: getComputedStyle(figure).shapeMargin,
      printWrap: figure.dataset.folioPrintWrap ?? null,
      spread: null,
      lefts: [],
    };
    if (!paragraph) return result;
    const range = doc.createRange();
    range.selectNodeContents(paragraph);
    const fr = figure.getBoundingClientRect();
    const rects = [...range.getClientRects()].filter((line) =>
      line.width > 2 &&
      line.bottom > fr.top + 1 &&
      line.top < fr.bottom - 1
    );
    result.lefts = rects.map((line) => line.left);
    result.spread = result.lefts.length ? Math.max(...result.lefts) - Math.min(...result.lefts) : 0;
    return result;
  });
  check("Print contour bakes safety gap into the polygon", Boolean(printShape?.shape.includes("polygon(") && printShape.gap === "0px"), JSON.stringify(printShape));
  const printContour = Boolean(
    printShape &&
    printShape.printWrap !== "block-fallback" &&
    printShape.shape.includes("polygon(") &&
    (printShape.spread ?? 0) > 8
  );
  check("Paged Print lines visibly follow the alpha contour", printContour, JSON.stringify(printShape));
  if (!printContour) throw new Error("Paged Print contour geometry stayed rectangular or degraded.");

  const previewFrame = await (await page.$(".preview-frame"))?.contentFrame();
  const contourPage = await previewFrame?.$(".pagedjs_page:has(.folio-illustration-block.folio-shape-contour)");
  if (contourPage) await contourPage.screenshot({ path: path.join(qaDir, "contour-print-page.png") });
  await page.screenshot({ path: path.join(qaDir, "contour-print.png"), fullPage: false });

  await page.close();
} catch (error) {
  failed++;
  console.error("✗ illustration V4 contour scenario completed");
  console.error(error);
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(fixture, { force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

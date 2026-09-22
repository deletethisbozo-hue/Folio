import express from "express";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";
import { contourAlphaPng } from "./fixtures/contour-alpha.ts";

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
const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
const fixture = path.join(os.tmpdir(), `folio-v5-stability-${Date.now()}.png`);
await fs.writeFile(fixture, contourAlphaPng);

console.log("\nFolio illustration V5 stability");

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);
  await page.setViewport({ width: 1440, height: 900 });

  let printRequests = 0;
  page.on("request", (request) => {
    try {
      if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/preview-print")) printRequests++;
    } catch { /* ignore */ }
  });

  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample button missing");
    (button as HTMLButtonElement).click();
  });
  await page.waitForSelector('.rich-editor[contenteditable="true"]');

  const before = await page.$eval(".rich-editor", (editor) => {
    const el = editor as HTMLElement;
    return {
      markdown: el.dataset.markdown ?? "",
      paragraphs: [...el.querySelectorAll(":scope > p")].map((p) => p.textContent ?? ""),
      breaks: el.querySelectorAll(":scope > .editor-scene-break").length,
    };
  });

  const targetIndex = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".rich-editor");
    const paragraphs = [...(editor?.querySelectorAll<HTMLElement>(":scope > p") ?? [])];
    const index = paragraphs.findIndex((p) => (p.textContent?.trim().length ?? 0) > 180);
    if (!editor || index < 0) throw new Error("No long paragraph for insertion stability test");
    const target = paragraphs[index];
    const text = [...target.childNodes].find((node) => node.nodeType === Node.TEXT_NODE) ?? target.firstChild;
    const range = document.createRange();
    if (text?.nodeType === Node.TEXT_NODE) range.setStart(text, Math.min(24, text.textContent?.length ?? 0));
    else range.setStart(target, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return index;
  });

  const upload = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/illustration"),
  );
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.click(".illustration-button")]);
  await chooser.accept([fixture]);
  if (!(await upload).ok()) throw new Error("V5 illustration upload failed");

  await page.waitForFunction(() => {
    const figure = document.querySelector<HTMLElement>(".editor-illustration");
    const image = figure?.querySelector<HTMLImageElement>("img[data-folio-asset]");
    return Boolean(figure && image?.complete && image.naturalWidth > 20);
  });

  const insertion = await page.$eval(".rich-editor", (editor, index) => {
    const el = editor as HTMLElement;
    const children = [...el.children];
    const figureIndex = children.findIndex((child) => child.classList.contains("editor-illustration"));
    const paragraphNodes = children.filter((child) => child.tagName === "P");
    const target = paragraphNodes[index as number];
    return {
      markdown: el.dataset.markdown ?? "",
      breaks: el.querySelectorAll(":scope > .editor-scene-break").length,
      figurePreviousText: children[figureIndex - 1]?.textContent ?? "",
      targetText: target?.textContent ?? "",
      gap: (children[figureIndex] as HTMLElement | undefined)?.dataset.folioGap ?? null,
    };
  }, targetIndex);

  check("insertion preserves manuscript order and structural breaks",
    before.breaks === insertion.breaks &&
      insertion.figurePreviousText === insertion.targetText &&
      before.paragraphs[targetIndex] === insertion.targetText,
    JSON.stringify({ beforeBreaks: before.breaks, afterBreaks: insertion.breaks, targetIndex }));
  check("new contour illustrations use a tighter professional default gap",
    insertion.gap === "45",
    JSON.stringify({ gap: insertion.gap }));

  await page.evaluate(() => {
    const image = document.querySelector<HTMLImageElement>(".editor-illustration img[data-folio-asset]");
    if (!image) throw new Error("Inserted image missing");
    image.click();
  });
  await page.waitForSelector(".folio-illustration-overlay .folio-image-inspector[data-open="true"]");

  // Small image: controls must stay independent of the figure's own box.
  await page.$eval<HTMLInputElement>('.folio-illustration-overlay [data-folio-control="scale"]', (input) => {
    input.value = "25";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector<HTMLElement>(".editor-illustration")?.dataset.folioScale === "25");

  const inspector = await page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>(".folio-illustration-overlay .folio-image-inspector[data-open="true"]");
    const gap = toolbar?.querySelector<HTMLElement>('[data-folio-control="gap"]');
    if (!toolbar || !gap) return null;
    const r = toolbar.getBoundingClientRect();
    const g = gap.getBoundingClientRect();
    const editorRect = document.querySelector<HTMLElement>(".rich-editor")?.getBoundingClientRect();
    const cx = Math.max(0, Math.min(innerWidth - 1, r.left + r.width / 2));
    const cy = Math.max(0, Math.min(innerHeight - 1, r.top + r.height / 2));
    const hit = document.elementFromPoint(cx, cy);
    return {
      toolbar: r.toJSON(),
      gap: g.toJSON(),
      viewport: { width: innerWidth, height: innerHeight },
      editorRight: editorRect?.right ?? null,
      position: getComputedStyle(toolbar).position,
      parentClass: toolbar.parentElement?.className ?? "",
      parentIsFigure: Boolean(toolbar.closest(".editor-illustration")),
      hitToolbar: Boolean(hit?.closest(".folio-image-inspector") === toolbar),
      zIndex: getComputedStyle(toolbar.parentElement as HTMLElement).zIndex,
    };
  });
  const inspectorVisible = Boolean(inspector &&
    inspector.position === "fixed" &&
    inspector.toolbar.left >= 0 &&
    inspector.toolbar.top >= 0 &&
    inspector.toolbar.right <= inspector.viewport.width + 1 &&
    inspector.toolbar.bottom <= inspector.viewport.height + 1 &&
    (inspector.editorRight == null || inspector.toolbar.right <= inspector.editorRight + 1) &&
    inspector.gap.width > 20 && inspector.gap.height > 5 &&
    inspector.parentClass.includes("folio-illustration-overlay") &&
    !inspector.parentIsFigure &&
    inspector.hitToolbar);
  check("small illustrations keep the full inspector above preview and Gap control visible", inspectorVisible, JSON.stringify(inspector));
  if (!inspectorVisible) throw new Error("Inspector escaped the viewport for a small illustration.");

  // Range input should be visually live but commit only when the user releases it.
  const markdownBeforeSlider = await page.$eval(".rich-editor", (editor) => (editor as HTMLElement).dataset.markdown ?? "");
  await page.$eval<HTMLInputElement>('.folio-illustration-overlay [data-folio-control="scale"]', (input) => {
    input.value = "37";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const duringSlider = await page.$eval(".rich-editor", (editor) => ({
    markdown: (editor as HTMLElement).dataset.markdown ?? "",
    scale: document.querySelector<HTMLElement>(".editor-illustration")?.dataset.folioScale ?? null,
  }));
  check("slider movement is local and does not commit every pixel",
    duringSlider.markdown === markdownBeforeSlider && duringSlider.scale === "37",
    JSON.stringify({ beforeLength: markdownBeforeSlider.length, during: duringSlider }));

  await page.$eval<HTMLInputElement>('.folio-illustration-overlay [data-folio-control="scale"]', (input) => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(() => (document.querySelector<HTMLElement>(".rich-editor")?.dataset.markdown ?? "").includes("width=37%"));

  // Right-side contour at the largest allowed wrapped size must not cover prose.
  await page.evaluate(() => {
    const right = document.querySelector<HTMLButtonElement>('.folio-illustration-overlay [data-folio-wrap-choice="right"]');
    if (!right) throw new Error("Right wrap button missing");
    right.click();
  });
  await page.$eval<HTMLInputElement>('.folio-illustration-overlay [data-folio-control="scale"]', (input) => {
    input.value = "60";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const figure = document.querySelector<HTMLElement>(".editor-illustration.folio-wrap-right.folio-shape-contour");
    return figure?.dataset.folioScale === "60" && figure.dataset.folioContourReady === "true";
  });

  const rightClearance = await page.evaluate(() => {
    const figure = document.querySelector<HTMLElement>(".editor-illustration.folio-wrap-right.folio-shape-contour");
    const image = figure?.querySelector<HTMLImageElement>("img[data-folio-asset]");
    if (!figure || !image || !image.complete) return null;
    let paragraph = figure.nextElementSibling as HTMLElement | null;
    while (paragraph && (paragraph.tagName !== "P" || (paragraph.textContent?.trim().length ?? 0) < 120)) paragraph = paragraph.nextElementSibling as HTMLElement | null;
    if (!paragraph) return null;

    const canvas = document.createElement("canvas");
    canvas.width = Math.min(360, image.naturalWidth);
    canvas.height = Math.max(1, Math.round(image.naturalHeight * canvas.width / image.naturalWidth));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const ir = image.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const lines = [...range.getClientRects()].filter((line) => line.width > 4 && line.bottom > ir.top + 1 && line.top < ir.bottom - 1);
    const clearances: number[] = [];

    for (const line of lines) {
      let inkLeft = Number.POSITIVE_INFINITY;
      for (const sy of [line.top + 2, line.top + line.height / 2, line.bottom - 2]) {
        const yf = (sy - ir.top) / Math.max(1, ir.height);
        if (yf < 0 || yf > 1) continue;
        const y = Math.max(0, Math.min(canvas.height - 1, Math.round(yf * (canvas.height - 1))));
        let first = -1;
        for (let x = 0; x < canvas.width; x++) {
          if (px[(y * canvas.width + x) * 4 + 3] >= 28) { first = x; break; }
        }
        if (first >= 0) inkLeft = Math.min(inkLeft, ir.left + first / Math.max(1, canvas.width - 1) * ir.width);
      }
      if (Number.isFinite(inkLeft)) clearances.push(inkLeft - line.right);
    }
    return {
      measured: clearances.length,
      minimum: clearances.length ? Math.min(...clearances) : null,
      scale: figure.dataset.folioScale,
      shape: getComputedStyle(figure).shapeOutside,
      clearances: clearances.slice(0, 14),
    };
  });
  check("large right-wrap illustration never covers editor prose",
    Boolean(rightClearance && rightClearance.measured >= 2 && (rightClearance.minimum ?? -99) >= 3),
    JSON.stringify(rightClearance));
  if (!rightClearance || (rightClearance.minimum ?? -99) < 3) throw new Error("Right wrap overlaps prose.");

  // Print should render once for the committed state, not once per slider pixel.
  await page.select('select[aria-label="Preview device"]', "print");
  await page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/preview-print"),
    { timeout: 45000 },
  );
  const baselinePrintRequests = printRequests;

  await page.$eval<HTMLInputElement>('.folio-illustration-overlay [data-folio-control="gap"]', (input) => {
    for (const value of ["40","42","44","46","48","50","52","54"]) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 900));
  check("dragging a control does not queue Print renders",
    printRequests === baselinePrintRequests,
    JSON.stringify({ baselinePrintRequests, printRequests }));

  await page.$eval<HTMLInputElement>('.folio-illustration-overlay [data-folio-control="gap"]', (input) => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/preview-print"),
    { timeout: 45000 },
  );
  check("releasing the control schedules one Print refresh",
    printRequests === baselinePrintRequests + 1,
    JSON.stringify({ baselinePrintRequests, printRequests }));

  await page.close();
} catch (error) {
  failed++;
  console.error("✗ illustration V5 stability scenario completed");
  console.error(error);
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(fixture, { force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

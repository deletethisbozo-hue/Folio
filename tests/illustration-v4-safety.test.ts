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
const fixture = path.join(os.tmpdir(), `folio-v4-safety-${Date.now()}.png`);
await fs.writeFile(fixture, contourAlphaPng);

console.log("\nFolio illustration V4 physical contour clearance");

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);
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
    if (!editor || !target) throw new Error("No long paragraph for contour test");
    const range = document.createRange();
    range.setStart(target, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  const response = page.waitForResponse((res) =>
    res.request().method() === "POST" && new URL(res.url()).pathname.endsWith("/illustration"),
  );
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.click(".illustration-button")]);
  await chooser.accept([fixture]);
  if (!(await response).ok()) throw new Error("Safety fixture upload failed");

  await page.evaluate(() => {
    const image = document.querySelector<HTMLImageElement>(".editor-illustration img[data-folio-asset]");
    if (!image) throw new Error("Inserted illustration missing");
    image.click();
  });
  await page.waitForSelector(".editor-illustration.folio-image-selected .folio-image-inspector");
  await page.evaluate(() => {
    const left = document.querySelector<HTMLButtonElement>('.editor-illustration [data-folio-wrap-choice="left"]');
    if (!left) throw new Error("Left wrap control missing");
    left.click();
  });
  await page.$eval<HTMLInputElement>('.editor-illustration [data-folio-control="scale"]', (input) => {
    input.value = "55";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await page.waitForFunction(() => {
    const figure = document.querySelector<HTMLElement>(".editor-illustration.folio-wrap-left.folio-shape-contour");
    return figure?.dataset.folioContourReady === "true" &&
      getComputedStyle(figure).shapeOutside.includes("polygon(");
  });

  const measure = async (scope: "editor" | "reader" | "print") => page.evaluate((mode) => {
    const doc = mode === "editor"
      ? document
      : document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument ?? null;
    if (!doc) return null;

    const selector = mode === "editor"
      ? ".editor-illustration.folio-wrap-left.folio-shape-contour"
      : mode === "print"
        ? ".pagedjs_page .folio-illustration-block.folio-wrap-left.folio-shape-contour"
        : ".folio-illustration-block.folio-wrap-left.folio-shape-contour";
    const figure = doc.querySelector<HTMLElement>(selector);
    const image = figure?.querySelector<HTMLImageElement>("img[data-folio-asset],img.folio-illustration,img");
    if (!figure || !image || !image.complete || image.naturalWidth < 2 || image.naturalHeight < 2) return null;

    let paragraph = figure.nextElementSibling as HTMLElement | null;
    while (paragraph && (paragraph.tagName !== "P" || (paragraph.textContent?.trim().length ?? 0) < 120)) {
      paragraph = paragraph.nextElementSibling as HTMLElement | null;
    }
    if (!paragraph) return null;

    const canvas = doc.createElement("canvas");
    canvas.width = Math.min(480, image.naturalWidth);
    canvas.height = Math.max(1, Math.round(image.naturalHeight * canvas.width / image.naturalWidth));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const imageRect = image.getBoundingClientRect();

    const range = doc.createRange();
    range.selectNodeContents(paragraph);
    const lines = [...range.getClientRects()].filter((rect) =>
      rect.width > 3 &&
      rect.bottom > imageRect.top + 1 &&
      rect.top < imageRect.bottom - 1
    );

    const clearances: number[] = [];
    for (const line of lines) {
      let inkRight = Number.NEGATIVE_INFINITY;
      const ys = [
        line.top + Math.min(2, line.height * .2),
        line.top + line.height * .5,
        line.bottom - Math.min(2, line.height * .2),
      ];
      for (const screenY of ys) {
        const yFraction = (screenY - imageRect.top) / Math.max(1, imageRect.height);
        if (yFraction < 0 || yFraction > 1) continue;
        const y = Math.max(0, Math.min(canvas.height - 1, Math.round(yFraction * (canvas.height - 1))));
        let last = -1;
        for (let x = 0; x < canvas.width; x++) {
          if (pixels[(y * canvas.width + x) * 4 + 3] >= 28) last = x;
        }
        if (last >= 0) {
          const screenX = imageRect.left + last / Math.max(1, canvas.width - 1) * imageRect.width;
          inkRight = Math.max(inkRight, screenX);
        }
      }
      if (Number.isFinite(inkRight)) clearances.push(line.left - inkRight);
    }

    return {
      shape: getComputedStyle(figure).shapeOutside,
      shapeMargin: getComputedStyle(figure).shapeMargin,
      ready: figure.dataset.folioContourReady ?? null,
      contourPoints: figure.dataset.folioContourPoints ?? null,
      measuredLines: clearances.length,
      minimumClearance: clearances.length ? Math.min(...clearances) : null,
      clearances: clearances.slice(0, 16),
      image: imageRect.toJSON(),
    };
  }, scope);


  const measureStable = async (
    scope: "editor" | "reader" | "print",
    minimumLines: number,
    minimumClearance: number,
  ) => {
    let latest: Awaited<ReturnType<typeof measure>> = null;
    for (let attempt = 0; attempt < 120; attempt++) {
      latest = await measure(scope);
      if (
        latest &&
        latest.shape.includes("polygon(") &&
        latest.ready === "true" &&
        latest.measuredLines >= minimumLines &&
        (latest.minimumClearance ?? Number.NEGATIVE_INFINITY) >= minimumClearance
      ) return latest;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return latest;
  };

  const editor = await measureStable("editor", 2, 4);
  check("editor uses Folio safety polygon instead of raw alpha URL",
    Boolean(editor?.shape.includes("polygon(") && editor.ready === "true" && Number(editor.contourPoints) >= 20),
    JSON.stringify(editor));
  check("editor prose never touches opaque PNG pixels",
    Boolean(editor && editor.measuredLines >= 2 && (editor.minimumClearance ?? -99) >= 4),
    JSON.stringify(editor));
  if (!editor || editor.measuredLines < 2 || (editor.minimumClearance ?? -99) < 4) {
    throw new Error("Editor contour safety clearance failed.");
  }

  await page.waitForFunction(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const figure = doc?.querySelector<HTMLElement>(".folio-illustration-block.folio-wrap-left.folio-shape-contour");
    return figure?.dataset.folioContourReady === "true" &&
      getComputedStyle(figure).shapeOutside.includes("polygon(");
  });

  const reader = await measureStable("reader", 2, 3);
  check("Reader Preview uses the same safety polygon model",
    Boolean(reader?.shape.includes("polygon(") && reader.ready === "true"),
    JSON.stringify(reader));
  check("Reader Preview keeps physical clearance from opaque pixels",
    Boolean(reader && reader.measuredLines >= 2 && (reader.minimumClearance ?? -99) >= 3),
    JSON.stringify(reader));
  if (!reader || reader.measuredLines < 2 || (reader.minimumClearance ?? -99) < 3) {
    throw new Error("Reader contour safety clearance failed.");
  }

  const qaDir = path.join(ROOT, "build", "qa-illustrations-v4");
  await fs.mkdir(qaDir, { recursive: true });
  await page.screenshot({ path: path.join(qaDir, "safety-reader.png"), fullPage: false });

  await page.select('select[aria-label="Preview device"]', "print");
  await page.waitForFunction(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const figure = doc?.querySelector<HTMLElement>(".pagedjs_page .folio-illustration-block.folio-wrap-left.folio-shape-contour");
    return figure?.dataset.folioContourReady === "true" &&
      getComputedStyle(figure).shapeOutside.includes("polygon(");
  }, { timeout: 45000 });

  const print = await measureStable("print", 2, 2.5);
  check("Paged Print retains Folio-computed safety polygon",
    Boolean(print?.shape.includes("polygon(") && print.ready === "true"),
    JSON.stringify(print));
  check("Paged Print keeps physical clearance from opaque pixels",
    Boolean(print && print.measuredLines >= 2 && (print.minimumClearance ?? -99) >= 2.5),
    JSON.stringify(print));
  if (!print || print.measuredLines < 2 || (print.minimumClearance ?? -99) < 2.5) {
    throw new Error("Print contour safety clearance failed.");
  }

  const frame = await (await page.$(".preview-frame"))?.contentFrame();
  const contourPage = await frame?.$(".pagedjs_page:has(.folio-illustration-block.folio-shape-contour)");
  if (contourPage) await contourPage.screenshot({ path: path.join(qaDir, "safety-print-page.png") });

  await page.close();
} catch (error) {
  failed++;
  console.error("✗ illustration V4 physical safety scenario completed");
  console.error(error);
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(fixture, { force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

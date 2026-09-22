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
const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;

const fixture = path.join(os.tmpdir(), `folio-illustration-v2-${Date.now()}.png`);
const imageBuffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAPAAAAFACAIAAAANimYEAAAFjUlEQVR42u3d0W6bWhCGUbLF+79yehGprepCMA54zz9rXZ4eNTZ8GQ9pjD8+Pz8XSDEcAgQNggZBg6ARNAgaZrNu/cHHx4ejw7S2/v3EhMbKAYKGd+7QR/YVuNOR6zoTGisHCBoEDYJG0CBoEDQIGgSNoEHQIGgQNAgaQYOgQdAgaBA0ggZBg6BB0CBoBA2CBkGDoEHQCBoEDYIGQYOgETQIGgQNgkbQIGgQNFxtdQh+1pGP7/2HT54WdOF8j/wlEhd0pYKf/Sr6FnTJjr/96soWdOGOlS3o93d8IrUTX07Zgr6krR/p6fEvOf4wvv5PWQv6fMo31PP3lzjywGQt6OdSfmMrx+OWdfegJ09568HIWtBPpzxzEL8f286zaJv1UPNjLlU6+PahzvZjRxP67pQrPqn9PaTbqB5qrjWVzz2FPqN6lXLSM92Z1k1G9Whbc8BUPjGt40f1aFtz/Hdyz6ZXKcc3/XgogtePoWajWtBq1rSg31dz8PXf61eKYU2PDjUv7B6NpKaHmjWd1PRQs6aTmh5q1nRS00PNmk5qeqhZ00lNDzVrOqnpEX9uaHXcqgbtfnBXN110SA81k9T0UDNJTbvhOVGKBW08G9I5QatZ08krh5od28JBN7xniuMfG7Rlw+KRvHKo2XEuHLRlw7lIntDGs6NdOGjj2RlJntDGs2NeOGjj2XlJntDGsyNfOGjj2ZBOntDGs+NfOGjj2ZBOntDGs7MQeFEIJYO2b9g6kie0fcO5sHJg5ZjyVcx4nnxIz7Z1mNCY0CDoolfN1DprU09oC7TzYuXAygGCBkE/cW1hgS60Rs9zXWhCY0KDoEHQIGgE/XZ+xFHOnD/oMKExoUHQIGgQNIIGQYOgQdAgaAQNggZBg6BB0AgaBP2ayW/SyqM535NhQmNCg6BB0CBoBD0DP+goZNrbTpjQmNAgaOgetDXaeakdtFvaVTTVWbNyYOUAQZ97/bJGT75Az7YlmtCY0K6pjWdBF71qptaZsnJg5fBKZ98QtK3DvmFCG9KOf0rQhrTxHH5RaEg78rWDNqSdl+QJbUg75uWDNqSdkeQJbUg72uWDNqSdi+QJbUg7zuWDfhwMmr6/5hIvlWUmtMXD8Y9dOQxpxzYhaIuHZSNtQmtazbErByQEbUgbz2kTWtNqTls5NK3m/B1a045b4aD/O0I0/SM11/1nrNoTWtNqTls5NK3mtB1a02pOuyjUtJqjgta0mtOC1rSal7zf5dhqWtZbByHsF80Dfzlp6wx1bnrruee9bSLzt+003bPmZVnW1LP4dbYez+XXf2nyhq5WKSdPaKO6Z81Lh1/w32k6Neudpxb/0rQuDWytH3kbyM63aJMtq9FbsHbOaMC03n8KfW4CsS6d7IzqutN6/1ux2/1MOr5Jdv8cF5rW3z7UhnfnWZeW9kf13380YRNHvt/a3miqadAHs55tD5GyoH8y67cUc3z/cfs/QT+X9W1xP7vES1nQr2a9Vd6Jtl65BpWyoJ+o5ERq9/yERMeCvrtsHQta2ToW9FvbuqhvBQt6lh3gROLyFXSlxLmTG54jaBA0CBoEjaBB0CBoEDQIGkGDoEHQIGgQNIIGQYOgQdAgaAQNggZBg6BB0AgaBA2CBkGDoBE0CBoEDYIGQSNoEDQIGgSNoEHQIGi42oUfjXzRB7uT4aLPkDahsXKAoKH2Dn3RkgQmNIIGQYOgQdAgaAQNggZBg6BB0AgaBA2CBkGDoBE0CBoEDYKmvbXig3YLm9uUe6ezCY2VA6wcnV8HMaFB0AjaIUDQIGgQNAgaQYOgQdAgaBA0ggZBg6BB0CBoBA2CBkGDoEHQCBoEDYIGQYOgETQIGgQNLzp0O113zMeEBkGDoOHPeuzjHTChQdAgaBA0ggZBg6DhQr8Amvx42uEUms8AAAAASUVORK5CYII=", "base64");
await fs.writeFile(fixture, imageBuffer);

function geometryScript(containerSelector: string, figureSelector: string) {
  const root = document.querySelector<HTMLElement>(containerSelector);
  const figure = root?.querySelector<HTMLElement>(figureSelector);
  if (!root || !figure) return null;
  let paragraph = figure.nextElementSibling as HTMLElement | null;
  while (paragraph && paragraph.tagName !== "P") paragraph = paragraph.nextElementSibling as HTMLElement | null;
  if (!paragraph) return null;
  const textNode = [...paragraph.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 3);
  if (!textNode) return null;
  const range = document.createRange();
  const len = Math.min(14, textNode.textContent?.length ?? 0);
  range.setStart(textNode, 0);
  range.setEnd(textNode, len);
  const figureRect = figure.getBoundingClientRect();
  const firstLine = range.getBoundingClientRect();
  return {
    float: getComputedStyle(figure).float,
    figure: figureRect.toJSON(),
    firstLine: firstLine.toJSON(),
  };
}

console.log("\nFolio illustration V2 direct manipulation");

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(base, { waitUntil: "networkidle0" });

  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample button missing");
    (button as HTMLButtonElement).click();
  });
  await page.waitForSelector('.rich-editor[contenteditable="true"]');

  const before = await page.$eval(".rich-editor", (editor) => (editor as HTMLElement).dataset.markdown ?? "");
  const enabled = await page.$eval(".illustration-button", (button) => !(button as HTMLButtonElement).disabled);
  check("Image control is available in an ordinary chapter", enabled);

  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".rich-editor");
    const paragraphs = editor?.querySelectorAll("p");
    const target = paragraphs?.[Math.min(2, Math.max(0, (paragraphs?.length ?? 1) - 1))];
    if (!editor || !target) throw new Error("No paragraph available for V2 anchor");
    const text = [...target.childNodes].find((node) => node.nodeType === Node.TEXT_NODE) ?? target.firstChild;
    const range = document.createRange();
    if (text?.nodeType === Node.TEXT_NODE) range.setStart(text, Math.min(4, text.textContent?.length ?? 0));
    else range.setStart(target, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  const uploadResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/illustration"),
    { timeout: 12000 },
  );
  const [chooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 12000 }),
    page.click(".illustration-button"),
  ]);
  await chooser.accept([fixture]);
  if (!(await uploadResponse).ok()) throw new Error("V2 illustration upload failed");

  try {
    await page.waitForFunction(() => {
      const figure = document.querySelector<HTMLElement>(".editor-illustration");
      const image = figure?.querySelector<HTMLImageElement>("img[data-folio-asset]");
      const markdown = document.querySelector<HTMLElement>(".rich-editor")?.dataset.markdown ?? "";
      return Boolean(
        figure?.dataset.folioWrap === "right" &&
        figure?.dataset.folioScale === "42" &&
        image?.complete && image.naturalWidth >= 200 &&
        markdown.includes(".folio-wrap-right") &&
        markdown.includes("width=42%")
      );
    }, { timeout: 8000 });
  } catch (error) {
    const snapshot = await page.evaluate(() => {
      const figure = document.querySelector<HTMLElement>(".editor-illustration");
      const image = figure?.querySelector<HTMLImageElement>("img[data-folio-asset]");
      const editor = document.querySelector<HTMLElement>(".rich-editor");
      return {
        dataset: figure ? { ...figure.dataset } : null,
        figureHtml: figure?.outerHTML.slice(0, 2400) ?? null,
        markdown: editor?.dataset.markdown ?? null,
        image: image ? { complete: image.complete, naturalWidth: image.naturalWidth, src: image.src, asset: image.dataset.folioAsset } : null,
        inspector: Boolean(figure?.querySelector(".folio-image-inspector")),
        error: document.querySelector(".global-error")?.textContent ?? null,
      };
    });
    throw new Error(`${error instanceof Error ? error.message : String(error)}; insertionSnapshot=${JSON.stringify(snapshot)}`);
  }

  const afterInsert = await page.$eval(".rich-editor", (editor) => (editor as HTMLElement).dataset.markdown ?? "");
  check("insertion keeps the manuscript instead of replacing it",
    afterInsert.length > before.length && afterInsert.includes(before.slice(0, Math.min(160, before.length))),
    `before=${before.length}, after=${afterInsert.length}`);

  const imageBox = await page.$eval(".editor-illustration img[data-folio-asset]", (image) => {
    const r = image.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  await page.mouse.click(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height / 2);
  await page.waitForSelector(".editor-illustration.folio-image-selected .folio-image-inspector");
  check("clicking the artwork selects it and reveals a compact inspector", true);

  // V2 regression is explicitly rectangular. V3 PNGs default to contour and
  // are covered by illustration-v3-contour.test.ts.
  await page.click('.editor-illustration [data-folio-shape-choice="box"]');
  await page.waitForFunction(() => document.querySelector<HTMLElement>(".editor-illustration")?.dataset.folioShape === "box");

  const editorBox = await page.$eval(".rich-editor", (editor) => {
    const r = editor.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  const paragraphTarget = await page.$eval(".rich-editor", (editor) => {
    const paragraphs = [...editor.querySelectorAll<HTMLElement>(":scope > p")];
    const target = paragraphs[Math.min(2, Math.max(0, paragraphs.length - 1))];
    if (!target) throw new Error("No ordinary paragraph target for V2 drag");
    const r = target.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  });

  // Directly drag the artwork itself before an ordinary paragraph, not across a
  // scene break (scene breaks intentionally clear floats).
  await page.mouse.move(imageBox.x + imageBox.width / 2, imageBox.y + Math.min(60, imageBox.height / 2));
  await page.mouse.down();
  await page.mouse.move(editorBox.left + editorBox.width * 0.18, paragraphTarget.top + 2, { steps: 14 });
  await page.mouse.up();

  await page.waitForFunction(() => {
    const figure = document.querySelector<HTMLElement>(".editor-illustration");
    const markdown = document.querySelector<HTMLElement>(".rich-editor")?.dataset.markdown ?? "";
    return Boolean(
      figure?.dataset.folioWrap === "left" &&
      !figure.classList.contains("folio-image-dragging") &&
      markdown.includes(".folio-wrap-left")
    );
  }, { timeout: 15000 });
  check("dragging the image itself changes anchor and live wrap side", true);

  const editorGeometry = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".rich-editor");
    const figure = editor?.querySelector<HTMLElement>(".editor-illustration.folio-wrap-left");
    if (!editor || !figure) return null;
    let paragraph = figure.nextElementSibling as HTMLElement | null;
    while (paragraph && paragraph.tagName !== "P") paragraph = paragraph.nextElementSibling as HTMLElement | null;
    if (!paragraph) return null;
    const textNode = [...paragraph.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 3);
    if (!textNode) return null;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(14, textNode.textContent?.length ?? 0));
    const figureStyle = getComputedStyle(figure);
    const paragraphStyle = getComputedStyle(paragraph);
    return {
      figure: figure.getBoundingClientRect().toJSON(),
      firstLine: range.getBoundingClientRect().toJSON(),
      float: figureStyle.float,
      paragraph: paragraph.getBoundingClientRect().toJSON(),
      paragraphStyle: {
        clear: paragraphStyle.clear,
        display: paragraphStyle.display,
        overflow: paragraphStyle.overflow,
        position: paragraphStyle.position,
        contain: paragraphStyle.contain,
        width: paragraphStyle.width,
      },
      siblings: Array.from(editor.children).map((node) => ({
        tag: node.tagName,
        cls: (node as HTMLElement).className,
        top: (node as HTMLElement).getBoundingClientRect().top,
        bottom: (node as HTMLElement).getBoundingClientRect().bottom,
      })).slice(0, 12),
    };
  });
  const editorWraps = Boolean(
    editorGeometry &&
    editorGeometry.float === "left" &&
    editorGeometry.firstLine.top < editorGeometry.figure.bottom - 4 &&
    editorGeometry.firstLine.left >= editorGeometry.figure.right - 2
  );
  check("editor prose visibly reflows beside the dragged image", editorWraps, JSON.stringify(editorGeometry));
  if (!editorWraps) throw new Error("Editor did not visibly reflow around V2 illustration.");

  // V4 exposes a proper object-resize frame rather than one tiny corner dot.
  await page.waitForFunction(() =>
    document.querySelectorAll(".editor-illustration.folio-image-selected .folio-image-resize").length === 8
  );
  const resizeHandles = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".editor-illustration.folio-image-selected .folio-image-resize")].map((handle) => {
      const rect = handle.getBoundingClientRect();
      return {
        name: handle.dataset.folioResize,
        width: rect.width,
        height: rect.height,
        cursor: getComputedStyle(handle).cursor,
      };
    })
  );
  check("selected illustration exposes eight generous resize handles",
    resizeHandles.length === 8 &&
      resizeHandles.every((handle) => handle.width >= 18 && handle.height >= 18 && /resize/.test(handle.cursor)),
    JSON.stringify(resizeHandles));

  const beforeScale = await page.$eval(".editor-illustration", (figure) => Number((figure as HTMLElement).dataset.folioScale || 0));
  const eastHandle = await page.$eval(".editor-illustration.folio-image-selected .folio-image-resize-e", (handle) => {
    const rect = handle.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  const eastCenter = { x: eastHandle.x + eastHandle.width / 2, y: eastHandle.y + eastHandle.height / 2 };
  const eastHit = await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y) as HTMLElement | null;
    return {
      tag: hit?.tagName ?? null,
      cls: hit?.className ?? null,
      resize: hit?.closest<HTMLElement>(".folio-image-resize")?.dataset.folioResize ?? null,
    };
  }, eastCenter);
  await page.mouse.move(eastCenter.x, eastCenter.y);
  await page.mouse.down();
  const resizeDown = await page.evaluate(() => ({
    active: document.querySelector(".editor-illustration.folio-image-resizing") !== null,
    scale: Number(document.querySelector<HTMLElement>(".editor-illustration")?.dataset.folioScale || 0),
  }));
  await page.mouse.move(eastCenter.x + 47, eastCenter.y, { steps: 12 });
  const resizeMoved = await page.evaluate(() => {
    const figure = document.querySelector<HTMLElement>(".editor-illustration");
    return {
      active: document.querySelector(".editor-illustration.folio-image-resizing") !== null,
      scale: Number(figure?.dataset.folioScale || 0),
    };
  });
  await page.mouse.up();
  check("east resize handle receives the real pointer drag",
    eastHit.resize === "e" && resizeDown.active && resizeMoved.scale > beforeScale,
    JSON.stringify({ eastHit, resizeDown, resizeMoved, beforeScale }));
  if (!(eastHit.resize === "e" && resizeDown.active && resizeMoved.scale > beforeScale)) {
    throw new Error("East resize drag did not update illustration width.");
  }
  await page.waitForFunction((oldScale) => Number(document.querySelector<HTMLElement>(".editor-illustration")?.dataset.folioScale || 0) > oldScale, { timeout: 5000 }, beforeScale);

  const afterEdge = await page.$eval(".editor-illustration", (figure) => Number((figure as HTMLElement).dataset.folioScale || 0));
  const northHandle = await page.$eval(".editor-illustration.folio-image-selected .folio-image-resize-n", (handle) => {
    const rect = handle.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await page.mouse.move(northHandle.x + northHandle.width / 2, northHandle.y + northHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(northHandle.x + northHandle.width / 2, northHandle.y + northHandle.height / 2 - 24, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction((oldScale) => Number(document.querySelector<HTMLElement>(".editor-illustration")?.dataset.folioScale || 0) > oldScale, {}, afterEdge);

  const resized = await page.$eval(".editor-illustration", (figure) => ({
    scale: Number((figure as HTMLElement).dataset.folioScale || 0),
    markdown: (figure.closest(".rich-editor") as HTMLElement | null)?.dataset.markdown ?? "",
  }));
  const persistedWidth = resized.markdown.match(/width=(\d+(?:\.\d+)?)%/)?.[1];
  check("edge and vertical-handle drags resize smoothly and persist relative width",
    resized.scale > afterEdge &&
      persistedWidth !== undefined &&
      Math.abs(Number(persistedWidth) - resized.scale) < 0.11,
    JSON.stringify(resized));

  // Explicit positioning controls remain available, but are not required for moving the artwork.
  await page.click('.editor-illustration [data-folio-wrap-choice="right"]');
  await page.waitForFunction(() => document.querySelector<HTMLElement>(".editor-illustration")?.dataset.folioWrap === "right");
  await page.click('.editor-illustration [data-folio-wrap-choice="left"]');
  await page.waitForFunction(() => document.querySelector<HTMLElement>(".editor-illustration")?.dataset.folioWrap === "left");
  check("compact inspector can override wrap without moving the image", true);

  const readerGeometryHandle = await page.waitForFunction(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const figure = doc?.querySelector<HTMLElement>(".folio-illustration-block.folio-wrap-left");
    const image = figure?.querySelector<HTMLImageElement>("img.folio-illustration");
    if (!doc || !figure || !image?.complete || image.naturalWidth < 50) return false;
    let paragraph = figure.nextElementSibling as HTMLElement | null;
    while (paragraph && paragraph.tagName !== "P") paragraph = paragraph.nextElementSibling as HTMLElement | null;
    if (!paragraph) return false;
    const textNode = [...paragraph.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 3);
    if (!textNode) return false;
    const range = doc.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(14, textNode.textContent?.length ?? 0));
    const firstLine = range.getBoundingClientRect();
    const figureRect = figure.getBoundingClientRect();
    const geometry = {
      viewportWidth: doc.documentElement.clientWidth,
      float: getComputedStyle(figure).float,
      figure: figureRect.toJSON(),
      firstLine: firstLine.toJSON(),
    };
    return firstLine.width > 2 &&
      firstLine.top < figureRect.bottom - 4 &&
      firstLine.left >= figureRect.right - 2
      ? geometry
      : false;
  }, { timeout: 30000 });
  const readerGeometry = await readerGeometryHandle.jsonValue() as {
    viewportWidth: number;
    float: string;
    figure: DOMRect;
    firstLine: DOMRect;
  };

  const readerWraps = Boolean(
    readerGeometry &&
    readerGeometry.float === "left" &&
    readerGeometry.firstLine.top < readerGeometry.figure.bottom - 4 &&
    readerGeometry.firstLine.left >= readerGeometry.figure.right - 2
  );
  check("Reader Preview visibly reflows prose around the same illustration", readerWraps, JSON.stringify(readerGeometry));
  if (!readerWraps) throw new Error("Reader Preview did not visibly wrap V2 illustration.");

  const qaDir = path.join(ROOT, "build", "qa-illustrations-v2");
  await fs.mkdir(qaDir, { recursive: true });
  await page.screenshot({ path: path.join(qaDir, "editor-reader.png"), fullPage: false });

  await page.select('select[aria-label="Preview device"]', "print");
  await page.waitForFunction(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    return Boolean(doc?.querySelector(".pagedjs_page .folio-illustration-block.folio-wrap-left img.folio-illustration"));
  }, { timeout: 45000 });
  check("Print Preview preserves anchored wrap semantics", true);
  await page.screenshot({ path: path.join(qaDir, "print.png"), fullPage: false });

  await page.waitForFunction(() => document.querySelector(".save-indicator")?.textContent === "Saved", { timeout: 30000 });
  await page.click('.tiny-footer-button[aria-label="Reload files"]');
  await page.waitForFunction(() => {
    const editor = document.querySelector<HTMLElement>(".rich-editor");
    const markdown = editor?.dataset.markdown ?? "";
    return markdown.includes(".folio-wrap-left") && /width=\d+%/.test(markdown);
  }, { timeout: 30000 });
  await page.waitForFunction(() => {
    const figure = document.querySelector<HTMLElement>(".editor-illustration");
    return Boolean(figure?.dataset.folioWrap === "left" && Number(figure.dataset.folioScale || 0) > 0);
  }, { timeout: 30000 });
  check("anchor, wrap and relative size survive autosave plus reload", true);

  await page.close();
} catch (error) {
  failed++;
  console.error("✗ illustration V2 browser scenario completed");
  console.error(error);
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(fixture, { force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

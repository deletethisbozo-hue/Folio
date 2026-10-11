import express from "express";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { registerWriteStudioApi } from "../server/write-studio-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

const qa = path.join(ROOT, "build", "qa-v324-live");
await fs.mkdir(qa, { recursive: true });

const app = express();
app.use(express.json({ limit: "25mb" }));
registerApi(app);
registerEditorApi(app);
registerWriteStudioApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "web", "dist", "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(45_000);
  await page.setViewport({ width: 1536, height: 980, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle0" });

  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((node) => node.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample missing");
    button.click();
  });
  await page.waitForSelector('.folio-shell[data-workspace-mode="format"]');
  await page.waitForSelector('.rich-editor[contenteditable="true"]');
  await page.waitForFunction(() => Boolean(document.querySelector("iframe")?.contentDocument?.body));
  await page.waitForSelector(".preview-loading", { hidden: true }).catch(() => undefined);
  await settle(350);

  const format = await page.evaluate(() => {
    const title = document.querySelector<HTMLElement>(".section-titlebar")!;
    const wrap = document.querySelector<HTMLElement>(".section-title-wrap")!;
    const toolbar = document.querySelector<HTMLElement>(".format-toolbar")!;
    const paper = document.querySelector<HTMLElement>(".editor-paper")!;
    const titleRect = title.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    const paperRect = paper.getBoundingClientRect();
    return {
      titleHeight: titleRect.height,
      toolbarHeight: toolbarRect.height,
      titleTopGap: wrapRect.top - titleRect.top,
      titleBottomGap: titleRect.bottom - wrapRect.bottom,
      toolbarPaperGap: paperRect.top - toolbarRect.bottom,
    };
  });
  if (Math.abs(format.titleHeight - 40) > 1 || Math.abs(format.toolbarHeight - 36) > 1
      || Math.abs(format.toolbarPaperGap) > 1 || format.titleTopGap < 2 || format.titleBottomGap < 2) {
    throw new Error("Format chrome geometry failed: " + JSON.stringify(format));
  }
  await page.screenshot({ path: path.join(qa, "01-format-header-toolbar.png") });

  await page.click('[data-command="design"]');
  await page.waitForSelector(".style-library");
  await settle(250);
  const themeButton = await page.$eval(".style-open-theme-lab", (node) => {
    const el = node as HTMLElement;
    const rect = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    const text = range.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      dx: Math.abs((text.left + text.width / 2) - (rect.left + rect.width / 2)),
      dy: Math.abs((text.top + text.height / 2) - (rect.top + rect.height / 2)),
    };
  });
  if (Math.abs(themeButton.width - 104) > 1 || Math.abs(themeButton.height - 32) > 1 || themeButton.dx > 2 || themeButton.dy > 2) {
    throw new Error("Theme Lab button geometry failed: " + JSON.stringify(themeButton));
  }
  const filler = await page.$$eval(".theme-sample .sample-copy", (nodes) => nodes.map((n) => n.textContent?.trim()).filter(Boolean));
  if (filler.some((value) => value === "Write. Format. Publish.")) throw new Error("Theme cards still contain filler copy.");
  await page.screenshot({ path: path.join(qa, "02-theme-library.png") });
  await page.click(".style-library-close");
  await page.waitForFunction(() => !document.querySelector(".style-library"));

  const selectGeometry = await page.$eval('select[aria-label="Preview device"]', (node) => {
    const el = node as HTMLSelectElement;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return { width: rect.width, textAlign: style.textAlign, textAlignLast: style.textAlignLast };
  });
  if (selectGeometry.width < 110 || selectGeometry.textAlign !== "center" || selectGeometry.textAlignLast !== "center") {
    throw new Error("Device selector alignment failed: " + JSON.stringify(selectGeometry));
  }
  await page.screenshot({ path: path.join(qa, "03-device-toolbar.png") });

  const started = Date.now();
  await page.select('select[aria-label="Preview device"]', "print");
  await page.waitForFunction(() => {
    const frame = document.querySelector("iframe") as HTMLIFrameElement | null;
    const printed = frame?.contentDocument?.querySelector(".pagedjs_page") as HTMLElement | null;
    const rect = printed?.getBoundingClientRect();
    return Boolean(rect && rect.width > 120 && rect.height > 160);
  }, { timeout: 45_000 });
  const printOpenMs = Date.now() - started;
  const print = await page.evaluate(() => {
    const frame = document.querySelector("iframe") as HTMLIFrameElement | null;
    const printed = frame?.contentDocument?.querySelector(".pagedjs_page") as HTMLElement | null;
    const pages = frame?.contentDocument?.querySelector(".pagedjs_pages") as HTMLElement | null;
    const rect = printed?.getBoundingClientRect();
    return {
      pageWidth: rect?.width ?? 0,
      pageHeight: rect?.height ?? 0,
      frameWidth: frame?.clientWidth ?? 0,
      fitScale: frame?.dataset.folioPrintFitZoom ?? "",
      pagesZoom: pages ? getComputedStyle(pages).zoom : "",
      readout: document.querySelector(".preview-zoom-readout")?.textContent?.trim() ?? "",
    };
  });
  await page.screenshot({ path: path.join(qa, "04-print-fit.png") });
  if (printOpenMs > 18_000 || print.pageWidth <= 120 || print.pageWidth > print.frameWidth - 12) {
    throw new Error("Print fit/latency failed: " + JSON.stringify({ printOpenMs, ...print }));
  }

  const before = print.pageWidth;
  await page.click('button[aria-label="Zoom preview out"]');
  await page.waitForFunction((previous) => {
    const frame = document.querySelector("iframe") as HTMLIFrameElement | null;
    const printed = frame?.contentDocument?.querySelector(".pagedjs_page") as HTMLElement | null;
    return Boolean(printed && printed.getBoundingClientRect().width < previous - 8);
  }, {}, before);
  await settle(150);
  await page.screenshot({ path: path.join(qa, "05-print-zoom-out.png") });

  console.log(JSON.stringify({ ok: true, format, themeButton, selectGeometry, printOpenMs, print }, null, 2));
} finally {
  server.close();
  await closeBrowser();
}

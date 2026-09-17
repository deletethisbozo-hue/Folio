import express from "express";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

const qa = path.join(ROOT, "build", "qa-v207-controls");
await fs.mkdir(qa, { recursive: true });

const app = express();
app.use(express.json({ limit: "5mb" }));
registerApi(app);
registerEditorApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_request, response) => response.sendFile(path.join(ROOT, "web", "dist", "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(30_000);
  await page.setViewport({ width: 1536, height: 864, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle0" });

  await page.waitForSelector(".start-shell .start-brand");
  const startBrand = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".start-shell .start-brand");
    if (!el) throw new Error("Start-screen Folio wordmark is missing");
    const style = getComputedStyle(el);
    return {
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      lineHeight: style.lineHeight,
      text: (el.textContent ?? "").trim(),
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
    };
  });
  await page.screenshot({ path: path.join(qa, "start-wordmark.png") });

  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((node) => node.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample is missing");
    (button as HTMLButtonElement).click();
  });
  await page.waitForSelector(".folio-shell:not(.folio-empty-shell)");
  await page.waitForSelector(".contents-row.cover-row");
  await page.waitForSelector(".folio-shell .command-wordmark");

  const workspaceBrand = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".folio-shell .command-wordmark");
    if (!el) throw new Error("Workspace Folio wordmark is missing");
    const style = getComputedStyle(el);
    return {
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      lineHeight: style.lineHeight,
      text: (el.textContent ?? "").trim(),
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
    };
  });
  await page.screenshot({ path: path.join(qa, "workspace-wordmark.png") });

  for (const [name, brand] of [["start", startBrand], ["workspace", workspaceBrand]] as const) {
    if (brand.fontSize !== "27px") throw new Error(`${name} wordmark font-size is ${brand.fontSize}, expected 27px`);
    if (!/Folio Pelagiad Exact/i.test(brand.fontFamily)) throw new Error(`${name} wordmark is not Pelagiad: ${brand.fontFamily}`);
    if (brand.lineHeight !== "27px") throw new Error(`${name} wordmark line-height is ${brand.lineHeight}, expected 27px`);
    if (brand.text.toLowerCase() !== "folio") throw new Error(`${name} wordmark text is ${brand.text}`);
  }
  if (startBrand.fontSize !== workspaceBrand.fontSize || startBrand.lineHeight !== workspaceBrand.lineHeight) {
    throw new Error(`Folio wordmark jumps between screens: ${JSON.stringify({ startBrand, workspaceBrand })}`);
  }

  await page.click(".contents-row.cover-row");
  await page.waitForSelector(".cover-editor-card .cover-editor-art img");
  await page.waitForSelector(".cover-upload-button");

  const controls = await page.evaluate(() => {
    const replace = document.querySelector<HTMLElement>(".cover-upload-button");
    const exportButton = document.querySelector<HTMLElement>(".generate-button");
    if (!replace || !exportButton) throw new Error("Control buttons are missing");
    const replaceStyle = getComputedStyle(replace);
    const exportStyle = getComputedStyle(exportButton);
    return {
      replace: {
        height: replace.getBoundingClientRect().height,
        display: replaceStyle.display,
        alignItems: replaceStyle.alignItems,
        justifyContent: replaceStyle.justifyContent,
        fontFamily: replaceStyle.fontFamily,
        fontSize: replaceStyle.fontSize,
        borderRadius: replaceStyle.borderRadius,
        boxShadow: replaceStyle.boxShadow,
      },
      exportButton: {
        height: exportButton.getBoundingClientRect().height,
        display: exportStyle.display,
        alignItems: exportStyle.alignItems,
        justifyContent: exportStyle.justifyContent,
        fontFamily: exportStyle.fontFamily,
        fontSize: exportStyle.fontSize,
        borderRadius: exportStyle.borderRadius,
        boxShadow: exportStyle.boxShadow,
      },
    };
  });

  await page.screenshot({ path: path.join(qa, "cover-controls.png") });

  for (const [name, metrics] of Object.entries(controls)) {
    if (Math.abs(metrics.height - 28) > 0.6) throw new Error(`${name} height is ${metrics.height}, expected 28px`);
    if (!/^(?:inline-)?flex$/.test(metrics.display)) throw new Error(`${name} is not flex-based: ${metrics.display}`);
    if (metrics.alignItems !== "center" || metrics.justifyContent !== "center") {
      throw new Error(`${name} is not centered: ${JSON.stringify(metrics)}`);
    }
    if (!/Source Sans 3/i.test(metrics.fontFamily)) throw new Error(`${name} does not use Source Sans 3: ${metrics.fontFamily}`);
    if (metrics.borderRadius !== "2px") throw new Error(`${name} radius is ${metrics.borderRadius}, expected 2px`);
    if (metrics.boxShadow !== "none") throw new Error(`${name} unexpectedly has a shadow: ${metrics.boxShadow}`);
  }

  await page.click('[data-command="add"]');
  await page.waitForSelector('.content-image-input[type="file"]');
  const imageInput = await page.$('.content-image-input[type="file"]');
  if (!imageInput) throw new Error("Full-page image input is missing");
  await imageInput.uploadFile(path.join(ROOT, "samples", "clockwork-garden", "cover.png"));

  await page.waitForFunction(() => document.querySelector(".editor-pane")?.classList.contains("folio-image-page-mode"));
  await page.waitForFunction(() => {
    const selected = document.querySelector(".contents-list .contents-row.selected:not(.cover-row)");
    return (selected?.querySelector("span:last-child")?.textContent ?? "").trim() === "Full-page Image";
  });
  await page.waitForSelector(".preview-loading", { hidden: true });

  const imagePage = await page.evaluate(() => {
    const titleWrap = document.querySelector<HTMLElement>(".editor-pane .section-title-wrap");
    const selected = document.querySelector<HTMLElement>(".contents-list .contents-row.selected:not(.cover-row)");
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const visibleHeading = doc?.querySelector("main.book > section.image-page > h1, main.book > section.image-page > .chapter-title");
    return {
      titleDisplay: titleWrap ? getComputedStyle(titleWrap).display : "missing",
      selectedLabel: (selected?.querySelector("span:last-child")?.textContent ?? "").trim(),
      previewHeading: (visibleHeading?.textContent ?? "").trim(),
    };
  });

  await page.screenshot({ path: path.join(qa, "full-page-image-no-filename.png") });

  if (imagePage.titleDisplay !== "none") throw new Error(`Image-page title remains visible: ${imagePage.titleDisplay}`);
  if (imagePage.selectedLabel !== "Full-page Image") throw new Error(`Image-page label exposes a filename: ${imagePage.selectedLabel}`);
  if (imagePage.previewHeading) throw new Error(`Image-page preview exposes a title: ${imagePage.previewHeading}`);

  console.log(JSON.stringify({ startBrand, workspaceBrand, controls, imagePage }, null, 2));
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

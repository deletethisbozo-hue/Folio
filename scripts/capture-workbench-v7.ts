import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { registerWriteStudioApi } from "../server/write-studio-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

async function clickButtonByText(page: any, selector: string, text: string) {
  const clicked = await page.evaluate(({ selector, text }: { selector: string; text: string }) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(selector)]
      .find((item) => item.textContent?.trim() === text);
    if (!button) return false;
    button.click();
    return true;
  }, { selector, text });
  if (!clicked) throw new Error("Button not found: " + text);
}

const app = express();
app.use(express.json({ limit: "20mb" }));
registerApi(app);
registerEditorApi(app);
registerWriteStudioApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "web", "dist", "index.html")));

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1535, height: 811, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await clickButtonByText(page, "button", "Open Sample");
  await page.waitForSelector(".folio-shell");
  await page.waitForSelector(".manuscript-editor");
  await clickButtonByText(page, ".workspace-mode-switch button", "Format");
  await page.waitForFunction(() => document.querySelector(".folio-shell")?.getAttribute("data-workspace-mode") === "format");
  await new Promise((resolve) => setTimeout(resolve, 700));

  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>(".preview-error, .global-error")
      .forEach((element) => { element.style.display = "none"; });
  });

  const visual = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".folio-shell");
    const library = document.querySelector<HTMLElement>(".library-pane");
    const editor = document.querySelector<HTMLElement>(".editor-pane");
    const preview = document.querySelector<HTMLElement>(".preview-pane");
    const previewBar = document.querySelector<HTMLElement>(".preview-commandbar");
    const device = document.querySelector<HTMLElement>(".reader-device");
    if (!shell || !library || !editor || !preview || !previewBar || !device) throw new Error("Workbench structure missing");
    return {
      templateColumns: getComputedStyle(shell).gridTemplateColumns,
      templateRows: getComputedStyle(shell).gridTemplateRows,
      libraryHeight: getComputedStyle(library).height,
      libraryDisplay: getComputedStyle(library).display,
      previewBarHeight: getComputedStyle(previewBar).height,
      devicePadding: getComputedStyle(device).padding,
      deviceRadius: getComputedStyle(device).borderRadius
    };
  });

  if (visual.libraryHeight !== "92px") throw new Error("Horizontal manuscript dock not active: " + visual.libraryHeight);
  if (visual.libraryDisplay !== "grid") throw new Error("Manuscript dock is not grid layout.");
  if (visual.previewBarHeight !== "50px") throw new Error("Unified preview commandbar not active.");
  if (!visual.templateColumns.includes("440px")) throw new Error("Workbench two-column layout not active: " + visual.templateColumns);

  await fs.mkdir(path.join(ROOT, "artifacts"), { recursive: true });
  await page.screenshot({
    path: path.join(ROOT, "artifacts", "folio-workbench-v7.png"),
    fullPage: false,
  });
  console.log(JSON.stringify(visual));
} finally {
  server.close();
  await closeBrowser();
}

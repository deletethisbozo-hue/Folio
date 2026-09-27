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
  await new Promise((resolve) => setTimeout(resolve, 500));

  const visual = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".folio-shell");
    const bar = document.querySelector<HTMLElement>(".folio-commandbar");
    const selected = document.querySelector<HTMLElement>(".contents-row.selected");
    const editor = document.querySelector<HTMLElement>(".manuscript-editor");
    const preview = document.querySelector<HTMLElement>(".preview-stage");
    if (!shell || !bar || !selected || !editor || !preview) throw new Error("Folio workspace chrome missing");
    const css = getComputedStyle(shell);
    return {
      brand: css.getPropertyValue("--folio-brand").trim(),
      masthead: getComputedStyle(bar).backgroundImage,
      selectedRadius: getComputedStyle(selected).borderRadius,
      editorShadow: getComputedStyle(editor).boxShadow,
      editorBorder: getComputedStyle(editor).borderTopWidth,
      previewBackground: getComputedStyle(preview).backgroundColor,
    };
  });

  if (visual.brand.toLowerCase() !== "#5b5ce2") throw new Error("Folio brand accent changed: " + visual.brand);
  if (!visual.masthead.includes("linear-gradient")) throw new Error("Folio masthead lost its brand treatment.");
  if (visual.selectedRadius !== "0px") throw new Error("Selected manuscript row is still card-like: " + visual.selectedRadius);
  if (visual.editorShadow !== "none") throw new Error("Format editor still reads as a floating card: " + visual.editorShadow);
  if (visual.editorBorder !== "0px") throw new Error("Format editor still has a card border: " + visual.editorBorder);

  await fs.mkdir(path.join(ROOT, "artifacts"), { recursive: true });
  await page.screenshot({
    path: path.join(ROOT, "artifacts", "folio-art-direction-preview.png"),
    fullPage: false,
  });
  console.log(JSON.stringify(visual));
} finally {
  server.close();
  await closeBrowser();
}

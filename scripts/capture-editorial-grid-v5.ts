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
    const masthead = document.querySelector<HTMLElement>(".folio-commandbar");
    const sidebar = document.querySelector<HTMLElement>(".library-pane");
    const preview = document.querySelector<HTMLElement>(".preview-stage");
    const previewBar = document.querySelector<HTMLElement>(".preview-commandbar");
    const paper = document.querySelector<HTMLElement>(".manuscript-editor");
    const identity = document.querySelector<HTMLElement>(".book-identity");
    if (!masthead || !sidebar || !preview || !previewBar || !paper || !identity) throw new Error("Editorial grid structure missing");
    return {
      mastheadHeight: getComputedStyle(masthead).height,
      sidebarBackground: getComputedStyle(sidebar).backgroundColor,
      previewBarHeight: getComputedStyle(previewBar).height,
      paperShadow: getComputedStyle(paper).boxShadow,
      paperBackground: getComputedStyle(paper).backgroundColor,
      identityDisplay: getComputedStyle(identity).display
    };
  });

  if (visual.mastheadHeight !== "48px") throw new Error("Editorial titlebar not active: " + visual.mastheadHeight);
  if (visual.previewBarHeight !== "44px") throw new Error("Preview bar not active: " + visual.previewBarHeight);
  if (visual.paperShadow !== "none") throw new Error("Editor reverted to a floating card.");
  if (visual.identityDisplay !== "none") throw new Error("Duplicate book identity still visible.");

  await fs.mkdir(path.join(ROOT, "artifacts"), { recursive: true });
  await page.screenshot({ path: path.join(ROOT, "artifacts", "folio-editorial-grid-v5.png"), fullPage: false });
  console.log(JSON.stringify(visual));
} finally {
  server.close();
  await closeBrowser();
}

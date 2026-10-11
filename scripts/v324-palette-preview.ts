import express from "express";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { registerWriteStudioApi } from "../server/write-studio-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

const qa = path.join(ROOT, "build", "qa-v324-palette");
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
  await page.evaluate(() => localStorage.removeItem("folio-ui-tone"));
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector('.start-shell[data-ui-tone="ivory"]');
  await settle(350);
  await page.screenshot({ path: path.join(qa, "01-dashboard-light.png") });

  await page.evaluate(() => localStorage.setItem("folio-ui-tone", "midnight"));
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector('.start-shell[data-ui-tone="midnight"]');
  await settle(350);
  await page.screenshot({ path: path.join(qa, "02-dashboard-midnight.png") });

  await page.evaluate(() => localStorage.setItem("folio-ui-tone", "ivory"));
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector('.start-shell[data-ui-tone="ivory"]');
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((node) => node.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample missing");
    button.click();
  });
  await page.waitForSelector('.folio-shell[data-ui-tone="ivory"][data-workspace-mode="format"]');
  await page.waitForSelector('.rich-editor[contenteditable="true"]');
  await page.waitForFunction(() => !document.querySelector(".preview-loading"), { timeout: 20_000 }).catch(() => undefined);
  await settle(350);
  await page.screenshot({ path: path.join(qa, "03-workspace-light.png") });

  await page.click(".tone-toggle");
  await page.waitForSelector('.folio-shell[data-ui-tone="midnight"]');
  await settle(350);
  await page.screenshot({ path: path.join(qa, "04-workspace-midnight.png") });

  const palette = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".folio-shell");
    if (!shell) return null;
    const style = getComputedStyle(shell);
    return {
      bg: style.getPropertyValue("--folio-bg").trim(),
      panel: style.getPropertyValue("--folio-panel").trim(),
      surface: style.getPropertyValue("--folio-surface").trim(),
      text: style.getPropertyValue("--folio-text").trim(),
      accent: style.getPropertyValue("--folio-accent").trim(),
    };
  });
  console.log(JSON.stringify({ ok: true, palette }, null, 2));
} finally {
  server.close();
  await closeBrowser();
}

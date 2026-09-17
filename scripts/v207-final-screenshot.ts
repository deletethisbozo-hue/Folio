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
  await page.setViewport({ width: 1536, height: 1024, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample missing");
    button.click();
  });
  await page.waitForSelector(".folio-shell:not(.folio-empty-shell)");
  await page.waitForSelector(".library-add-section");

  const chapters = await page.$$(".contents-list .chapter-row");
  if (chapters.length > 1) await chapters[1].click();

  const kobo = await page.evaluate(() => {
    const select = document.querySelector<HTMLSelectElement>(".device-label select");
    if (!select) return "";
    const option = [...select.options].find((candidate) => /Kobo\s*6/i.test(candidate.textContent ?? ""));
    if (!option) return "";
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return option.value;
  });
  if (kobo) await page.waitForFunction((value) => (document.querySelector(".device-label select") as HTMLSelectElement | null)?.value === value, {}, kobo);

  await page.waitForSelector(".preview-frame");
  await page.waitForFunction(() => {
    const frame = document.querySelector<HTMLIFrameElement>(".preview-frame");
    const text = frame?.contentDocument?.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
    const loading = document.querySelector<HTMLElement>(".preview-loading");
    const loadingVisible = Boolean(loading && getComputedStyle(loading).display !== "none" && getComputedStyle(loading).visibility !== "hidden");
    return text.length > 160 && !loadingVisible;
  });
  await new Promise((resolve) => setTimeout(resolve, 350));
  await page.screenshot({ path: path.join(qa, "mockup-final-loaded.png") });
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

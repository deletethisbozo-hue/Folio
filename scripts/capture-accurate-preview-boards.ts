
import express from "express";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

const OUT = path.join(ROOT, "build", "accurate-preview-boards-source");
await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });

const app = express();
app.use(express.json({ limit: "5mb" }));
registerApi(app);
registerEditorApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "web", "dist", "index.html")));

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;

async function pause(ms: number) { await new Promise((r) => setTimeout(r, ms)); }

async function waitPreview(page: any) {
  await page.waitForSelector(".preview-frame");
  await page.waitForFunction(() => {
    const f = document.querySelector<HTMLIFrameElement>(".preview-frame");
    const txt = f?.contentDocument?.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
    const loading = document.querySelector<HTMLElement>(".preview-loading");
    const busy = Boolean(loading && getComputedStyle(loading).display !== "none" && getComputedStyle(loading).visibility !== "hidden");
    return txt.length > 100 && !busy;
  }, { timeout: 60000 });
  await pause(350);
}

async function openSample(page: any) {
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.waitForSelector(".start-shell .start-brand");
  await page.addStyleTag({ content: "*{cursor:none!important}" });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll<HTMLButtonElement>(".start-actions button")]
      .find((n) => n.textContent?.includes("Open Sample"));
    if (!b) throw new Error("Open Sample missing");
    b.click();
  });
  await page.waitForSelector(".folio-shell");
  await waitPreview(page);
}

async function ensureFormat(page: any) {
  const mode = await page.$eval(".folio-shell", (e: Element) => (e as HTMLElement).dataset.workspaceMode);
  if (mode !== "format") {
    await page.click(".workspace-mode-switch button:nth-child(2)");
    await page.waitForSelector('.folio-shell[data-workspace-mode="format"]');
    await waitPreview(page);
  }
}

async function firstChapter(page: any) {
  const count = await page.$$eval(".contents-row.chapter-row", (nodes: Element[]) => nodes.length);
  if (!count) throw new Error("No chapter rows");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".contents-row.chapter-row")?.click());
  await page.waitForFunction(() => Boolean(document.querySelector(".contents-row.chapter-row.selected")));
  await pause(250);
}

async function setPreview(page: any, value: string) {
  await page.select('select[aria-label="Preview device"]', value);
  await waitPreview(page);
}

async function setTrim6x9(page: any) {
  await page.waitForSelector('select[aria-label="Print trim"]');
  await page.select('select[aria-label="Print trim"]', "6x9");
  await waitPreview(page);
}

async function openStyles(page: any) {
  await page.click('[data-command="design"]');
  await page.waitForSelector('.style-library[aria-label="Book style library"]');
  await pause(250);
}

async function chooseTheme(page: any, label: string) {
  const ok = await page.evaluate((label: string) => {
    const card = [...document.querySelectorAll<HTMLButtonElement>(".theme-sample")]
      .find((n) => (n.querySelector(".theme-name")?.textContent ?? "").trim().toLowerCase() === label.toLowerCase());
    if (!card) return false;
    card.click();
    return true;
  }, label);
  if (!ok) throw new Error("Theme not found: " + label);
  await pause(450);
}

async function closeStyles(page: any) {
  await page.click('.style-library-header button[aria-label="Close"]');
  await page.waitForFunction(() => !document.querySelector(".style-library"));
  await waitPreview(page);
}

async function scrollPrintToChapter(page: any) {
  const title = await page.$eval(".chapter-row.selected .chapter-label", (el: Element) => el.textContent?.trim() ?? "");
  await page.evaluate((title: string) => {
    const iframe = document.querySelector<HTMLIFrameElement>(".preview-frame");
    const doc = iframe?.contentDocument;
    if (!doc) return;
    const pages = [...doc.querySelectorAll<HTMLElement>(".pagedjs_page")];
    let idx = pages.findIndex((p) =>
      [...p.querySelectorAll<HTMLElement>("section.chapter h1,h1.chapter")]
        .some((h) => (h.innerText ?? "").toLowerCase().includes(title.toLowerCase()))
    );
    if (idx < 0) idx = pages.findIndex((p) => Boolean(p.querySelector("section.chapter")));
    if (idx < 0) idx = 0;
    pages[idx]?.scrollIntoView({ block: "start", behavior: "auto" });
  }, title);
  await pause(600);
}

async function shotPane(page: any, name: string) {
  const pane = await page.$(".preview-pane");
  if (!pane) throw new Error("Preview pane missing");
  await pane.screenshot({ path: path.join(OUT, name + ".png"), type: "png" });
}

async function shotFull(page: any, name: string) {
  await page.screenshot({ path: path.join(OUT, name + "-full.png"), type: "png", captureBeyondViewport: false });
}

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);
  await page.setViewport({ width: 1920, height: 1200, deviceScaleFactor: 2 });

  await openSample(page);
  await firstChapter(page);
  await ensureFormat(page);

  // Real device previews from the app.
  for (const [value, slug] of [
    ["tablet-8", "tablet-8"],
    ["phone-6-1", "phone-6.1"],
    ["phone-6-7", "phone-6.7"],
  ] as const) {
    await setPreview(page, value);
    await shotPane(page, slug);
    await shotFull(page, slug);
  }

  // Real Folio themes in Print · Pages / 6 × 9.
  await setPreview(page, "print");
  await setTrim6x9(page);

  for (const label of ["Grimoire", "Heritage", "Obsidian"]) {
    await openStyles(page);
    await chooseTheme(page, label);
    await closeStyles(page);
    await setPreview(page, "print");
    await setTrim6x9(page);
    await scrollPrintToChapter(page);
    const slug = label.toLowerCase();
    await shotPane(page, "theme-" + slug);
    await shotFull(page, "theme-" + slug);
  }
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

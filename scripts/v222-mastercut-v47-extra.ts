import express from "express";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

const FPS = 30;
const WIDTH = 2560;
const HEIGHT = 1440;
const out = path.join(ROOT, "build", "promo-v47-extra");
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });

const app = express();
app.use(express.json({ limit: "5mb" }));
registerApi(app);
registerEditorApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "web", "dist", "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;

let scene = "";
let frame = 0;
async function begin(name: string) {
  scene = name; frame = 0;
  await fs.mkdir(path.join(out, name), { recursive: true });
}
async function shot(page: any) {
  const file = path.join(out, scene, "frame-" + String(frame++).padStart(5, "0") + ".jpg");
  await page.screenshot({ path: file, type: "jpeg", quality: 92, captureBeyondViewport: false });
}
async function record(page: any, seconds: number) {
  const n = Math.max(1, Math.round(seconds * FPS));
  for (let i = 0; i < n; i += 1) await shot(page);
}
async function pause(ms: number) { await new Promise((r) => setTimeout(r, ms)); }
async function waitPreview(page: any) {
  await page.waitForSelector(".preview-frame");
  await page.waitForFunction(() => {
    const f = document.querySelector<HTMLIFrameElement>(".preview-frame");
    const txt = f?.contentDocument?.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
    const loading = document.querySelector<HTMLElement>(".preview-loading");
    const busy = Boolean(loading && getComputedStyle(loading).display !== "none" && getComputedStyle(loading).visibility !== "hidden");
    return txt.length > 120 && !busy;
  }, { timeout: 60000 });
}
async function ensureWrite(page: any) {
  const mode = await page.$eval(".folio-shell", (el: Element) => (el as HTMLElement).dataset.workspaceMode);
  if (mode !== "write") { await page.click(".workspace-mode-switch button:first-child"); await page.waitForSelector(".folio-shell[data-workspace-mode=\"write\"]"); await pause(220); }
}
async function ensureFormat(page: any) {
  const mode = await page.$eval(".folio-shell", (el: Element) => (el as HTMLElement).dataset.workspaceMode);
  if (mode !== "format") { await page.click(".workspace-mode-switch button:nth-child(2)"); await page.waitForSelector(".folio-shell[data-workspace-mode=\"format\"]"); await waitPreview(page); await pause(220); }
}
async function chooseFirstChapter(page: any) {
  const count = await page.$$eval(".contents-row.chapter-row", (nodes: Element[]) => nodes.length);
  if (!count) throw new Error("Sample has no chapters");
  await page.evaluate(() => (document.querySelector<HTMLButtonElement>(".contents-row.chapter-row"))?.click());
  await page.waitForFunction(() => Boolean(document.querySelector(".contents-row.chapter-row.selected")));
  await pause(320);
}
async function setSidebar(page: any, open: boolean) {
  const state = await page.$eval(".folio-shell", (el: Element) => (el as HTMLElement).dataset.writeSidebar);
  if ((state === "open") !== open) {
    await page.click(open ? ".write-sidebar-toggle" : ".library-collapse-button");
    await page.waitForSelector(".folio-shell[data-write-sidebar=\"" + (open ? "open" : "closed") + "\"]");
    await pause(180);
  }
}
async function setSplit(page: any, on: boolean) {
  const state = await page.$eval(".folio-shell", (el: Element) => (el as HTMLElement).dataset.splitView);
  if ((state === "true") !== on) {
    await page.click(".editor-split-toggle");
    await page.waitForSelector(".folio-shell[data-split-view=\"" + (on ? "true" : "false") + "\"]");
    if (on) {
      await page.waitForSelector(".writing-split-pane");
      await page.waitForFunction(() => (document.querySelector(".writing-split-editor")?.textContent?.trim().length ?? 0) > 60);
    }
    await pause(250);
  }
}
async function setFocus(page: any, on: boolean) {
  const state = await page.$eval(".folio-shell", (el: Element) => (el as HTMLElement).dataset.focusMode);
  if ((state === "true") !== on) {
    if (on) { await page.click(".editor-focus-toggle"); await page.waitForSelector(".folio-shell[data-focus-mode=\"true\"]"); }
    else { await page.keyboard.press("Escape"); await page.waitForSelector(".folio-shell[data-focus-mode=\"false\"]"); }
    await pause(220);
  }
}
async function setTypewriter(page: any, on: boolean) {
  const state = await page.$eval(".folio-shell", (el: Element) => (el as HTMLElement).dataset.typewriterMode);
  if ((state === "true") !== on) { await page.click(".editor-typewriter-toggle"); await page.waitForSelector(".folio-shell[data-typewriter-mode=\"" + (on ? "true" : "false") + "\"]"); await pause(180); }
}
async function setPreview(page: any, value: string) {
  await page.select("select[aria-label=\"Preview device\"]", value);
  await waitPreview(page);
  await pause(300);
}
async function openStyles(page: any) {
  await page.click("[data-command=\"design\"]");
  await page.waitForSelector(".style-library[aria-label=\"Book style library\"]");
  await pause(260);
}
async function closeStyles(page: any) {
  await page.click(".style-library-header button[aria-label=\"Close\"]");
  await page.waitForFunction(() => !document.querySelector(".style-library"));
  await waitPreview(page);
  await pause(260);
}
async function chooseThemeByLabel(page: any, label: string) {
  const ok = await page.evaluate((label: string) => {
    const card = [...document.querySelectorAll<HTMLButtonElement>(".theme-sample")].find((n) => (n.querySelector(".theme-name")?.textContent ?? "").trim().toLowerCase() === label.toLowerCase());
    if (!card) return false;
    card.click(); return true;
  }, label);
  if (!ok) throw new Error("Theme not found: " + label);
  await pause(420);
}
async function scrollPrintToChapter(page: any, bodyPage = false) {
  const title = await page.$eval(".chapter-row.selected .chapter-label", (el: Element) => el.textContent?.trim() ?? "");
  await page.evaluate(({ title, bodyPage }: { title: string; bodyPage: boolean }) => {
    const f = document.querySelector<HTMLIFrameElement>(".preview-frame");
    const doc = f?.contentDocument;
    if (!doc) return;
    const pages = [...doc.querySelectorAll<HTMLElement>(".pagedjs_page")];
    let index = pages.findIndex((p) => (p.innerText ?? "").toLowerCase().includes(title.toLowerCase()));
    if (index < 0) index = pages.findIndex((p) => /chapter|visitor|arrival/i.test(p.innerText ?? ""));
    if (index < 0) index = Math.min(2, pages.length - 1);
    const target = pages[Math.min(pages.length - 1, Math.max(0, index + (bodyPage ? 1 : 0)))];
    target?.scrollIntoView({ block: "start", behavior: "auto" });
  }, { title, bodyPage });
  await pause(500);
}

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.waitForSelector(".start-shell .start-brand");
  await page.addStyleTag({ content: "*{cursor:none!important}html,body{background:#f2f3f5!important}" });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll<HTMLButtonElement>(".start-actions button")].find((n) => n.textContent?.includes("Open Sample"));
    if (!b) throw new Error("Open Sample missing");
    b.click();
  });
  await page.waitForSelector(".folio-shell");
  await waitPreview(page);
  await pause(350);

  // WRITE: first real chapter, then deliberately show another chapter in split view.
  await ensureWrite(page);
  await setSidebar(page, true);
  await chooseFirstChapter(page);
  const chapters = await page.$$eval(".contents-row.chapter-row .chapter-label", (nodes: Element[]) => nodes.map((n) => n.textContent?.trim() ?? ""));
  await fs.writeFile(path.join(out, "chapters.json"), JSON.stringify(chapters, null, 2), "utf8");
  await setSidebar(page, false);
  await setSplit(page, false); await setFocus(page, false); await setTypewriter(page, false);

  await begin("01-typewriter");
  await record(page, 0.65);
  await setTypewriter(page, true);
  await page.evaluate(() => {
    const ed = document.querySelector<HTMLElement>(".manuscript-editor");
    if (!ed) return; ed.scrollTop = Math.max(0, ed.scrollHeight * 0.42); ed.focus();
  });
  await pause(220);
  await record(page, 1.55);
  await setTypewriter(page, false);

  await begin("02-split-reference");
  await record(page, 0.45);
  await setSplit(page, true);
  await page.evaluate(() => {
    const select = document.querySelector<HTMLSelectElement>("select[aria-label=\"Split editor section\"]");
    if (!select) return;
    const chapterOptions = [...select.options].filter((o) => /chapter|visitor|arrival|night|letter|room/i.test(o.text));
    const pick = chapterOptions[0] ?? [...select.options][0];
    if (pick) { select.value = pick.value; select.dispatchEvent(new Event("change", { bubbles: true })); }
  });
  await page.waitForFunction(() => (document.querySelector(".writing-split-editor")?.textContent?.trim().length ?? 0) > 60);
  await page.evaluate(() => {
    const left = document.querySelector<HTMLElement>(".manuscript-editor");
    const right = document.querySelector<HTMLElement>(".writing-split-editor");
    if (left) left.scrollTop = Math.max(0, left.scrollHeight * 0.30);
    if (right) right.scrollTop = Math.max(0, right.scrollHeight * 0.58);
  });
  await pause(300);
  await record(page, 2.10);
  await setSplit(page, false);

  await begin("03-focus");
  await record(page, 0.45);
  await setFocus(page, true);
  await record(page, 1.55);
  await setFocus(page, false);

  await setSidebar(page, true);
  await begin("04-structure");
  await record(page, 1.45);
  await setSidebar(page, false);

  // FORMAT: show the actual gallery, then three visibly different real themes.
  await ensureFormat(page);
  await setPreview(page, "kindle-6-8");
  await openStyles(page);
  await begin("05-theme-gallery");
  await record(page, 1.65);
  await chooseThemeByLabel(page, "Blackletter");
  await record(page, 0.65);
  await chooseThemeByLabel(page, "Witchlight");
  await record(page, 0.65);
  await chooseThemeByLabel(page, "Cathedral");
  await record(page, 0.65);
  await closeStyles(page);

  await begin("06-theme-result-cathedral");
  await record(page, 1.35);

  await openStyles(page);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll<HTMLButtonElement>(".style-category-list button")].find((n) => n.textContent?.trim() === "Chapter Heading");
    b?.click();
  });
  await pause(250);
  await begin("07-chapter-heading-controls");
  await record(page, 1.65);
  await closeStyles(page);

  await begin("08-device-preview");
  await setPreview(page, "kindle-6-8"); await record(page, 0.75);
  await setPreview(page, "phone-6-7"); await record(page, 0.82);
  await setPreview(page, "tablet-11"); await record(page, 0.82);

  // PRINT: selected chapter, not table of contents. First chapter opener, then a body page.
  await chooseFirstChapter(page);
  await setPreview(page, "print");
  await scrollPrintToChapter(page, false);
  await begin("09-print-chapter-opener");
  await record(page, 1.55);
  await scrollPrintToChapter(page, true);
  await begin("10-print-body-page");
  await record(page, 1.55);

  // PUBLISH: formats menu, then a real Print PDF export with status.
  await page.click(".generate-button");
  await page.waitForSelector(".generate-menu");
  await begin("11-export-formats");
  await record(page, 1.60);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll<HTMLButtonElement>(".generate-menu button")].find((n) => n.textContent?.trim() === "Print PDF");
    b?.click();
  });
  await pause(140);
  await begin("12-print-pdf-generate");
  await record(page, 0.85);
  await page.waitForFunction(() => {
    const text = document.querySelector(".generate-status")?.textContent ?? "";
    return /✓|\.pdf|failed|error/i.test(text);
  }, { timeout: 120000 });
  await record(page, 1.35);

  await page.screenshot({ path: path.join(out, "poster.png"), type: "png", captureBeyondViewport: false });
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
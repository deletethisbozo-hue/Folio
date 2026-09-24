import express from "express";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

const FPS = 24;
const CSS_W = 1920;
const CSS_H = 1080;
const out = path.join(ROOT, "build", "promo-v48-source");
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });

const app = express();
app.use(express.json({ limit: "8mb" }));
registerApi(app);
registerEditorApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "web", "dist", "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;

let scene = "";
let frame = 0;
async function begin(name: string) { scene = name; frame = 0; await fs.mkdir(path.join(out, name), { recursive: true }); }
async function shot(page: any) {
  const file = path.join(out, scene, "frame-" + String(frame++).padStart(5, "0") + ".jpg");
  await page.screenshot({ path: file, type: "jpeg", quality: 94, captureBeyondViewport: false });
}
async function record(page: any, seconds: number) {
  const n = Math.max(1, Math.round(seconds * FPS));
  for (let i = 0; i < n; i += 1) await shot(page);
}
async function pause(ms: number) { await new Promise((resolve) => setTimeout(resolve, ms)); }
async function typeRecorded(page: any, text: string, tailSeconds = .55) {
  for (const char of text) { await page.keyboard.type(char); await shot(page); }
  await record(page, tailSeconds);
}

async function waitPreview(page: any) {
  await page.waitForSelector(".preview-frame");
  await page.waitForFunction(() => {
    const f = document.querySelector<HTMLIFrameElement>(".preview-frame");
    const t = f?.contentDocument?.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
    const loading = document.querySelector<HTMLElement>(".preview-loading");
    const busy = Boolean(loading && getComputedStyle(loading).display !== "none" && getComputedStyle(loading).visibility !== "hidden");
    return t.length > 120 && !busy;
  }, { timeout: 60000 });
}
async function openSample(page: any) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll<HTMLButtonElement>(".start-actions button")].find((n) => n.textContent?.includes("Open Sample"));
    if (!b) throw new Error("Open Sample missing");
    b.click();
  });
  await page.waitForSelector(".folio-shell");
  await waitPreview(page);
  await pause(300);
}
async function ensureWrite(page: any) {
  const mode = await page.$eval(".folio-shell", (e: Element) => (e as HTMLElement).dataset.workspaceMode);
  if (mode !== "write") { await page.click(".workspace-mode-switch button:first-child"); await page.waitForSelector(".folio-shell[data-workspace-mode=\"write\"]"); await pause(220); }
}
async function ensureFormat(page: any) {
  const mode = await page.$eval(".folio-shell", (e: Element) => (e as HTMLElement).dataset.workspaceMode);
  if (mode !== "format") { await page.click(".workspace-mode-switch button:nth-child(2)"); await page.waitForSelector(".folio-shell[data-workspace-mode=\"format\"]"); await waitPreview(page); await pause(220); }
}
async function setSidebar(page: any, open: boolean) {
  const state = await page.$eval(".folio-shell", (e: Element) => (e as HTMLElement).dataset.writeSidebar);
  if ((state === "open") !== open) {
    await page.click(open ? ".write-sidebar-toggle" : ".library-collapse-button");
    await page.waitForSelector(".folio-shell[data-write-sidebar=\"" + (open ? "open" : "closed") + "\"]");
    await pause(180);
  }
}
async function setSplit(page: any, on: boolean) {
  const state = await page.$eval(".folio-shell", (e: Element) => (e as HTMLElement).dataset.splitView);
  if ((state === "true") !== on) {
    await page.click(".editor-split-toggle");
    await page.waitForSelector(".folio-shell[data-split-view=\"" + (on ? "true" : "false") + "\"]");
    if (on) await page.waitForFunction(() => (document.querySelector(".writing-split-editor")?.textContent?.trim().length ?? 0) > 60);
    await pause(220);
  }
}
async function setTypewriter(page: any, on: boolean) {
  const state = await page.$eval(".folio-shell", (e: Element) => (e as HTMLElement).dataset.typewriterMode);
  if ((state === "true") !== on) { await page.click(".editor-typewriter-toggle"); await page.waitForSelector(".folio-shell[data-typewriter-mode=\"" + (on ? "true" : "false") + "\"]"); await pause(180); }
}
async function setFocus(page: any, on: boolean) {
  const state = await page.$eval(".folio-shell", (e: Element) => (e as HTMLElement).dataset.focusMode);
  if ((state === "true") !== on) {
    if (on) { await page.click(".editor-focus-toggle"); await page.waitForSelector(".folio-shell[data-focus-mode=\"true\"]"); }
    else { await page.keyboard.press("Escape"); await page.waitForSelector(".folio-shell[data-focus-mode=\"false\"]"); }
    await pause(220);
  }
}
async function firstChapter(page: any) {
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".contents-row.chapter-row")?.click());
  await page.waitForFunction(() => Boolean(document.querySelector(".contents-row.chapter-row.selected")));
  await pause(260);
}
async function setCaret(page: any, selector: string, paragraphIndex: number, fraction = .8) {
  await page.evaluate(({ selector, paragraphIndex, fraction }: { selector: string; paragraphIndex: number; fraction: number }) => {
    const editor = document.querySelector<HTMLElement>(selector);
    if (!editor) throw new Error("Editor missing: " + selector);
    const paras = [...editor.querySelectorAll<HTMLElement>("p")].filter((p) => (p.innerText ?? "").trim().length > 45);
    const p = paras[Math.min(paras.length - 1, Math.max(0, paragraphIndex))];
    if (!p) throw new Error("No suitable paragraph");
    p.scrollIntoView({ block: "center", behavior: "auto" });
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = []; while (walker.nextNode()) { const n = walker.currentNode as Text; if (n.data.trim()) nodes.push(n); }
    const node = nodes[Math.max(0, nodes.length - 1)];
    if (!node) throw new Error("No text node");
    const pos = Math.max(1, Math.min(node.length, Math.floor(node.length * fraction)));
    const range = document.createRange(); range.setStart(node, pos); range.collapse(true);
    const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range); editor.focus();
    editor.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "ArrowDown" }));
  }, { selector, paragraphIndex, fraction });
  await pause(220);
}
async function setPreview(page: any, value: string) { await page.select("select[aria-label=\"Preview device\"]", value); await waitPreview(page); await pause(260); }
async function openStyles(page: any) { await page.click("[data-command=\"design\"]"); await page.waitForSelector(".style-library[aria-label=\"Book style library\"]"); await pause(240); }
async function closeStyles(page: any) { await page.click(".style-library-header button[aria-label=\"Close\"]"); await page.waitForFunction(() => !document.querySelector(".style-library")); await waitPreview(page); await pause(240); }
async function chooseTheme(page: any, label: string) {
  const ok = await page.evaluate((label: string) => {
    const c = [...document.querySelectorAll<HTMLButtonElement>(".theme-sample")].find((n) => (n.querySelector(".theme-name")?.textContent ?? "").trim().toLowerCase() === label.toLowerCase());
    if (!c) return false; c.click(); return true;
  }, label);
  if (!ok) throw new Error("Theme missing: " + label);
  await pause(360);
}
async function setChapterDesign(page: any) {
  await page.evaluate(() => {
    const nav = [...document.querySelectorAll<HTMLButtonElement>(".style-category-list button")].find((n) => n.textContent?.trim() === "Chapter Heading");
    nav?.click();
  });
  await pause(220);
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLLabelElement>(".customize-row")];
    const setSelect = (label: string, value: string) => {
      const row = rows.find((r) => r.querySelector(":scope > span")?.textContent?.trim() === label);
      const select = row?.querySelector<HTMLSelectElement>("select");
      if (select) { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); }
    };
    setSelect("Typeface", "Folio Bodoni Moda");
    setSelect("Size", "2.2em");
    setSelect("Alignment", "center");
    setSelect("Letter case", "uppercase");
  });
  await pause(420);
}
async function scrollPrintChapter(page: any, body: boolean) {
  const title = await page.$eval(".chapter-row.selected .chapter-label", (e: Element) => e.textContent?.trim() ?? "");
  await page.evaluate(({ title, body }: { title: string; body: boolean }) => {
    const f = document.querySelector<HTMLIFrameElement>(".preview-frame"); const doc = f?.contentDocument; if (!doc) return;
    const pages = [...doc.querySelectorAll<HTMLElement>(".pagedjs_page")];
    let idx = pages.findIndex((p) => [...p.querySelectorAll<HTMLElement>("section.chapter h1,h1.chapter")].some((h) => (h.innerText ?? "").toLowerCase().includes(title.toLowerCase())));
    if (idx < 0) idx = pages.findIndex((p) => Boolean(p.querySelector("section.chapter")));
    if (idx < 0) idx = Math.min(2, pages.length - 1);
    pages[Math.min(pages.length - 1, Math.max(0, idx + (body ? 1 : 0)))]?.scrollIntoView({ block: "start", behavior: "auto" });
  }, { title, body });
  await pause(430);
}

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);
  await page.setViewport({ width: CSS_W, height: CSS_H, deviceScaleFactor: 2 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.waitForSelector(".start-shell .start-brand");
  await page.addStyleTag({ content: "*{cursor:none!important}html,body{background:#f2f3f5!important}" });
  await openSample(page);

  // WRITE: Typewriter actually writing.
  await ensureWrite(page); await setSidebar(page, true); await firstChapter(page); await setSidebar(page, false); await setSplit(page, false); await setFocus(page, false); await setTypewriter(page, false);
  await setCaret(page, ".manuscript-editor", 2, .92);
  await begin("01-typewriter-action"); await record(page, .45);
  await setTypewriter(page, true); await setCaret(page, ".manuscript-editor", 2, .92); await record(page, .35);
  await typeRecorded(page, " The sentence settles into place.", .70);
  await setTypewriter(page, false);

  // SPLIT: edit left chapter while a different chapter stays visible on the right.
  await setSplit(page, true);
  await page.evaluate(() => {
    const s = document.querySelector<HTMLSelectElement>("select[aria-label=\"Split editor section\"]"); if (!s) return;
    const opts = [...s.options]; const pick = opts.find((o) => /The Garden|The Mechanism/i.test(o.text)) ?? opts[0];
    if (pick) { s.value = pick.value; s.dispatchEvent(new Event("change", { bubbles: true })); }
  });
  await page.waitForFunction(() => (document.querySelector(".writing-split-editor")?.textContent?.trim().length ?? 0) > 60);
  await setCaret(page, ".manuscript-editor", 1, .88);
  await page.evaluate(() => { const r = document.querySelector<HTMLElement>(".writing-split-editor"); if (r) r.scrollTop = Math.max(0, r.scrollHeight * .28); });
  await begin("02-split-edit-action"); await record(page, .65);
  await typeRecorded(page, " Revision lands here.", .85);
  await setSplit(page, false);

  // FOCUS: clear before/after transformation.
  await begin("03-focus-before-after"); await record(page, .55); await setFocus(page, true); await record(page, 1.45); await setFocus(page, false);

  // ILLUSTRATION: insert actual image, then activate text wrap using real controls.
  await setCaret(page, ".manuscript-editor", 3, .92);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".illustration-button")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
  const input = await page.$(".illustration-input");
  if (!input) throw new Error("Illustration input missing");
  await input.uploadFile(path.join(ROOT, "samples", "clockwork-garden", "cover.png"));
  await page.waitForSelector(".editor-illustration img[data-folio-asset]");
  await page.evaluate(() => document.querySelector<HTMLElement>(".editor-illustration")?.scrollIntoView({ block: "center", behavior: "auto" }));
  await pause(450);
  await page.click(".editor-illustration img[data-folio-asset]");
  await page.waitForSelector(".folio-image-inspector[data-open=\"true\"]");
  await begin("04-illustration-wrap"); await record(page, .55);
  await page.click("[data-folio-wrap-choice=\"right\"]");
  await pause(300);
  await page.evaluate(() => {
    const s = document.querySelector<HTMLInputElement>(".folio-image-inspector [data-folio-control=\"scale\"]");
    if (s) { s.value = "46"; s.dispatchEvent(new Event("input", { bubbles: true })); s.dispatchEvent(new Event("change", { bubbles: true })); }
  });
  await pause(350); await record(page, 1.55);

  // FORMAT: gallery then immediate visible book result for each theme.
  await ensureFormat(page); await setPreview(page, "kindle-6-8");
  await openStyles(page); await begin("05-theme-gallery"); await record(page, .85);
  await chooseTheme(page, "Blackletter"); await closeStyles(page); await begin("06-theme-blackletter"); await record(page, .78);
  await openStyles(page); await chooseTheme(page, "Witchlight"); await closeStyles(page); await begin("07-theme-witchlight"); await record(page, .78);
  await openStyles(page); await chooseTheme(page, "Cathedral"); await closeStyles(page); await begin("08-theme-cathedral"); await record(page, .92);

  // Chapter design: show a targeted control operation then its preview result.
  await openStyles(page); await setChapterDesign(page); await begin("09-chapter-design-controls"); await record(page, .85); await closeStyles(page);
  await begin("10-chapter-design-result"); await record(page, 1.05);

  // Device preview.
  await begin("11-device-preview");
  await setPreview(page, "kindle-6-8"); await record(page, .70);
  await setPreview(page, "phone-6-7"); await record(page, .78);
  await setPreview(page, "tablet-11"); await record(page, .78);

  // Print: chapter opener then a true body page.
  await firstChapter(page); await setPreview(page, "print"); await scrollPrintChapter(page, false);
  await begin("12-print-opener"); await record(page, 1.35);
  await scrollPrintChapter(page, true); await begin("13-print-body"); await record(page, 1.35);

  // Publish: export formats then actual Print PDF result.
  await page.click(".generate-button"); await page.waitForSelector(".generate-menu");
  await begin("14-export-menu"); await record(page, 1.35);
  await page.evaluate(() => { const b = [...document.querySelectorAll<HTMLButtonElement>(".generate-menu button")].find((n) => n.textContent?.trim() === "Print PDF"); b?.click(); });
  await pause(120); await begin("15-print-pdf-result"); await record(page, .55);
  await page.waitForFunction(() => /✓|\.pdf|failed|error/i.test(document.querySelector(".generate-status")?.textContent ?? ""), { timeout: 120000 });
  await record(page, 1.20);
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
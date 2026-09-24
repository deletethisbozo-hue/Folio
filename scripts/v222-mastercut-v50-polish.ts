
import express from "express";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

const FPS = 24;
const out = path.join(ROOT, "build", "promo-v50-polish");
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
  await page.screenshot({
    path: path.join(out, scene, "frame-" + String(frame++).padStart(5, "0") + ".jpg"),
    type: "jpeg", quality: 94, captureBeyondViewport: false,
  });
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
    const t = f?.contentDocument?.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
    const loading = document.querySelector<HTMLElement>(".preview-loading");
    const busy = Boolean(loading && getComputedStyle(loading).display !== "none" && getComputedStyle(loading).visibility !== "hidden");
    return t.length > 120 && !busy;
  }, { timeout: 60000 });
}
async function openSample(page: any) {
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
  await pause(300);
}
async function ensureWrite(page: any) {
  const mode = await page.$eval(".folio-shell", (e: Element) => (e as HTMLElement).dataset.workspaceMode);
  if (mode !== "write") {
    await page.click(".workspace-mode-switch button:first-child");
    await page.waitForSelector('.folio-shell[data-workspace-mode="write"]');
    await pause(220);
  }
}
async function ensureFormat(page: any) {
  const mode = await page.$eval(".folio-shell", (e: Element) => (e as HTMLElement).dataset.workspaceMode);
  if (mode !== "format") {
    await page.click(".workspace-mode-switch button:nth-child(2)");
    await page.waitForSelector('.folio-shell[data-workspace-mode="format"]');
    await waitPreview(page);
    await pause(260);
  }
}
async function setSidebar(page: any, open: boolean) {
  const state = await page.$eval(".folio-shell", (e: Element) => (e as HTMLElement).dataset.writeSidebar);
  if ((state === "open") !== open) {
    await page.click(open ? ".write-sidebar-toggle" : ".library-collapse-button");
    await page.waitForSelector('.folio-shell[data-write-sidebar="' + (open ? "open" : "closed") + '"]');
    await pause(160);
  }
}
async function firstChapter(page: any) {
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".contents-row.chapter-row")?.click());
  await page.waitForFunction(() => Boolean(document.querySelector(".contents-row.chapter-row.selected")));
  await pause(260);
}
async function setPreview(page: any, value: string) {
  await page.select('select[aria-label="Preview device"]', value);
  await waitPreview(page);
  await pause(320);
}
async function openStyles(page: any) {
  await page.click('[data-command="design"]');
  await page.waitForSelector('.style-library[aria-label="Book style library"]');
  await pause(220);
}
async function closeStyles(page: any) {
  await page.click('.style-library-header button[aria-label="Close"]');
  await page.waitForFunction(() => !document.querySelector(".style-library"));
  await waitPreview(page);
  await pause(280);
}
async function selectStyleCategory(page: any, label: string) {
  await page.evaluate((label: string) => {
    const b = [...document.querySelectorAll<HTMLButtonElement>(".style-category-list button")].find((n) => n.textContent?.trim() === label);
    b?.click();
  }, label);
  await pause(220);
}
async function setDropcapFont(page: any, font: string) {
  await page.evaluate((font: string) => {
    const rows = [...document.querySelectorAll<HTMLLabelElement>(".customize-row")];
    const dropRow = rows.find((r) => r.querySelector(":scope > span")?.textContent?.trim() === "Drop cap");
    const check = dropRow?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (check && !check.checked) check.click();

    const sizeRow = rows.find((r) => r.querySelector(":scope > span")?.textContent?.trim() === "Drop cap size");
    const size = sizeRow?.querySelector<HTMLSelectElement>("select");
    if (size) { size.value = "large"; size.dispatchEvent(new Event("change", { bubbles: true })); }

    const fontRow = rows.find((r) => r.querySelector(":scope > span")?.textContent?.trim() === "Drop cap typeface");
    const select = fontRow?.querySelector<HTMLSelectElement>("select");
    if (!select) throw new Error("Drop cap font select missing");
    select.value = font;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, font);
  await pause(350);
}
async function scrollToPreviewImage(page: any) {
  await page.waitForFunction(() => {
    const f = document.querySelector<HTMLIFrameElement>(".preview-frame");
    const doc = f?.contentDocument;
    return Boolean(doc?.querySelector(".folio-illustration-block img, img.folio-illustration-preview, img.folio-illustration"));
  }, { timeout: 60000 });
  await page.evaluate(() => {
    const f = document.querySelector<HTMLIFrameElement>(".preview-frame");
    const doc = f?.contentDocument;
    if (!doc) return;
    const img = doc.querySelector<HTMLElement>(".folio-illustration-block img, img.folio-illustration-preview, img.folio-illustration");
    const pageEl = img?.closest<HTMLElement>(".pagedjs_page");
    (pageEl ?? img)?.scrollIntoView({ block: "center", behavior: "auto" });
  });
  await pause(500);
}
async function scrollToChapterTop(page: any) {
  const title = await page.$eval(".chapter-row.selected .chapter-label", (e: Element) => e.textContent?.trim() ?? "");
  await page.evaluate((title: string) => {
    const f = document.querySelector<HTMLIFrameElement>(".preview-frame");
    const doc = f?.contentDocument; if (!doc) return;
    const pages = [...doc.querySelectorAll<HTMLElement>(".pagedjs_page")];
    let idx = pages.findIndex((p) => [...p.querySelectorAll<HTMLElement>("section.chapter h1,h1.chapter")].some((h) => (h.innerText ?? "").toLowerCase().includes(title.toLowerCase())));
    if (idx < 0) idx = pages.findIndex((p) => Boolean(p.querySelector("section.chapter")));
    if (idx < 0) idx = 0;
    pages[idx]?.scrollIntoView({ block: "start", behavior: "auto" });
  }, title);
  await pause(430);
}

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });

  // --- PREVIEW CONTOUR WRAP ---
  await openSample(page);
  await ensureWrite(page);
  await setSidebar(page, true);
  await firstChapter(page);
  await setSidebar(page, false);

  const artBase64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 760; canvas.height = 900;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#24262b"; ctx.fillStyle = "#24262b"; ctx.lineWidth = 9; ctx.lineCap = "round"; ctx.lineJoin = "round";

    ctx.beginPath();
    for (let i = 0; i <= 170; i++) {
      const t = i / 170;
      const x = 350 + 100 * Math.sin(t * Math.PI * 1.25) - 24 * t;
      const y = 820 - 650 * t;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    const ts = [.13,.22,.31,.40,.49,.58,.67,.76];
    ts.forEach((t, k) => {
      const x = 350 + 100 * Math.sin(t * Math.PI * 1.25) - 24 * t;
      const y = 820 - 650 * t;
      const side = k % 2 === 0 ? -1 : 1;
      const tipX = x + side * (105 + (k % 3) * 12);
      const tipY = y - 28 - (k % 2) * 10;
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + side * 32, y - 70, tipX, tipY);
      ctx.quadraticCurveTo(x + side * 45, y + 28, x, y);
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tipX - side * 18, tipY + 7); ctx.stroke();
    });

    const gx = 425, gy = 150, r = 95, teeth = 14;
    ctx.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const a = i * Math.PI / teeth - Math.PI / 2;
      const rr = r + (i % 2 === 0 ? 18 : 0);
      const x = gx + Math.cos(a) * rr, y = gy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.arc(gx, gy, 63, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(gx, gy, 24, 0, Math.PI * 2); ctx.stroke();
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const artPath = path.join(out, "contour-demo.png");
  await fs.writeFile(artPath, Buffer.from(artBase64, "base64"));

  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".manuscript-editor")!;
    const paras = [...editor.querySelectorAll<HTMLElement>("p")].filter((p) => (p.innerText ?? "").trim().length > 60);
    const p = paras[1] ?? paras[0];
    if (!p) throw new Error("No paragraph");
    p.scrollIntoView({ block: "center", behavior: "auto" });
    const range = document.createRange(); range.selectNodeContents(p); range.collapse(false);
    const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range); editor.focus();
    editor.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  const input = await page.$(".illustration-input");
  if (!input) throw new Error("Illustration input missing");
  await input.uploadFile(artPath);
  await page.waitForSelector(".editor-illustration img[data-folio-asset]");
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".manuscript-editor")!;
    const fig = editor.querySelector<HTMLElement>(".editor-illustration")!;
    const paras = [...editor.querySelectorAll<HTMLElement>("p")].filter((p) => (p.innerText ?? "").trim().length > 60);
    const anchor = paras[2] ?? paras[1];
    if (anchor) editor.insertBefore(fig, anchor);
    fig.dataset.folioScale = "38";
    fig.dataset.folioWrap = "left";
    fig.dataset.folioShape = "box";
    fig.dataset.folioGap = "55";
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
  });
  await pause(650);

  await ensureFormat(page);
  await setPreview(page, "print");
  await scrollToPreviewImage(page);
  await begin("01-wrap-box-preview");
  await record(page, 1.25);

  await ensureWrite(page);
  await page.evaluate(() => {
    const fig = document.querySelector<HTMLElement>(".editor-illustration")!;
    fig.dataset.folioShape = "contour";
    const editor = fig.closest<HTMLElement>(".manuscript-editor");
    editor?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
  });
  await pause(650);
  await ensureFormat(page);
  await setPreview(page, "print");
  await scrollToPreviewImage(page);
  await begin("02-wrap-contour-preview");
  await record(page, 1.75);

  // --- DROP CAP FONTS ---
  // Remove illustration so drop cap page is clean.
  await ensureWrite(page);
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".manuscript-editor");
    const fig = editor?.querySelector<HTMLElement>(".editor-illustration");
    if (fig && editor) {
      fig.remove();
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    }
  });
  await pause(500);
  await ensureFormat(page);
  await firstChapter(page);
  await setPreview(page, "print");
  await scrollToChapterTop(page);

  const fonts = [
    ["03-dropcap-jena", "Folio Jena Gotisch"],
    ["04-dropcap-manufacturing", "Folio Manufacturing Consent"],
    ["05-dropcap-kings", "Folio Kings"],
    ["06-dropcap-altenglisch", "Folio CAT Altenglisch"],
    ["07-dropcap-slavkappen", "Folio Slavkappen"],
  ] as const;

  for (const [name, font] of fonts) {
    await openStyles(page);
    await selectStyleCategory(page, "First Paragraph");
    await setDropcapFont(page, font);
    await closeStyles(page);
    await scrollToChapterTop(page);
    await begin(name);
    await record(page, .72);
  }
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

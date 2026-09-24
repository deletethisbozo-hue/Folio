
import express from "express";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

const FPS = 24;
const out = path.join(ROOT, "build", "promo-v49-polish");
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
async function begin(name: string) {
  scene = name;
  frame = 0;
  await fs.mkdir(path.join(out, name), { recursive: true });
}
async function shot(page: any) {
  await page.screenshot({
    path: path.join(out, scene, "frame-" + String(frame++).padStart(5, "0") + ".jpg"),
    type: "jpeg",
    quality: 94,
    captureBeyondViewport: false,
  });
}
async function record(page: any, seconds: number) {
  const n = Math.max(1, Math.round(seconds * FPS));
  for (let i = 0; i < n; i++) await shot(page);
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
    await pause(200);
  }
}
async function ensureFormat(page: any) {
  const mode = await page.$eval(".folio-shell", (e: Element) => (e as HTMLElement).dataset.workspaceMode);
  if (mode !== "format") {
    await page.click(".workspace-mode-switch button:nth-child(2)");
    await page.waitForSelector('.folio-shell[data-workspace-mode="format"]');
    await waitPreview(page);
    await pause(220);
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
  await pause(260);
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
  await pause(260);
}
async function chooseTheme(page: any, label: string) {
  const ok = await page.evaluate((label: string) => {
    const card = [...document.querySelectorAll<HTMLButtonElement>(".theme-sample")].find((n) =>
      (n.querySelector(".theme-name")?.textContent ?? "").trim().toLowerCase() === label.toLowerCase()
    );
    if (!card) return false;
    card.click();
    return true;
  }, label);
  if (!ok) throw new Error("Missing theme " + label);
  await pause(360);
}
async function scrollPrintChapter(page: any) {
  const title = await page.$eval(".chapter-row.selected .chapter-label", (e: Element) => e.textContent?.trim() ?? "");
  await page.evaluate((title: string) => {
    const f = document.querySelector<HTMLIFrameElement>(".preview-frame");
    const doc = f?.contentDocument;
    if (!doc) return;
    const pages = [...doc.querySelectorAll<HTMLElement>(".pagedjs_page")];
    let idx = pages.findIndex((p) => [...p.querySelectorAll<HTMLElement>("section.chapter h1,h1.chapter")]
      .some((h) => (h.innerText ?? "").toLowerCase().includes(title.toLowerCase())));
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

  // --- TEXT WRAP: custom transparent editorial illustration, inserted mid-prose.
  await openSample(page);
  await ensureWrite(page);
  await setSidebar(page, true);
  await firstChapter(page);
  await setSidebar(page, false);

  const artBase64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 760; canvas.height = 900;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.strokeStyle = "#25272c";
    ctx.fillStyle = "#25272c";
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // curved botanical stem
    ctx.beginPath();
    for (let i=0;i<=160;i++) {
      const t=i/160;
      const x=365 + 95*Math.sin(t*Math.PI*1.22) - 28*t;
      const y=820 - 660*t;
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();

    // leaves
    const ts=[.16,.25,.34,.44,.54,.64,.73];
    ts.forEach((t,k)=>{
      const x=365 + 95*Math.sin(t*Math.PI*1.22) - 28*t;
      const y=820 - 660*t;
      const side=k%2===0?-1:1;
      const cx=x+side*(58+k*5), cy=y-10;
      ctx.beginPath();
      ctx.moveTo(x,y);
      ctx.quadraticCurveTo(cx-side*15,cy-54,cx+side*60,cy-18);
      ctx.quadraticCurveTo(cx-side*12,cy+35,x,y);
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(cx+side*40,cy-12); ctx.stroke();
    });

    // clockwork gear
    const gx=420, gy=150, r=105, teeth=14;
    ctx.beginPath();
    for (let i=0;i<teeth*2;i++) {
      const a=i*Math.PI/teeth-Math.PI/2;
      const rr=r+(i%2===0?18:0);
      const x=gx+Math.cos(a)*rr, y=gy+Math.sin(a)*rr;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.arc(gx,gy,72,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(gx,gy,28,0,Math.PI*2); ctx.stroke();
    [0,Math.PI/2,Math.PI,3*Math.PI/2].forEach(a=>{
      ctx.beginPath(); ctx.moveTo(gx+Math.cos(a)*32,gy+Math.sin(a)*32); ctx.lineTo(gx+Math.cos(a)*70,gy+Math.sin(a)*70); ctx.stroke();
    });
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const artPath = path.join(out, "wrap-demo.png");
  await fs.writeFile(artPath, Buffer.from(artBase64, "base64"));

  // Put caret after first substantial paragraph, then upload.
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".manuscript-editor")!;
    const paras=[...editor.querySelectorAll<HTMLElement>("p")].filter(p=>(p.innerText??"").trim().length>60);
    const p=paras[1] ?? paras[0];
    if(!p) throw new Error("No paragraph for wrap demo");
    p.scrollIntoView({block:"center",behavior:"auto"});
    const node=p.lastChild ?? p;
    const range=document.createRange();
    range.selectNodeContents(p); range.collapse(false);
    const sel=window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range);
    editor.focus();
    editor.dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));
  });
  await pause(180);
  const input = await page.$(".illustration-input");
  if (!input) throw new Error("Illustration input missing");
  await input.uploadFile(artPath);
  await page.waitForSelector(".editor-illustration img[data-folio-asset]");
  await page.evaluate(() => {
    const editor=document.querySelector<HTMLElement>(".manuscript-editor")!;
    const fig=editor.querySelector<HTMLElement>(".editor-illustration")!;
    const paras=[...editor.querySelectorAll<HTMLElement>("p")].filter(p=>(p.innerText??"").trim().length>60);
    const anchor=paras[2] ?? paras[1];
    if(anchor) editor.insertBefore(fig,anchor);
    fig.dataset.folioScale="38";
    fig.dataset.folioWrap="none";
    fig.dataset.folioShape="contour";
    fig.dataset.folioGap="55";
    fig.style.width="38%";
    fig.scrollIntoView({block:"center",behavior:"auto"});
    editor.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertReplacementText"}));
  });
  await pause(500);
  await page.click(".editor-illustration img[data-folio-asset]");
  await page.waitForSelector('.folio-image-inspector[data-open="true"]');

  await begin("01-wrap-before");
  await record(page, .70);
  await page.click('[data-folio-wrap-choice="left"]');
  await pause(330);
  await begin("02-wrap-box");
  await record(page, .82);
  await page.click('[data-folio-shape-choice="contour"]');
  await pause(430);
  await begin("03-wrap-contour");
  await record(page, 1.55);

  // --- THEMES: clean the temporary illustration, then use the same stable sample.
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".manuscript-editor");
    const fig = editor?.querySelector<HTMLElement>(".editor-illustration");
    if (fig && editor) {
      fig.remove();
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    }
    document.body.click();
  });
  await pause(320);
  await ensureFormat(page);
  await firstChapter(page);
  await setPreview(page, "print");
  await scrollPrintChapter(page);

  await openStyles(page);
  await begin("04-theme-gallery");
  await record(page, 1.10);

  await chooseTheme(page, "Blackletter");
  await closeStyles(page);
  await scrollPrintChapter(page);
  await begin("05-theme-blackletter-print");
  await record(page, 1.05);

  await openStyles(page);
  await chooseTheme(page, "Witchlight");
  await closeStyles(page);
  await scrollPrintChapter(page);
  await begin("06-theme-witchlight-print");
  await record(page, 1.05);

  await openStyles(page);
  await chooseTheme(page, "Cathedral");
  await closeStyles(page);
  await scrollPrintChapter(page);
  await begin("07-theme-cathedral-print");
  await record(page, 1.20);
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

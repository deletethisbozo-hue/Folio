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
const out = path.join(ROOT, "build", "promo-v47-hero");
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

let scene = ""; let frame = 0;
async function begin(name:string){ scene=name; frame=0; await fs.mkdir(path.join(out,name),{recursive:true}); }
async function shot(page:any){ const f=path.join(out,scene,"frame-"+String(frame++).padStart(5,"0")+".jpg"); await page.screenshot({path:f,type:"jpeg",quality:94,captureBeyondViewport:false}); }
async function record(page:any,seconds:number){ const n=Math.max(1,Math.round(seconds*FPS)); for(let i=0;i<n;i++) await shot(page); }
async function pause(ms:number){ await new Promise(r=>setTimeout(r,ms)); }
async function waitPreview(page:any){
  await page.waitForSelector(".preview-frame");
  await page.waitForFunction(()=>{ const f=document.querySelector<HTMLIFrameElement>(".preview-frame"); const t=f?.contentDocument?.body?.innerText?.replace(/\s+/g," ").trim()??""; const l=document.querySelector<HTMLElement>(".preview-loading"); const busy=Boolean(l&&getComputedStyle(l).display!=="none"&&getComputedStyle(l).visibility!=="hidden"); return t.length>120&&!busy; },{timeout:60000});
}
async function openSample(page:any){
  await page.evaluate(()=>{ const b=[...document.querySelectorAll<HTMLButtonElement>(".start-actions button")].find(n=>n.textContent?.includes("Open Sample")); if(!b) throw new Error("Open Sample missing"); b.click(); });
  await page.waitForSelector(".folio-shell"); await waitPreview(page); await pause(300);
}
async function write(page:any){ const m=await page.$eval(".folio-shell",(e:Element)=>(e as HTMLElement).dataset.workspaceMode); if(m!=="write"){ await page.click(".workspace-mode-switch button:first-child"); await page.waitForSelector(".folio-shell[data-workspace-mode=\"write\"]"); await pause(220);} }
async function format(page:any){ const m=await page.$eval(".folio-shell",(e:Element)=>(e as HTMLElement).dataset.workspaceMode); if(m!=="format"){ await page.click(".workspace-mode-switch button:nth-child(2)"); await page.waitForSelector(".folio-shell[data-workspace-mode=\"format\"]"); await waitPreview(page); await pause(220);} }
async function firstChapter(page:any){ await page.evaluate(()=>document.querySelector<HTMLButtonElement>(".contents-row.chapter-row")?.click()); await page.waitForFunction(()=>Boolean(document.querySelector(".contents-row.chapter-row.selected"))); await pause(250); }
async function setPreview(page:any,value:string){ await page.select("select[aria-label=\"Preview device\"]",value); await waitPreview(page); await pause(280); }
async function openStyles(page:any){ await page.click("[data-command=\"design\"]"); await page.waitForSelector(".style-library[aria-label=\"Book style library\"]"); await pause(250); }
async function chooseTheme(page:any,label:string){ const ok=await page.evaluate((label:string)=>{ const c=[...document.querySelectorAll<HTMLButtonElement>(".theme-sample")].find(n=>(n.querySelector(".theme-name")?.textContent??"").trim().toLowerCase()===label.toLowerCase()); if(!c) return false; c.click(); return true; },label); if(!ok) throw new Error("Theme missing "+label); await pause(360); }
async function scrollPrintChapter(page:any,body:boolean){
  const title=await page.$eval(".chapter-row.selected .chapter-label",(e:Element)=>e.textContent?.trim()??"");
  await page.evaluate(({title,body}:{title:string,body:boolean})=>{
    const f=document.querySelector<HTMLIFrameElement>(".preview-frame"); const doc=f?.contentDocument; if(!doc) return;
    const pages=[...doc.querySelectorAll<HTMLElement>(".pagedjs_page")];
    let idx=pages.findIndex(p=>{ const h=[...p.querySelectorAll<HTMLElement>("section.chapter h1,h1.chapter")].map(x=>x.innerText.trim()); return h.some(x=>x.toLowerCase().includes(title.toLowerCase())); });
    if(idx<0) idx=pages.findIndex(p=>Boolean(p.querySelector("section.chapter")));
    if(idx<0) idx=Math.min(2,pages.length-1);
    const target=pages[Math.min(pages.length-1,Math.max(0,idx+(body?1:0)))]; target?.scrollIntoView({block:"start",behavior:"auto"});
  },{title,body}); await pause(450);
}

try {
  const browser=await getBrowser(); const page=await browser.newPage(); page.setDefaultTimeout(120000);
  await page.setViewport({width:CSS_W,height:CSS_H,deviceScaleFactor:2});
  await page.goto(base,{waitUntil:"networkidle0"}); await page.waitForSelector(".start-shell .start-brand");
  await page.addStyleTag({content:"*{cursor:none!important}html,body{background:#f2f3f5!important}"});
  await openSample(page);

  // SPLIT HERO: two named chapters visible at once.
  await write(page);
  const sidebar=await page.$eval(".folio-shell",(e:Element)=>(e as HTMLElement).dataset.writeSidebar);
  if(sidebar!=="open"){ await page.click(".write-sidebar-toggle"); await page.waitForSelector(".folio-shell[data-write-sidebar=\"open\"]"); }
  await firstChapter(page);
  await page.click(".library-collapse-button"); await page.waitForSelector(".folio-shell[data-write-sidebar=\"closed\"]");
  await page.click(".editor-split-toggle"); await page.waitForSelector(".folio-shell[data-split-view=\"true\"] .writing-split-pane");
  await page.waitForFunction(()=>(document.querySelector(".writing-split-editor")?.textContent?.trim().length??0)>60);
  await page.evaluate(()=>{ const s=document.querySelector<HTMLSelectElement>("select[aria-label=\"Split editor section\"]"); if(!s) return; const opts=[...s.options]; const chapter=opts.find(o=>/The Garden|The Mechanism/i.test(o.text))??opts[0]; if(chapter){s.value=chapter.value;s.dispatchEvent(new Event("change",{bubbles:true}));} });
  await page.waitForFunction(()=>(document.querySelector(".writing-split-editor")?.textContent?.trim().length??0)>60);
  await page.evaluate(()=>{ const l=document.querySelector<HTMLElement>(".manuscript-editor"); const r=document.querySelector<HTMLElement>(".writing-split-editor"); if(l) l.scrollTop=Math.max(0,l.scrollHeight*.18); if(r) r.scrollTop=Math.max(0,r.scrollHeight*.20); });
  await pause(300); await begin("01-split-hero"); await record(page,2.6);
  await page.click(".editor-split-toggle"); await page.waitForSelector(".folio-shell[data-split-view=\"false\"]");

  // THEMES HERO: real gallery with multiple visibly different themes.
  await format(page); await setPreview(page,"kindle-6-8"); await openStyles(page);
  await begin("02-themes-hero"); await record(page,1.0); await chooseTheme(page,"Blackletter"); await record(page,.7); await chooseTheme(page,"Witchlight"); await record(page,.7); await chooseTheme(page,"Cathedral"); await record(page,.9);
  await page.click(".style-library-header button[aria-label=\"Close\"]"); await page.waitForFunction(()=>!document.querySelector(".style-library")); await waitPreview(page); await pause(220);
  await begin("03-theme-result-hero"); await record(page,1.4);

  // DEVICE PREVIEW HERO.
  await begin("04-device-hero"); await setPreview(page,"kindle-6-8"); await record(page,.7); await setPreview(page,"phone-6-7"); await record(page,.8); await setPreview(page,"tablet-11"); await record(page,.8);

  // PRINT HERO: actual chapter opener and body page, never TOC.
  await firstChapter(page); await setPreview(page,"print"); await scrollPrintChapter(page,false);
  await begin("05-print-chapter-hero"); await record(page,1.5);
  await scrollPrintChapter(page,true); await begin("06-print-body-hero"); await record(page,1.5);

  // EXPORT HERO: menu plus real Print PDF generation.
  await page.click(".generate-button"); await page.waitForSelector(".generate-menu"); await begin("07-export-hero"); await record(page,1.4);
  await page.evaluate(()=>{ const b=[...document.querySelectorAll<HTMLButtonElement>(".generate-menu button")].find(n=>n.textContent?.trim()==="Print PDF"); b?.click(); });
  await pause(120); await begin("08-print-pdf-hero"); await record(page,.7);
  await page.waitForFunction(()=>/✓|\.pdf|failed|error/i.test(document.querySelector(".generate-status")?.textContent??""),{timeout:120000}); await record(page,1.3);
} finally { await closeBrowser().catch(()=>undefined); await new Promise<void>(resolve=>server.close(()=>resolve())); }
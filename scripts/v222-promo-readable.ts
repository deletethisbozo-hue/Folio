import express from "express";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

const FPS = 24;
const WIDTH = 1920;
const HEIGHT = 1080;
const out = path.join(ROOT, "build", "promo-v222-readable");
const frames = path.join(out, "frames");
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(frames, { recursive: true });

const app = express();
app.use(express.json({ limit: "5mb" }));
registerApi(app);
registerEditorApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_request, response) => response.sendFile(path.join(ROOT, "web", "dist", "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;

let frame = 0;
function framePath() {
  return path.join(frames, "frame-" + String(frame++).padStart(5, "0") + ".jpg");
}
async function shot(page: any) {
  await page.screenshot({ path: framePath(), type: "jpeg", quality: 86, captureBeyondViewport: false });
}
async function capture(page: any, seconds: number, update?: (t: number) => Promise<void> | void) {
  const total = Math.max(1, Math.round(seconds * FPS));
  for (let i = 0; i < total; i += 1) {
    const t = total === 1 ? 1 : i / (total - 1);
    if (update) await update(t);
    await shot(page);
  }
}
function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

type Camera = { scale: number; cx: number; cy: number };
let camera: Camera = { scale: 1, cx: WIDTH / 2, cy: HEIGHT / 2 };

async function setCamera(page: any, next: Camera) {
  camera = next;
  const tx = WIDTH / 2 - next.cx * next.scale;
  const ty = HEIGHT / 2 - next.cy * next.scale;
  await page.evaluate(({ tx, ty, scale }: { tx: number; ty: number; scale: number }) => {
    const root = document.getElementById("root");
    if (!root) throw new Error("Folio root missing");
    root.style.transformOrigin = "0 0";
    root.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + scale + ")";
  }, { tx, ty, scale: next.scale });
}
async function selectorCenterInOriginal(page: any, selector: string) {
  const rect = await page.$eval(selector, (el: Element) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const tx = WIDTH / 2 - camera.cx * camera.scale;
  const ty = HEIGHT / 2 - camera.cy * camera.scale;
  return { x: (rect.x - tx) / camera.scale, y: (rect.y - ty) / camera.scale };
}
async function animateCamera(page: any, target: Camera, seconds: number) {
  const start = { ...camera };
  await capture(page, seconds, async (t) => {
    const e = smooth(t);
    await setCamera(page, {
      scale: start.scale + (target.scale - start.scale) * e,
      cx: start.cx + (target.cx - start.cx) * e,
      cy: start.cy + (target.cy - start.cy) * e,
    });
  });
}
async function focusCamera(page: any, selector: string, scale = 1.10, seconds = 0.42) {
  const center = await selectorCenterInOriginal(page, selector);
  await animateCamera(page, { scale, cx: center.x, cy: center.y }, seconds);
}
async function resetCamera(page: any, seconds = 0.30) {
  await animateCamera(page, { scale: 1, cx: WIDTH / 2, cy: HEIGHT / 2 }, seconds);
}

async function injectPromoLayer(page: any) {
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.id = "folio-promo-readable-style";
    style.textContent = [
      "html,body{overflow:hidden!important;background:#ece9e2!important}",
      "#root{will-change:transform}",
      "#promo-titlecard,#promo-label,#promo-dim{position:fixed;pointer-events:none;z-index:2147483646;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
      "#promo-titlecard{inset:0;display:none;place-items:center;background:#efebe4;color:#211e1b}",
      "#promo-titlecard.dark{background:#1c1a18;color:#f4f0e8}",
      "#promo-titlecard .lock{text-align:center;transform:translateY(-2vh)}",
      "#promo-titlecard .eyebrow{font-size:15px;letter-spacing:.28em;text-transform:uppercase;opacity:.52;margin-bottom:22px}",
      "#promo-titlecard .title{font-family:Georgia,'Times New Roman',serif;font-size:104px;line-height:.88;letter-spacing:-5px;font-weight:600}",
      "#promo-titlecard .subtitle{margin-top:26px;font-size:24px;letter-spacing:.01em;opacity:.68}",
      "#promo-label{left:52px;bottom:52px;display:none;width:420px;padding:18px 22px 20px;background:rgba(27,24,22,.90);color:#fff;border-radius:14px;box-shadow:0 14px 38px rgba(0,0,0,.18)}",
      "#promo-label .kicker{font-size:12px;letter-spacing:.22em;text-transform:uppercase;opacity:.54;margin-bottom:7px}",
      "#promo-label .headline{font-size:25px;font-weight:720;letter-spacing:-.025em}",
      "#promo-label .sub{margin-top:5px;font-size:15px;line-height:1.4;opacity:.69}",
      "#promo-dim{inset:0;display:none;background:#171513;opacity:0}"
    ].join("");
    document.head.appendChild(style);

    const card = document.createElement("div");
    card.id = "promo-titlecard";
    document.body.appendChild(card);

    const label = document.createElement("div");
    label.id = "promo-label";
    document.body.appendChild(label);

    const dim = document.createElement("div");
    dim.id = "promo-dim";
    document.body.appendChild(dim);
  });
}

async function titleCard(page: any, eyebrow: string, title: string, subtitle: string, dark = false) {
  await page.evaluate(({ eyebrow, title, subtitle, dark }: { eyebrow: string; title: string; subtitle: string; dark: boolean }) => {
    const el = document.getElementById("promo-titlecard")!;
    el.className = dark ? "dark" : "";
    el.innerHTML =
      '<div class="lock"><div class="eyebrow">' + eyebrow + '</div><div class="title">' + title + '</div><div class="subtitle">' + subtitle + '</div></div>';
    el.style.display = "grid";
    el.style.opacity = "1";
  }, { eyebrow, title, subtitle, dark });
}
async function hideTitleCard(page: any) {
  await page.evaluate(() => {
    const el = document.getElementById("promo-titlecard");
    if (el) el.style.display = "none";
  });
}
async function fadeTitleCard(page: any, from: number, to: number, seconds: number) {
  await capture(page, seconds, async (t) => {
    const opacity = from + (to - from) * smooth(t);
    await page.evaluate((opacity: number) => {
      const el = document.getElementById("promo-titlecard");
      if (el) el.style.opacity = String(opacity);
    }, opacity);
  });
}
async function showLabel(page: any, kicker: string, headline: string, sub: string) {
  await page.evaluate(({ kicker, headline, sub }: { kicker: string; headline: string; sub: string }) => {
    const el = document.getElementById("promo-label")!;
    el.innerHTML = '<div class="kicker">' + kicker + '</div><div class="headline">' + headline + '</div><div class="sub">' + sub + '</div>';
    el.style.display = "block";
    el.style.opacity = "0";
    el.style.transform = "translateY(12px)";
  }, { kicker, headline, sub });
  await capture(page, 0.18, async (t) => {
    const e = smooth(t);
    await page.evaluate((e: number) => {
      const el = document.getElementById("promo-label")!;
      el.style.opacity = String(e);
      el.style.transform = "translateY(" + (12 * (1 - e)) + "px)";
    }, e);
  });
}
async function hideLabel(page: any) {
  await capture(page, 0.14, async (t) => {
    await page.evaluate((t: number) => {
      const el = document.getElementById("promo-label")!;
      el.style.opacity = String(1 - t);
    }, t);
  });
  await page.evaluate(() => {
    const el = document.getElementById("promo-label");
    if (el) el.style.display = "none";
  });
}
async function softCut(page: any, midpointAction?: () => Promise<void>) {
  await page.evaluate(() => {
    const el = document.getElementById("promo-dim")!;
    el.style.display = "block";
    el.style.opacity = "0";
  });
  await capture(page, 0.13, async (t) => {
    await page.evaluate((t: number) => {
      document.getElementById("promo-dim")!.style.opacity = String(0.42 * (t * t * (3 - 2 * t)));
    }, t);
  });
  if (midpointAction) await midpointAction();
  await capture(page, 0.13, async (t) => {
    await page.evaluate((t: number) => {
      document.getElementById("promo-dim")!.style.opacity = String(0.42 * (1 - (t * t * (3 - 2 * t))));
    }, t);
  });
  await page.evaluate(() => {
    document.getElementById("promo-dim")!.style.display = "none";
  });
}

async function waitPreview(page: any) {
  await page.waitForSelector(".preview-frame");
  await page.waitForFunction(() => {
    const frame = document.querySelector<HTMLIFrameElement>(".preview-frame");
    const text = frame?.contentDocument?.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
    const loading = document.querySelector<HTMLElement>(".preview-loading");
    const visible = Boolean(loading && getComputedStyle(loading).display !== "none" && getComputedStyle(loading).visibility !== "hidden");
    return text.length > 120 && !visible;
  }, { timeout: 60_000 });
}
async function click(page: any, selector: string) {
  await page.click(selector);
  await capture(page, 0.08);
}
async function setPreview(page: any, value: string) {
  await page.select('select[aria-label="Preview device"]', value);
  await waitPreview(page);
}
async function centerTypewriterCaret(page: any) {
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".manuscript-editor");
    if (!editor) throw new Error("Manuscript editor missing");
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let target: Text | null = null;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.data.trim().length > 10) target = node;
    }
    if (!target) return;
    editor.focus();
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(target, Math.max(1, target.length - 1));
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    editor.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "ArrowDown" }));
  });
  await new Promise((resolve) => setTimeout(resolve, 180));
}

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(60_000);
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.waitForSelector(".start-shell .start-brand");
  await injectPromoLayer(page);
  await setCamera(page, camera);

  // Keep the strong opening from the previous cut.
  await titleCard(page, "", "WRITE.", "", true);
  await capture(page, 0.38);
  await titleCard(page, "", "FORMAT.", "", true);
  await capture(page, 0.38);
  await titleCard(page, "", "PUBLISH.", "", true);
  await capture(page, 0.38);
  await titleCard(page, "A desktop book studio for Windows", "Folio", "From manuscript to finished book.", false);
  await capture(page, 0.78);
  await fadeTitleCard(page, 1, 0, 0.34);
  await hideTitleCard(page);

  // Dashboard. One deliberate push, no whip.
  await capture(page, 0.45);
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".start-actions button")]
      .find((node) => node.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample missing");
    button.dataset.promo = "open-sample";
  });
  await focusCamera(page, '[data-promo="open-sample"]', 1.08, 0.35);
  await capture(page, 0.20);
  await click(page, '[data-promo="open-sample"]');
  await page.waitForSelector('.folio-shell[data-workspace-mode="format"]');
  await waitPreview(page);
  await setCamera(page, { scale: 1, cx: WIDTH / 2, cy: HEIGHT / 2 });

  // Feature 1: live preview. Hold long enough to read it.
  await showLabel(page, "FORMAT", "Live book preview", "See the page while you edit. No export-and-check loop.");
  await capture(page, 0.75);
  await focusCamera(page, ".reader-device", 1.10, 0.42);
  await capture(page, 1.15);
  await resetCamera(page, 0.30);
  await hideLabel(page);

  // Feature 2: device previews. State change, then settle.
  await showLabel(page, "PREVIEW", "Kindle, phone, tablet and print", "Switch targets without leaving the project.");
  await capture(page, 0.45);
  await setPreview(page, "phone-6-7");
  await capture(page, 0.90);
  await setPreview(page, "tablet-11");
  await capture(page, 0.90);
  await setPreview(page, "kindle-6-8");
  await capture(page, 0.55);
  await hideLabel(page);

  // Feature 3: book styles. Show the library clearly, then the result in preview.
  await softCut(page, async () => {
    await click(page, '[data-command="design"]');
    await page.waitForSelector('.style-library[aria-label="Book style library"]');
  });
  await showLabel(page, "DESIGN", "Book styles with real typography", "Choose a visual direction, then refine it.");
  await capture(page, 0.70);
  const themeCount = await page.evaluate(() => {
    const themes = [...document.querySelectorAll<HTMLButtonElement>(".theme-sample")];
    const candidate = themes.find((node, index) => index >= 3 && !node.classList.contains("selected"))
      ?? themes.find((node) => !node.classList.contains("selected"));
    if (!candidate) throw new Error("Alternate theme missing");
    candidate.dataset.promo = "theme-choice";
    return themes.length;
  });
  await focusCamera(page, ".theme-gallery", 1.06, 0.30);
  await capture(page, 0.55);
  await click(page, '[data-promo="theme-choice"]');
  await capture(page, 0.70);
  await resetCamera(page, 0.24);
  await click(page, '.style-library-header button[aria-label="Close"]');
  await page.waitForFunction(() => !document.querySelector(".style-library"));
  await waitPreview(page);
  await capture(page, 0.72);
  await hideLabel(page);

  // Feature 4: writing studio. Typewriter gets a visible centered caret state.
  await softCut(page, async () => {
    await click(page, '.workspace-mode-switch button:first-child');
    await page.waitForSelector('.folio-shell[data-workspace-mode="write"]');
    const sidebar = await page.$eval(".folio-shell", (el: Element) => (el as HTMLElement).dataset.writeSidebar);
    if (sidebar === "open") {
      await click(page, ".library-collapse-button");
      await page.waitForSelector('.folio-shell[data-write-sidebar="closed"]');
    }
  });
  await showLabel(page, "WRITE", "Typewriter mode", "The active line stays where your eyes are.");
  await capture(page, 0.55);
  await click(page, ".editor-typewriter-toggle");
  await page.waitForSelector('.folio-shell[data-typewriter-mode="true"]');
  await centerTypewriterCaret(page);
  await capture(page, 1.15);
  await hideLabel(page);

  // Split View. Full UI, no oversized zoom.
  await showLabel(page, "WRITE", "Split View", "Work on two sections without losing your place.");
  await click(page, ".editor-split-toggle");
  await page.waitForSelector('.folio-shell[data-split-view="true"] .writing-split-pane');
  await page.waitForFunction(() => (document.querySelector(".writing-split-editor")?.textContent?.trim().length ?? 0) > 60);
  await capture(page, 1.65);
  await hideLabel(page);

  // Focus mode. Show the transition and then just let the clean editor breathe.
  await showLabel(page, "WRITE", "Focus mode", "Strip the interface back to the manuscript.");
  await click(page, ".editor-focus-toggle");
  await page.waitForSelector('.folio-shell[data-focus-mode="true"]');
  await capture(page, 1.55);
  await hideLabel(page);

  // Leave focus/split, then briefly show manuscript structure.
  await page.keyboard.press("Escape");
  await page.waitForSelector('.folio-shell[data-focus-mode="false"]');
  if ((await page.$eval(".folio-shell", (el: Element) => (el as HTMLElement).dataset.splitView)) === "true") {
    await click(page, ".editor-split-toggle");
    await page.waitForSelector('.folio-shell[data-split-view="false"]');
  }
  if ((await page.$eval(".folio-shell", (el: Element) => (el as HTMLElement).dataset.writeSidebar)) !== "open") {
    await click(page, ".write-sidebar-toggle");
    await page.waitForSelector('.folio-shell[data-write-sidebar="open"]');
  }
  await showLabel(page, "STRUCTURE", "Your whole book in one place", "Chapters, front matter and back matter stay organized.");
  await focusCamera(page, ".library-pane", 1.08, 0.34);
  await capture(page, 1.10);
  await resetCamera(page, 0.25);
  await hideLabel(page);

  // Feature 5: Print preview. Important for a formatter and visually distinct.
  await softCut(page, async () => {
    await click(page, '.workspace-mode-switch button:nth-child(2)');
    await page.waitForSelector('.folio-shell[data-workspace-mode="format"]');
    await setPreview(page, "print");
  });
  await showLabel(page, "PRINT", "Paginated print preview", "Check the actual page flow before you export.");
  await capture(page, 0.70);
  await focusCamera(page, ".preview-stage", 1.08, 0.38);
  await capture(page, 1.35);
  await resetCamera(page, 0.25);
  await hideLabel(page);

  // Feature 6: Export. Let the menu stay legible.
  await showLabel(page, "PUBLISH", "Export for the platform you need", "EPUB, Print PDF, Reading PDF and DOCX.");
  await click(page, ".generate-button");
  await page.waitForSelector(".generate-menu");
  await capture(page, 0.55);
  await focusCamera(page, ".generate-menu", 1.10, 0.34);
  await capture(page, 1.30);
  await resetCamera(page, 0.24);
  await hideLabel(page);

  // End card.
  await softCut(page);
  await titleCard(page, "Folio 2.2.2", "Folio", "Write. Format. Publish.", true);
  await page.evaluate(({ themeCount }: { themeCount: number }) => {
    const lock = document.querySelector("#promo-titlecard .lock")!;
    const footer = document.createElement("div");
    footer.style.cssText = "margin-top:38px;font-size:15px;letter-spacing:.18em;text-transform:uppercase;opacity:.45";
    footer.textContent = "Windows · EPUB · PDF · DOCX";
    lock.appendChild(footer);
  }, { themeCount });
  await capture(page, 1.55);

  await fs.writeFile(path.join(out, "frame-count.txt"), String(frame), "utf8");
  await hideTitleCard(page);
  await page.evaluate(() => {
    document.getElementById("promo-label")?.remove();
    document.getElementById("promo-dim")?.remove();
  });
  await setCamera(page, { scale: 1, cx: WIDTH / 2, cy: HEIGHT / 2 });
  await page.screenshot({ path: path.join(out, "poster.png"), type: "png", captureBeyondViewport: false });
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

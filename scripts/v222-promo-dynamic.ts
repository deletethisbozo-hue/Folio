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
const out = path.join(ROOT, "build", "promo-v222-dynamic");
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
  await page.screenshot({ path: framePath(), type: "jpeg", quality: 84, captureBeyondViewport: false });
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
function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3);
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
async function originalCenter(page: any, selector: string) {
  const rect = await page.$eval(selector, (el: Element) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const tx = WIDTH / 2 - camera.cx * camera.scale;
  const ty = HEIGHT / 2 - camera.cy * camera.scale;
  return {
    x: (rect.x - tx) / camera.scale,
    y: (rect.y - ty) / camera.scale,
  };
}
async function animateCamera(page: any, target: { x: number; y: number }, scale: number, seconds: number) {
  const start = { ...camera };
  await capture(page, seconds, async (t) => {
    const e = smooth(t);
    await setCamera(page, {
      scale: start.scale + (scale - start.scale) * e,
      cx: start.cx + (target.x - start.cx) * e,
      cy: start.cy + (target.y - start.cy) * e,
    });
  });
}
async function cameraTo(page: any, selector: string, scale: number, seconds: number) {
  const target = await originalCenter(page, selector);
  await animateCamera(page, target, scale, seconds);
}
async function resetCamera(page: any, seconds = 0.35) {
  await animateCamera(page, { x: WIDTH / 2, y: HEIGHT / 2 }, 1, seconds);
}

async function injectPromoLayer(page: any) {
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.id = "folio-promo-dynamic-style";
    style.textContent = [
      "html,body{overflow:hidden!important;background:#ebe7df!important}",
      "#root{will-change:transform}",
      "#promo-card,#promo-caption,#promo-flash{position:fixed;pointer-events:none;z-index:2147483646;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
      "#promo-card{inset:0;display:none;place-items:center;background:#eee9e1;color:#201d1a}",
      "#promo-card.dark{background:#1c1a18;color:#f3efe8}",
      "#promo-card .lock{text-align:center;transform:translateY(-2vh)}",
      "#promo-card .eyebrow{font-size:15px;letter-spacing:.28em;text-transform:uppercase;opacity:.55;margin-bottom:22px}",
      "#promo-card .title{font-family:Georgia,'Times New Roman',serif;font-size:104px;line-height:.88;letter-spacing:-5px;font-weight:600}",
      "#promo-card .subtitle{margin-top:26px;font-size:24px;letter-spacing:.01em;opacity:.68}",
      "#promo-caption{left:54px;bottom:54px;display:none;min-width:310px;padding:18px 22px 19px;background:rgba(25,23,21,.9);color:#fff;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.2)}",
      "#promo-caption .kicker{font-size:13px;letter-spacing:.22em;text-transform:uppercase;opacity:.55;margin-bottom:7px}",
      "#promo-caption .headline{font-size:26px;font-weight:700;letter-spacing:-.02em}",
      "#promo-caption .sub{margin-top:5px;font-size:15px;opacity:.66}",
      "#promo-flash{inset:0;background:#f4f0e9;display:none;opacity:0}"
    ].join("");
    document.head.appendChild(style);
    const card = document.createElement("div");
    card.id = "promo-card";
    document.body.appendChild(card);
    const caption = document.createElement("div");
    caption.id = "promo-caption";
    document.body.appendChild(caption);
    const flash = document.createElement("div");
    flash.id = "promo-flash";
    document.body.appendChild(flash);
  });
}

async function showCard(page: any, eyebrow: string, title: string, subtitle: string, dark = false) {
  await page.evaluate(({ eyebrow, title, subtitle, dark }: { eyebrow: string; title: string; subtitle: string; dark: boolean }) => {
    const card = document.getElementById("promo-card")!;
    card.className = dark ? "dark" : "";
    card.innerHTML =
      '<div class="lock"><div class="eyebrow">' + eyebrow + '</div><div class="title">' + title + '</div><div class="subtitle">' + subtitle + '</div></div>';
    card.style.display = "grid";
    card.style.opacity = "1";
  }, { eyebrow, title, subtitle, dark });
}
async function hideCard(page: any) {
  await page.evaluate(() => {
    const card = document.getElementById("promo-card");
    if (card) card.style.display = "none";
  });
}
async function cardFade(page: any, from: number, to: number, seconds: number) {
  await capture(page, seconds, async (t) => {
    const value = from + (to - from) * smooth(t);
    await page.evaluate((opacity: number) => {
      const card = document.getElementById("promo-card");
      if (card) card.style.opacity = String(opacity);
    }, value);
  });
}
async function caption(page: any, kicker: string, headline: string, sub: string, seconds = 1.2) {
  await page.evaluate(({ kicker, headline, sub }: { kicker: string; headline: string; sub: string }) => {
    const el = document.getElementById("promo-caption")!;
    el.innerHTML = '<div class="kicker">' + kicker + '</div><div class="headline">' + headline + '</div><div class="sub">' + sub + '</div>';
    el.style.display = "block";
    el.style.opacity = "0";
    el.style.transform = "translateY(18px)";
  }, { kicker, headline, sub });
  await capture(page, 0.22, async (t) => {
    const e = easeOut(t);
    await page.evaluate((e: number) => {
      const el = document.getElementById("promo-caption")!;
      el.style.opacity = String(e);
      el.style.transform = "translateY(" + (18 * (1 - e)) + "px)";
    }, e);
  });
  await capture(page, seconds);
  await capture(page, 0.18, async (t) => {
    await page.evaluate((t: number) => {
      const el = document.getElementById("promo-caption")!;
      el.style.opacity = String(1 - t);
      el.style.transform = "translateY(" + (8 * t) + "px)";
    }, t);
  });
  await page.evaluate(() => {
    const el = document.getElementById("promo-caption");
    if (el) el.style.display = "none";
  });
}
async function flashCut(page: any) {
  await page.evaluate(() => {
    const el = document.getElementById("promo-flash")!;
    el.style.display = "block";
    el.style.opacity = "0";
  });
  await capture(page, 0.10, async (t) => {
    await page.evaluate((t: number) => {
      document.getElementById("promo-flash")!.style.opacity = String(t);
    }, t);
  });
  await capture(page, 0.08, async (t) => {
    await page.evaluate((t: number) => {
      document.getElementById("promo-flash")!.style.opacity = String(1 - t);
    }, t);
  });
  await page.evaluate(() => {
    document.getElementById("promo-flash")!.style.display = "none";
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
  await capture(page, 0.10);
}
async function setPreview(page: any, value: string) {
  await page.select('select[aria-label="Preview device"]', value);
  await waitPreview(page);
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

  // OPEN: three hard beats, then the product name.
  await showCard(page, "", "WRITE.", "", true);
  await capture(page, 0.36);
  await showCard(page, "", "FORMAT.", "", true);
  await capture(page, 0.36);
  await showCard(page, "", "PUBLISH.", "", true);
  await capture(page, 0.36);
  await showCard(page, "A desktop book studio for Windows", "Folio", "From manuscript to finished book.", false);
  await capture(page, 0.62);
  await cardFade(page, 1, 0, 0.34);
  await hideCard(page);

  // DASHBOARD -> SAMPLE, with a fast push-in.
  await capture(page, 0.34);
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".start-actions button")]
      .find((node) => node.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample missing");
    button.dataset.promoTarget = "open-sample";
  });
  await cameraTo(page, '[data-promo-target="open-sample"]', 1.42, 0.42);
  await click(page, '[data-promo-target="open-sample"]');
  await page.waitForSelector('.folio-shell[data-workspace-mode="format"]');
  await waitPreview(page);
  await setCamera(page, { scale: 1, cx: WIDTH / 2, cy: HEIGHT / 2 });
  await flashCut(page);

  // FORMAT: full layout, then punch into the live book preview.
  await capture(page, 0.45);
  await caption(page, "FORMAT", "See the book while you build it", "Live reader preview across devices.", 0.75);
  await cameraTo(page, ".reader-device", 1.31, 0.58);
  await capture(page, 0.48);
  await resetCamera(page, 0.28);
  await cameraTo(page, 'select[aria-label="Preview device"]', 1.58, 0.38);
  await setPreview(page, "phone-6-7");
  await capture(page, 0.58);
  await resetCamera(page, 0.28);
  await cameraTo(page, ".reader-device", 1.24, 0.42);
  await capture(page, 0.46);
  await resetCamera(page, 0.24);

  // DESIGN: fast theme montage with real Folio theme cards.
  await click(page, '[data-command="design"]');
  await page.waitForSelector('.style-library[aria-label="Book style library"]');
  await cameraTo(page, ".theme-gallery", 1.22, 0.46);
  await caption(page, "DESIGN", "A book style, not a template dump", "Choose a direction. Fine-tune the typography.", 0.58);
  const themeTargets = await page.evaluate(() => {
    const themes = [...document.querySelectorAll<HTMLButtonElement>(".theme-sample")];
    const picks = [2, Math.floor(themes.length / 2), Math.max(0, themes.length - 3)]
      .map((i) => themes[Math.min(i, themes.length - 1)])
      .filter(Boolean);
    picks.forEach((node, index) => node.dataset.promoTheme = String(index));
    return picks.length;
  });
  for (let i = 0; i < themeTargets; i += 1) {
    await click(page, '[data-promo-theme="' + i + '"]');
    await capture(page, 0.36);
    if (i < themeTargets - 1) await flashCut(page);
  }
  await resetCamera(page, 0.24);
  await click(page, '.style-library-header button[aria-label="Close"]');
  await page.waitForFunction(() => !document.querySelector(".style-library"));
  await waitPreview(page);
  await flashCut(page);

  // WRITE: switch workspace, then show the three writing modes in quick succession.
  await click(page, '.workspace-mode-switch button:first-child');
  await page.waitForSelector('.folio-shell[data-workspace-mode="write"]');
  await caption(page, "WRITE", "Stay in the manuscript", "Focus, Typewriter and Split View are built into the editor.", 0.64);
  const sidebar = await page.$eval(".folio-shell", (el: Element) => (el as HTMLElement).dataset.writeSidebar);
  if (sidebar === "open") {
    await click(page, ".library-collapse-button");
    await page.waitForSelector('.folio-shell[data-write-sidebar="closed"]');
  }
  await cameraTo(page, ".manuscript-editor", 1.18, 0.48);
  await capture(page, 0.48);
  await resetCamera(page, 0.22);

  await cameraTo(page, ".editor-typewriter-toggle", 1.72, 0.32);
  await click(page, ".editor-typewriter-toggle");
  await page.waitForSelector('.folio-shell[data-typewriter-mode="true"]');
  await capture(page, 0.34);
  await resetCamera(page, 0.20);

  await cameraTo(page, ".editor-split-toggle", 1.72, 0.30);
  await click(page, ".editor-split-toggle");
  await page.waitForSelector('.folio-shell[data-split-view="true"] .writing-split-pane');
  await page.waitForFunction(() => (document.querySelector(".writing-split-editor")?.textContent?.trim().length ?? 0) > 60);
  await setCamera(page, { scale: 1, cx: WIDTH / 2, cy: HEIGHT / 2 });
  await flashCut(page);
  await capture(page, 0.72);
  await cameraTo(page, ".writing-split-pane", 1.15, 0.38);
  await capture(page, 0.44);
  await resetCamera(page, 0.20);

  await cameraTo(page, ".editor-focus-toggle", 1.72, 0.28);
  await click(page, ".editor-focus-toggle");
  await page.waitForSelector('.folio-shell[data-focus-mode="true"]');
  await setCamera(page, { scale: 1, cx: WIDTH / 2, cy: HEIGHT / 2 });
  await flashCut(page);
  await cameraTo(page, ".manuscript-editor", 1.17, 0.42);
  await capture(page, 0.68);

  // MANUSCRIPT STRUCTURE: return and punch toward the chapter list.
  await page.keyboard.press("Escape");
  await page.waitForSelector('.folio-shell[data-focus-mode="false"]');
  if ((await page.$eval(".folio-shell", (el: Element) => (el as HTMLElement).dataset.splitView)) === "true") {
    await click(page, ".editor-split-toggle");
    await page.waitForSelector('.folio-shell[data-split-view="false"]');
  }
  await setCamera(page, { scale: 1, cx: WIDTH / 2, cy: HEIGHT / 2 });
  await click(page, ".write-sidebar-toggle");
  await page.waitForSelector('.folio-shell[data-write-sidebar="open"]');
  await cameraTo(page, ".library-pane", 1.32, 0.48);
  await capture(page, 0.68);
  await resetCamera(page, 0.22);

  // PUBLISH: back to Format, export menu, tight zoom.
  await click(page, '.workspace-mode-switch button:nth-child(2)');
  await page.waitForSelector('.folio-shell[data-workspace-mode="format"]');
  await setPreview(page, "kindle-6-8");
  await caption(page, "PUBLISH", "One project. Multiple outputs.", "EPUB, Print PDF, Reading PDF and DOCX.", 0.58);
  await cameraTo(page, ".generate-button", 1.74, 0.36);
  await click(page, ".generate-button");
  await page.waitForSelector(".generate-menu");
  await capture(page, 0.42);
  await cameraTo(page, ".generate-menu", 1.52, 0.38);
  await capture(page, 0.78);
  await resetCamera(page, 0.22);

  // END: simple, high-contrast product card.
  await flashCut(page);
  await showCard(page, "Folio 2.2.2", "Folio", "Write. Format. Publish.", true);
  await page.evaluate(() => {
    const card = document.getElementById("promo-card")!;
    const lock = card.querySelector(".lock")!;
    const footer = document.createElement("div");
    footer.style.cssText = "margin-top:38px;font-size:15px;letter-spacing:.18em;text-transform:uppercase;opacity:.45";
    footer.textContent = "Windows · EPUB · PDF · DOCX";
    lock.appendChild(footer);
  });
  await capture(page, 1.55);

  await fs.writeFile(path.join(out, "frame-count.txt"), String(frame), "utf8");

  // Poster from a strong, real application state.
  await hideCard(page);
  await page.evaluate(() => {
    document.getElementById("promo-caption")?.remove();
    document.getElementById("promo-flash")?.remove();
  });
  await setCamera(page, { scale: 1, cx: WIDTH / 2, cy: HEIGHT / 2 });
  await page.screenshot({ path: path.join(out, "poster.png"), type: "png", captureBeyondViewport: false });
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

import express from "express";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

const FPS = 15;
const WIDTH = 1920;
const HEIGHT = 1080;
const out = path.join(ROOT, "build", "promo-v222");
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
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

let frame = 0;
function framePath() {
  return path.join(frames, `frame-${String(frame++).padStart(5, "0")}.jpg`);
}
async function shot(page: any) {
  await page.screenshot({ path: framePath(), type: "jpeg", quality: 82, captureBeyondViewport: false });
}
async function capture(page: any, seconds: number, update?: (t: number) => Promise<void> | void) {
  const total = Math.max(1, Math.round(seconds * FPS));
  for (let i = 0; i < total; i += 1) {
    const t = total === 1 ? 1 : i / (total - 1);
    if (update) await update(t);
    await shot(page);
  }
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
async function targetCenter(page: any, selector: string) {
  return page.$eval(selector, (el: Element) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
}
let cursor = { x: WIDTH * 0.78, y: HEIGHT * 0.74 };
async function setCursor(page: any, x: number, y: number, down = false) {
  cursor = { x, y };
  await page.evaluate(({ x, y, down }: { x: number; y: number; down: boolean }) => {
    const c = document.getElementById("folio-promo-cursor");
    if (!c) return;
    c.style.left = `${x}px`;
    c.style.top = `${y}px`;
    c.dataset.down = down ? "true" : "false";
  }, { x, y, down });
}
async function moveCursor(page: any, selector: string, seconds = 0.55) {
  const end = await targetCenter(page, selector);
  const start = { ...cursor };
  await capture(page, seconds, async (t) => {
    const e = 1 - Math.pow(1 - t, 3);
    await setCursor(page, start.x + (end.x - start.x) * e, start.y + (end.y - start.y) * e);
  });
  await setCursor(page, end.x, end.y);
}
async function clickWithPulse(page: any, selector: string) {
  const p = await targetCenter(page, selector);
  await setCursor(page, p.x, p.y, true);
  await capture(page, 0.13);
  await page.click(selector);
  await setCursor(page, p.x, p.y, false);
}
async function overlay(page: any, title: string, subtitle: string, footer = "") {
  await page.evaluate(({ title, subtitle, footer }: { title: string; subtitle: string; footer: string }) => {
    let el = document.getElementById("folio-promo-overlay");
    if (!el) {
      el = document.createElement("div");
      el.id = "folio-promo-overlay";
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <div class="promo-lockup">
        <div class="promo-title">${title}</div>
        <div class="promo-subtitle">${subtitle}</div>
        ${footer ? `<div class="promo-footer">${footer}</div>` : ""}
      </div>`;
    el.style.display = "grid";
    el.style.opacity = "1";
  }, { title, subtitle, footer });
}
async function setOverlayOpacity(page: any, opacity: number) {
  await page.evaluate((opacity: number) => {
    const el = document.getElementById("folio-promo-overlay");
    if (el) el.style.opacity = String(opacity);
  }, opacity);
}
async function fadeOverlay(page: any, from: number, to: number, seconds: number) {
  await capture(page, seconds, async (t) => {
    const e = t * t * (3 - 2 * t);
    await setOverlayOpacity(page, from + (to - from) * e);
  });
}
async function injectPromoChrome(page: any) {
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.id = "folio-promo-style";
    style.textContent = `
      html, body { overflow: hidden !important; }
      #folio-promo-overlay {
        position: fixed; inset: 0; z-index: 2147483645; display: none; place-items: center;
        background:
          radial-gradient(circle at 50% 44%, rgba(111,84,64,.08), transparent 34%),
          #f2efe9;
        color: #2c2723; opacity: 1; transition: none; pointer-events: none;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .promo-lockup { text-align: center; transform: translateY(-2vh); }
      .promo-title {
        font-family: Georgia, "Times New Roman", serif; font-size: 84px; line-height: .95;
        letter-spacing: -3px; font-weight: 600;
      }
      .promo-subtitle { margin-top: 24px; font-size: 26px; letter-spacing: .01em; color: #6f6258; }
      .promo-footer { margin-top: 42px; font-size: 17px; letter-spacing: .12em; text-transform: uppercase; color: #8e8177; }
      #folio-promo-cursor {
        position: fixed; z-index: 2147483647; width: 22px; height: 30px; pointer-events: none;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,.25));
        transform: translate(-3px,-2px);
      }
      #folio-promo-cursor::before {
        content: ""; position: absolute; inset: 0; background: #1d1b19;
        clip-path: polygon(0 0, 0 86%, 23% 66%, 39% 100%, 51% 94%, 35% 61%, 67% 61%);
      }
      #folio-promo-cursor::after {
        content: ""; position: absolute; width: 34px; height: 34px; border: 2px solid rgba(67,52,43,.35);
        border-radius: 999px; left: -12px; top: -11px; opacity: 0; transform: scale(.55);
      }
      #folio-promo-cursor[data-down="true"]::after { opacity: 1; transform: scale(1); }
    `;
    document.head.appendChild(style);
    const cursor = document.createElement("div");
    cursor.id = "folio-promo-cursor";
    cursor.style.left = "1500px";
    cursor.style.top = "800px";
    document.body.appendChild(cursor);
  });
}

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(60_000);
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.waitForSelector(".start-shell .start-brand");
  await injectPromoChrome(page);

  // 0–3s: brand card, then reveal the real Folio dashboard underneath.
  await overlay(page, "Folio", "Write. Format. Publish.", "Version 2.2.2 · Windows");
  await capture(page, 1.7);
  await fadeOverlay(page, 1, 0, 0.8);
  await page.evaluate(() => {
    const el = document.getElementById("folio-promo-overlay");
    if (el) el.style.display = "none";
  });
  await capture(page, 0.8);

  // 3–6s: open the bundled sample from the real dashboard.
  const sampleSelector = ".start-actions button:nth-child(4)";
  const sampleExists = await page.$(sampleSelector);
  if (!sampleExists) {
    await page.evaluate(() => {
      const button = [...document.querySelectorAll<HTMLButtonElement>(".start-actions button")]
        .find((node) => node.textContent?.includes("Open Sample"));
      if (!button) throw new Error("Open Sample missing");
      button.dataset.promoTarget = "sample";
    });
  } else {
    await page.$eval(sampleSelector, (el: Element) => (el as HTMLElement).dataset.promoTarget = "sample");
  }
  await moveCursor(page, '[data-promo-target="sample"]', 0.55);
  await clickWithPulse(page, '[data-promo-target="sample"]');
  await page.waitForSelector('.folio-shell[data-workspace-mode="format"]');
  await waitPreview(page);
  await capture(page, 1.5);

  // 6–11s: show the live book-design library and make a visible theme change.
  await moveCursor(page, '[data-command="design"]', 0.45);
  await clickWithPulse(page, '[data-command="design"]');
  await page.waitForSelector('.style-library[aria-label="Book style library"]');
  await capture(page, 0.9);
  const themeSelector = await page.evaluate(() => {
    const themes = [...document.querySelectorAll<HTMLButtonElement>(".theme-sample")];
    const candidate = themes.find((node, index) => index >= 2 && !node.classList.contains("selected")) ?? themes.find((node) => !node.classList.contains("selected"));
    if (!candidate) throw new Error("No alternate theme available");
    candidate.dataset.promoTarget = "theme";
    return '[data-promo-target="theme"]';
  });
  await moveCursor(page, themeSelector, 0.5);
  await clickWithPulse(page, themeSelector);
  await capture(page, 1.1);
  await moveCursor(page, '.style-library-header button[aria-label="Close"]', 0.4);
  await clickWithPulse(page, '.style-library-header button[aria-label="Close"]');
  await page.waitForFunction(() => !document.querySelector(".style-library"));
  await waitPreview(page);
  await capture(page, 1.1);

  // 11–16s: switch into the writing workspace and reveal the manuscript sidebar.
  await moveCursor(page, '.workspace-mode-switch button:first-child', 0.45);
  await clickWithPulse(page, '.workspace-mode-switch button:first-child');
  await page.waitForSelector('.folio-shell[data-workspace-mode="write"]');
  await capture(page, 1.0);
  const sidebarState = await page.$eval(".folio-shell", (el: Element) => (el as HTMLElement).dataset.writeSidebar);
  if (sidebarState !== "open") {
    await moveCursor(page, ".write-sidebar-toggle", 0.4);
    await clickWithPulse(page, ".write-sidebar-toggle");
    await page.waitForSelector('.folio-shell[data-write-sidebar="open"]');
  }
  await capture(page, 1.1);
  await moveCursor(page, ".library-collapse-button", 0.35);
  await clickWithPulse(page, ".library-collapse-button");
  await page.waitForSelector('.folio-shell[data-write-sidebar="closed"]');
  await capture(page, 0.65);

  // 16–22s: Typewriter + Split, using Folio's actual controls.
  await moveCursor(page, ".editor-typewriter-toggle", 0.4);
  await clickWithPulse(page, ".editor-typewriter-toggle");
  await page.waitForSelector('.folio-shell[data-typewriter-mode="true"]');
  await capture(page, 0.85);
  await moveCursor(page, ".editor-split-toggle", 0.4);
  await clickWithPulse(page, ".editor-split-toggle");
  await page.waitForSelector('.folio-shell[data-split-view="true"] .writing-split-pane');
  await page.waitForFunction(() => (document.querySelector(".writing-split-editor")?.textContent?.trim().length ?? 0) > 60);
  await capture(page, 1.8);

  // 22–25s: Focus mode, clean and distraction-free.
  await moveCursor(page, ".editor-focus-toggle", 0.4);
  await clickWithPulse(page, ".editor-focus-toggle");
  await page.waitForSelector('.folio-shell[data-focus-mode="true"]');
  await capture(page, 2.0);

  // 25–29s: back to Format and expose the real export targets.
  await page.keyboard.press("Escape");
  await page.waitForSelector('.folio-shell[data-focus-mode="false"]');
  if ((await page.$eval(".folio-shell", (el: Element) => (el as HTMLElement).dataset.splitView)) === "true") {
    await page.click(".editor-split-toggle");
    await page.waitForSelector('.folio-shell[data-split-view="false"]');
  }
  await moveCursor(page, '.workspace-mode-switch button:nth-child(2)', 0.4);
  await clickWithPulse(page, '.workspace-mode-switch button:nth-child(2)');
  await page.waitForSelector('.folio-shell[data-workspace-mode="format"]');
  await waitPreview(page);
  await capture(page, 0.8);
  await moveCursor(page, ".generate-button", 0.4);
  await clickWithPulse(page, ".generate-button");
  await page.waitForSelector(".generate-menu");
  await capture(page, 1.9);

  // 29–33s: end card.
  await overlay(page, "Folio 2.2.2", "A writing & book-formatting studio for Windows.", "EPUB · PDF · DOCX");
  await setOverlayOpacity(page, 0);
  await fadeOverlay(page, 0, 1, 0.65);
  await capture(page, 2.65);

  await fs.writeFile(path.join(out, "frame-count.txt"), String(frame), "utf8");
  // A clean poster frame from the final app state, useful beside the video.
  await page.evaluate(() => {
    document.getElementById("folio-promo-overlay")?.remove();
    document.getElementById("folio-promo-cursor")?.remove();
  });
  await page.screenshot({ path: path.join(out, "poster.png"), type: "png", captureBeyondViewport: false });
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

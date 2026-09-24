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
const out = path.join(ROOT, "build", "promo-mastercut-source");
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

let currentScene = "";
let sceneFrame = 0;

async function startScene(name: string) {
  currentScene = name;
  sceneFrame = 0;
  await fs.mkdir(path.join(out, name), { recursive: true });
}

async function shot(page: any) {
  const file = path.join(out, currentScene, `frame-${String(sceneFrame++).padStart(5, "0")}.jpg`);
  await page.screenshot({
    path: file,
    type: "jpeg",
    quality: 92,
    captureBeyondViewport: false,
  });
}

async function record(page: any, seconds: number) {
  const count = Math.max(1, Math.round(seconds * FPS));
  for (let i = 0; i < count; i += 1) await shot(page);
}

async function pause(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitPreview(page: any) {
  await page.waitForSelector(".preview-frame");
  await page.waitForFunction(() => {
    const frame = document.querySelector<HTMLIFrameElement>(".preview-frame");
    const text = frame?.contentDocument?.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
    const loading = document.querySelector<HTMLElement>(".preview-loading");
    const visible = Boolean(
      loading &&
      getComputedStyle(loading).display !== "none" &&
      getComputedStyle(loading).visibility !== "hidden"
    );
    return text.length > 120 && !visible;
  }, { timeout: 60_000 });
}

async function setPreview(page: any, value: string) {
  await page.select('select[aria-label="Preview device"]', value);
  await waitPreview(page);
  await pause(220);
}

async function ensureWrite(page: any) {
  const mode = await page.$eval(".folio-shell", (el: Element) => (el as HTMLElement).dataset.workspaceMode);
  if (mode !== "write") {
    await page.click('.workspace-mode-switch button:first-child');
    await page.waitForSelector('.folio-shell[data-workspace-mode="write"]');
    await pause(220);
  }
}

async function ensureFormat(page: any) {
  const mode = await page.$eval(".folio-shell", (el: Element) => (el as HTMLElement).dataset.workspaceMode);
  if (mode !== "format") {
    await page.click('.workspace-mode-switch button:nth-child(2)');
    await page.waitForSelector('.folio-shell[data-workspace-mode="format"]');
    await waitPreview(page);
    await pause(220);
  }
}

async function setSidebar(page: any, open: boolean) {
  const state = await page.$eval(".folio-shell", (el: Element) => (el as HTMLElement).dataset.writeSidebar);
  if ((state === "open") !== open) {
    const selector = open ? ".write-sidebar-toggle" : ".library-collapse-button";
    await page.click(selector);
    await page.waitForSelector(`.folio-shell[data-write-sidebar="${open ? "open" : "closed"}"]`);
    await pause(180);
  }
}

async function setTypewriter(page: any, on: boolean) {
  const state = await page.$eval(".folio-shell", (el: Element) => (el as HTMLElement).dataset.typewriterMode);
  if ((state === "true") !== on) {
    await page.click(".editor-typewriter-toggle");
    await page.waitForSelector(`.folio-shell[data-typewriter-mode="${on ? "true" : "false"}"]`);
    await pause(180);
  }
}

async function setSplit(page: any, on: boolean) {
  const state = await page.$eval(".folio-shell", (el: Element) => (el as HTMLElement).dataset.splitView);
  if ((state === "true") !== on) {
    await page.click(".editor-split-toggle");
    await page.waitForSelector(`.folio-shell[data-split-view="${on ? "true" : "false"}"]`);
    if (on) {
      await page.waitForSelector(".writing-split-pane");
      await page.waitForFunction(() => (document.querySelector(".writing-split-editor")?.textContent?.trim().length ?? 0) > 60);
    }
    await pause(220);
  }
}

async function setFocus(page: any, on: boolean) {
  const state = await page.$eval(".folio-shell", (el: Element) => (el as HTMLElement).dataset.focusMode);
  if ((state === "true") !== on) {
    if (on) {
      await page.click(".editor-focus-toggle");
      await page.waitForSelector('.folio-shell[data-focus-mode="true"]');
    } else {
      await page.keyboard.press("Escape");
      await page.waitForSelector('.folio-shell[data-focus-mode="false"]');
    }
    await pause(220);
  }
}

async function centerTypewriterCaret(page: any) {
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".manuscript-editor");
    if (!editor) return;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.data.trim().length > 25) nodes.push(node);
    }
    const target = nodes[Math.max(0, Math.floor(nodes.length * 0.58))];
    if (!target) return;
    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.setStart(target, Math.min(target.length - 1, Math.max(1, Math.floor(target.length * 0.55))));
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    editor.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "ArrowDown" }));
  });
  await pause(280);
}

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(60_000);
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.waitForSelector(".start-shell .start-brand");

  await page.addStyleTag({
    content: `
      * { cursor: none !important; }
      html, body { background: #f2f3f5 !important; }
      #root { transform: none !important; transform-origin: 0 0 !important; }
    `,
  });

  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".start-actions button")]
      .find((node) => node.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample missing");
    button.dataset.mastercut = "sample";
  });
  await page.click('[data-mastercut="sample"]');
  await page.waitForSelector(".folio-shell");
  await waitPreview(page);
  await pause(350);

  await ensureWrite(page);
  await setSidebar(page, false);
  await setSplit(page, false);
  await setFocus(page, false);
  await setTypewriter(page, false);
  await startScene("01-write-typewriter");
  await record(page, 0.75);
  await setTypewriter(page, true);
  await centerTypewriterCaret(page);
  await record(page, 1.85);

  await setTypewriter(page, false);
  await setSplit(page, false);
  await startScene("02-split-view");
  await record(page, 0.60);
  await setSplit(page, true);
  await record(page, 2.05);

  await setSplit(page, false);
  await setFocus(page, false);
  await startScene("03-focus-mode");
  await record(page, 0.55);
  await setFocus(page, true);
  await record(page, 1.90);
  await setFocus(page, false);

  await setSidebar(page, true);
  await startScene("04-structure");
  await record(page, 1.85);
  await setSidebar(page, false);

  await ensureFormat(page);
  await setPreview(page, "kindle-6-8");
  await page.click('[data-command="design"]');
  await page.waitForSelector('.style-library[aria-label="Book style library"]');
  await pause(300);
  const themeInfo = await page.$$eval(".theme-sample", (nodes: Element[]) =>
    nodes.map((node, index) => ({
      index,
      text: (node.textContent ?? "").replace(/\s+/g, " ").trim(),
      selected: node.classList.contains("selected"),
    }))
  );
  await fs.writeFile(path.join(out, "themes.json"), JSON.stringify(themeInfo, null, 2), "utf8");
  await page.evaluate(() => {
    const nodes = [...document.querySelectorAll<HTMLButtonElement>(".theme-sample")];
    const preferred = /(cathedral|goth|noir|thriller|horror|fantasy|orbit|cosmos|romance|velvet|scriptorium)/i;
    const candidate =
      nodes.find((n) => preferred.test(n.textContent ?? "") && !n.classList.contains("selected")) ??
      nodes.find((n, i) => i >= 5 && !n.classList.contains("selected")) ??
      nodes.find((n) => !n.classList.contains("selected"));
    if (!candidate) throw new Error("No alternate theme available");
    candidate.dataset.mastercut = "theme";
  });
  await startScene("05-design-theme");
  await record(page, 1.05);
  await page.click('[data-mastercut="theme"]');
  await pause(420);
  await record(page, 0.85);
  await page.click('.style-library-header button[aria-label="Close"]');
  await page.waitForFunction(() => !document.querySelector(".style-library"));
  await waitPreview(page);
  await pause(250);
  await record(page, 1.45);

  await startScene("06-device-preview");
  await setPreview(page, "kindle-6-8");
  await record(page, 0.82);
  await setPreview(page, "phone-6-7");
  await record(page, 0.95);
  await setPreview(page, "tablet-11");
  await record(page, 0.95);

  await setPreview(page, "print");
  await pause(300);
  await startScene("07-print-preview");
  await record(page, 2.20);

  await setPreview(page, "kindle-6-8");
  await page.click(".generate-button");
  await page.waitForSelector(".generate-menu");
  await pause(220);
  await startScene("08-export");
  await record(page, 2.05);

  await page.screenshot({
    path: path.join(out, "poster-source.png"),
    type: "png",
    captureBeyondViewport: false,
  });
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

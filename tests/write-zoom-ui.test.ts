import express from "express";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? passed++ : failed++;
};

console.log("\nFolio Write view zoom");

const app = express();
app.use(express.json({ limit: "5mb" }));
registerApi(app);
registerEditorApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "web", "dist", "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(base, { waitUntil: "networkidle0" });

  await page.evaluate(() => {
    localStorage.setItem("folio-write-zoom", "1");
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample button missing");
    (button as HTMLButtonElement).click();
  });
  await page.waitForSelector('.rich-editor[contenteditable="true"]');

  await page.evaluate(() => {
    const write = [...document.querySelectorAll<HTMLButtonElement>(".workspace-mode-switch button")]
      .find((button) => button.textContent?.trim() === "Write");
    write?.click();
  });
  await page.waitForFunction(() => document.querySelector(".folio-shell")?.getAttribute("data-workspace-mode") === "write");

  const baseline = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".manuscript-editor");
    const frame = document.querySelector<HTMLIFrameElement>(".preview-frame");
    const doc = frame?.contentDocument;
    const previewText = doc?.querySelector<HTMLElement>("p");
    const previewDevice = document.querySelector<HTMLElement>(".reader-device");
    return {
      editorFont: editor ? Number.parseFloat(getComputedStyle(editor).fontSize) : 0,
      previewFont: previewText ? Number.parseFloat(getComputedStyle(previewText).fontSize) : 0,
      previewWidth: previewDevice?.getBoundingClientRect().width ?? 0,
      devicePixelRatio: window.devicePixelRatio,
    };
  });
  check("Write starts at 100% view zoom", baseline.editorFont > 0, JSON.stringify(baseline));

  await page.keyboard.down("Control");
  await page.keyboard.press("=");
  await page.keyboard.up("Control");
  await page.waitForFunction(() => document.querySelector(".folio-statusbar")?.textContent?.includes("110%"));

  const plus = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".manuscript-editor");
    const frame = document.querySelector<HTMLIFrameElement>(".preview-frame");
    const doc = frame?.contentDocument;
    const previewText = doc?.querySelector<HTMLElement>("p");
    const previewDevice = document.querySelector<HTMLElement>(".reader-device");
    return {
      editorFont: editor ? Number.parseFloat(getComputedStyle(editor).fontSize) : 0,
      previewFont: previewText ? Number.parseFloat(getComputedStyle(previewText).fontSize) : 0,
      previewWidth: previewDevice?.getBoundingClientRect().width ?? 0,
      stored: localStorage.getItem("folio-write-zoom"),
      devicePixelRatio: window.devicePixelRatio,
    };
  });

  check("Ctrl++ magnifies only the Write editor",
    plus.editorFont > baseline.editorFont * 1.08 &&
    Math.abs(plus.previewFont - baseline.previewFont) < 0.01 &&
    Math.abs(plus.previewWidth - baseline.previewWidth) < 0.5 &&
    plus.devicePixelRatio === baseline.devicePixelRatio,
    JSON.stringify({ baseline, plus }));

  const editorBox = await page.$eval(".manuscript-editor", (editor) => {
    const r = editor.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  await page.mouse.move(editorBox.x + editorBox.width / 2, editorBox.y + Math.min(180, editorBox.height / 2));
  await page.keyboard.down("Control");
  await page.mouse.wheel({ deltaY: -120 });
  await page.keyboard.up("Control");
  await page.waitForFunction(() => document.querySelector(".folio-statusbar")?.textContent?.includes("120%"));

  const wheel = await page.evaluate(() => ({
    font: Number.parseFloat(getComputedStyle(document.querySelector<HTMLElement>(".manuscript-editor")!).fontSize),
    stored: localStorage.getItem("folio-write-zoom"),
  }));
  check("Ctrl+mouse wheel changes Write view zoom", wheel.font > plus.editorFont && wheel.stored === "1.2", JSON.stringify(wheel));

  // Split View inherits the exact same visual zoom without touching manuscript data.
  await page.click(".editor-split-toggle");
  await page.waitForSelector(".writing-split-editor");
  const split = await page.evaluate(() => ({
    primary: Number.parseFloat(getComputedStyle(document.querySelector<HTMLElement>(".manuscript-editor")!).fontSize),
    secondary: Number.parseFloat(getComputedStyle(document.querySelector<HTMLElement>(".writing-split-editor")!).fontSize),
    dataZoom: document.querySelector(".writing-split-pane")?.getAttribute("data-write-zoom"),
  }));
  check("Split View uses the same Write zoom", Math.abs(split.primary - split.secondary) < 0.1 && split.dataZoom === "120", JSON.stringify(split));

  await page.keyboard.down("Control");
  await page.keyboard.press("0");
  await page.keyboard.up("Control");
  await page.waitForFunction(() => document.querySelector(".folio-statusbar")?.textContent?.includes("100%"));

  const reset = await page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>(".preview-frame");
    const previewText = frame?.contentDocument?.querySelector<HTMLElement>("p");
    return {
      editorFont: Number.parseFloat(getComputedStyle(document.querySelector<HTMLElement>(".manuscript-editor")!).fontSize),
      splitFont: Number.parseFloat(getComputedStyle(document.querySelector<HTMLElement>(".writing-split-editor")!).fontSize),
      previewFont: previewText ? Number.parseFloat(getComputedStyle(previewText).fontSize) : 0,
      stored: localStorage.getItem("folio-write-zoom"),
    };
  });
  check("Ctrl+0 resets Write view without touching Preview",
    Math.abs(reset.editorFont - baseline.editorFont) < 0.1 &&
    Math.abs(reset.splitFont - baseline.editorFont) < 0.1 &&
    Math.abs(reset.previewFont - baseline.previewFont) < 0.01 &&
    reset.stored === "1",
    JSON.stringify(reset));

  await page.close();
} catch (error) {
  failed++;
  console.error("✗ Write zoom scenario completed");
  console.error(error);
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

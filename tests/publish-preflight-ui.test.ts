import assert from "node:assert/strict";
import express from "express";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { AddressInfo } from "node:net";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { getBrowser, closeBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

const app = express(); app.use(express.json({ limit: "20mb" })); registerApi(app); registerEditorApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_req, response) => response.sendFile(path.join(ROOT, "web", "dist", "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
let passed = 0;
function check(value: unknown, message: string) { assert.ok(value, message); passed++; }
try {
  const page = await (await getBrowser()).newPage(); page.setDefaultTimeout(45_000);
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(base, { waitUntil: "networkidle0" });
  async function click(selector: string, label: string) {
    const found = await page.evaluate((selector, label) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>(selector)].find((button) => button.textContent?.trim() === label);
      button?.click(); return Boolean(button);
    }, selector, label);
    assert.ok(found, `Button missing: ${label}`);
  }
  await click("button", "Open Sample"); await page.waitForSelector(".contents-list .chapter-row"); await page.click(".contents-list .chapter-row");
  await page.waitForSelector('.rich-editor[contenteditable="true"]');
  async function open() { await page.click(".generate-button"); await click(".generate-menu button", "Publish Preflight…"); await page.waitForSelector("dialog.publish-preflight-panel[open]"); }
  async function run() { const response = page.waitForResponse((response) => response.url().endsWith("/preflight") && response.request().method() === "POST"); await click(".publish-preflight-panel button", "Check EPUB"); return (await response).json() as Promise<{ ready: boolean; issues: unknown[] }>; }
  await open(); check((await run()).ready, "A complete sample book must pass Preflight from the real panel");
  await page.waitForFunction(() => document.querySelector(".publish-preflight-panel [role=status]")?.textContent?.includes("No blocking"));
  await click(".publish-preflight-panel button", "Close");
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".rich-editor")!;
    const image = document.createElement("img"); image.dataset.folioAsset = "missing-preflight-ui.png"; image.alt = "Missing preflight image";
    editor.appendChild(image); editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector<HTMLElement>(".rich-editor")?.dataset.markdown?.includes("missing-preflight-ui.png"));
  await open(); check(!(await run()).ready, "Preflight must detect the live saved chapter's missing illustration");
  await page.waitForFunction(() => document.querySelector(".publish-preflight-issues")?.textContent?.includes("missing-preflight-ui.png"));
  check(await page.$eval('.publish-preflight-issues [data-severity="error"]', (element) => Boolean(element.querySelector("p")?.textContent)), "Each issue must include a remedy");
  await click(".publish-preflight-issues button", "Open section");
  await page.waitForFunction(() => !document.querySelector("dialog.publish-preflight-panel"));
  check(await page.$eval(".rich-editor", (element) => (element.textContent ?? "").length > 100), "Opening an issue must preserve the chapter prose");
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".rich-editor")!;
    editor.querySelector('img[data-folio-asset="missing-preflight-ui.png"]')?.closest("figure")?.remove();
    editor.querySelector('img[data-folio-asset="missing-preflight-ui.png"]')?.remove();
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
  await page.waitForFunction(() => !document.querySelector<HTMLElement>(".rich-editor")?.dataset.markdown?.includes("missing-preflight-ui.png"));
  await open(); check((await run()).ready, "Removing the bad reference must clear the blocking error");
  const out = path.join(ROOT, "build", "qa-publish-engine"); await fs.mkdir(out, { recursive: true });
  await page.screenshot({ path: path.join(out, "preflight-panel.png") });
  await page.close(); console.log(`${passed} passed, 0 failed`);
} finally { await closeBrowser(); await new Promise<void>((resolve) => server.close(() => resolve())); }

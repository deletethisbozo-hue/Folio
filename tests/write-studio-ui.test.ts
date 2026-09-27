import express from "express";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { registerWriteStudioApi } from "../server/write-studio-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? passed++ : failed++;
};

async function clickButtonByText(page: any, selector: string, text: string) {
  const clicked = await page.evaluate(({ selector, text }: { selector: string; text: string }) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(selector)]
      .find((item) => item.textContent?.trim() === text);
    if (!button) return false;
    button.click();
    return true;
  }, { selector, text });
  if (!clicked) throw new Error(`Button not found: ${text}`);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

console.log("\nWrite Studio browser smoke");

const app = express();
app.use(express.json({ limit: "20mb" }));
registerApi(app);
registerEditorApi(app);
registerWriteStudioApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "web", "dist", "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(12000);
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(base, { waitUntil: "networkidle0" });

  await clickButtonByText(page, "button", "Open Sample");
  await page.waitForSelector('.rich-editor[contenteditable="true"]');
  await clickButtonByText(page, ".workspace-mode-switch button", "Write");
  await page.waitForFunction(() => document.querySelector(".folio-shell")?.getAttribute("data-workspace-mode") === "write");

  await page.click(".editor-tools-toggle");
  await page.waitForSelector(".write-studio-drawer");

  const shell = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".folio-shell")!;
    const drawer = document.querySelector<HTMLElement>(".write-studio-drawer")!;
    const style = getComputedStyle(root);
    const tabs = [...document.querySelectorAll(".write-studio-tabs button")].map((item) => item.textContent?.trim());
    return {
      accent: style.getPropertyValue("--studio-accent").trim(),
      drawerPosition: getComputedStyle(drawer).position,
      tabs,
      drawerRight: getComputedStyle(drawer).right,
    };
  });
  check("uses the canonical 2.2 blue-violet accent", shell.accent.toLowerCase() === "#5b5ce2", JSON.stringify(shell));
  check("Writing Studio is an overlay drawer rather than a third grid column", shell.drawerPosition === "fixed" && shell.drawerRight === "0px", JSON.stringify(shell));
  check("all selected Write tools are present", ["Session", "Research", "Comments", "History", "Find", "Analysis"].every((tab) => shell.tabs.includes(tab)), JSON.stringify(shell.tabs));

  const sessionUi = await page.evaluate(() => ({
    targets: [...document.querySelectorAll(".write-target-input > span")].map((item) => item.textContent?.trim()),
    stats: [...document.querySelectorAll(".write-stat-grid > div > span")].map((item) => item.textContent?.trim()),
  }));
  check("Session exposes book/day/session/chapter targets", ["Book", "Daily", "Session", "Chapter"].every((item) => sessionUi.targets.includes(item)), JSON.stringify(sessionUi.targets));
  check("Session exposes active time, gross, deleted, net and WPM", ["Active time", "Gross", "Deleted", "Net", "Words/min"].every((item) => sessionUi.stats.includes(item)), JSON.stringify(sessionUi.stats));

  await page.evaluate(() => {
    const inputs = [...document.querySelectorAll<HTMLInputElement>(".write-target-input input")];
    inputs[0].value = "90000";
    inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    inputs[1].value = "1500";
    inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
  });
  await clickButtonByText(page, ".write-section-heading button", "Save");
  await sleep(150);

  // Capture a real editor selection before moving focus into the drawer.
  const selected = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".manuscript-editor");
    if (!editor) return "";
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node: Node | null = null;
    while ((node = walker.nextNode())) {
      const value = node.textContent?.trim() ?? "";
      if (value.length >= 8) {
        const text = node.textContent ?? "";
        const start = text.search(/\S/);
        const end = Math.min(text.length, start + Math.min(28, value.length));
        const range = document.createRange();
        range.setStart(node, Math.max(0, start));
        range.setEnd(node, Math.max(start + 1, end));
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        editor.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return selection?.toString().trim() ?? "";
      }
    }
    return "";
  });
  check("test manuscript provides selectable prose", selected.length > 0, selected);

  await clickButtonByText(page, ".write-studio-tabs button", "Comments");
  await page.waitForSelector(".comment-compose textarea");
  await page.type(".comment-compose textarea", "Browser smoke comment");
  await clickButtonByText(page, ".comment-compose button", "Add to selection");
  await page.waitForFunction(() => [...document.querySelectorAll(".comment-card p")].some((item) => item.textContent?.includes("Browser smoke comment")));
  check("inline comment survives focus moving into the drawer", true);

  await clickButtonByText(page, ".write-studio-tabs button", "History");
  await page.waitForSelector(".snapshot-compose input");
  await page.type(".snapshot-compose input", "Browser checkpoint");
  await clickButtonByText(page, ".snapshot-compose button", "Create snapshot");
  await page.waitForFunction(() => [...document.querySelectorAll(".revision-row")].some((item) => item.textContent?.includes("Browser checkpoint")));
  check("manual chapter snapshot appears in History", true);

  // Add a deterministic repeated word through the real editor input path.
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".manuscript-editor");
    if (!editor) return;
    const p = document.createElement("p");
    p.textContent = "spectrometer spectrometer spectrometer spectrometer";
    editor.appendChild(p);
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "spectrometer" }));
  });
  await sleep(250);

  await clickButtonByText(page, ".write-studio-tabs button", "Analysis");
  await page.waitForFunction(() => [...document.querySelectorAll(".analysis-list button span")].some((item) => item.textContent?.trim() === "spectrometer"));
  check("repetition analysis reacts to the live unsaved editor", true);

  await clickButtonByText(page, ".write-studio-tabs button", "Find");
  await page.waitForSelector(".advanced-search input");
  const findInputs = await page.$$(".advanced-search input");
  await findInputs[0].type("spectrometer");
  await findInputs[1].type("instrument");
  await page.waitForFunction(() => document.querySelectorAll(".search-hit-list button").length > 0);
  const findPreview = await page.evaluate(() => ({
    before: document.querySelector(".search-hit-list button span:not(.search-preview-label)")?.textContent ?? "",
    after: document.querySelector(".search-preview-after")?.textContent ?? "",
  }));
  check("Find shows a replacement preview before Replace All", /spectrometer/i.test(findPreview.before) && /instrument/i.test(findPreview.after), JSON.stringify(findPreview));

  await page.waitForFunction(() => document.querySelectorAll(".search-hit-list button").length >= 4);
  const selectionOffset = async () => page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".manuscript-editor");
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return -1;
    const active = selection.getRangeAt(0);
    if (!editor.contains(active.startContainer)) return -1;
    const before = document.createRange();
    before.selectNodeContents(editor);
    before.setEnd(active.startContainer, active.startOffset);
    return before.toString().length;
  });
  const hitButtons = await page.$(".search-hit-list button");
  await hitButtons[0].click();
  await sleep(120);
  const firstHitOffset = await selectionOffset();
  const refreshedHitButtons = await page.$(".search-hit-list button");
  await refreshedHitButtons[2].click();
  await sleep(120);
  const thirdHitOffset = await selectionOffset();
  check("Find can navigate to separate repeated results in the same chapter", firstHitOffset >= 0 && thirdHitOffset > firstHitOffset, JSON.stringify({ firstHitOffset, thirdHitOffset }));

  const status = await page.evaluate(() => document.querySelector(".write-session-chip")?.textContent ?? "");
  check("status bar exposes compact session progress", /words/.test(status) && /active min/.test(status), status);
} finally {
  server.close();
  await closeBrowser();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

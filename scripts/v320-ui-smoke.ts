import express from "express";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Page } from "puppeteer";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

const app = express();
app.use(express.json({ limit: "64mb" }));
registerApi(app);
registerEditorApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_request, response) => response.sendFile(path.join(ROOT, "web", "dist", "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;

const findButton = async (page: Page, text: string) => {
  await page.evaluate((label: string) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) => item.textContent?.trim() === label || item.textContent?.includes(label));
    if (!button) throw new Error("Button missing: " + label);
    button.click();
  }, text);
};

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(90_000);
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle0" });

  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) => item.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample missing");
    button.click();
  });
  await page.waitForSelector('.rich-editor[contenteditable="true"]');
  await page.waitForFunction(() => Boolean(document.querySelector(".preview-frame")?.contentDocument?.body));

  const chrome = await page.evaluate(() => {
    const wordmark = getComputedStyle(document.querySelector(".command-wordmark")!);
    const formatBar = document.querySelector<HTMLElement>(".section-titlebar")!.getBoundingClientRect();
    const title = document.querySelector<HTMLElement>(".section-title-button")!;
    const titleRect = title.getBoundingClientRect();
    return {
      seamColor: wordmark.borderRightColor,
      barHeight: formatBar.height,
      titleSize: Number.parseFloat(getComputedStyle(title).fontSize),
      titleCenterError: Math.abs((titleRect.top + titleRect.bottom) / 2 - (formatBar.top + formatBar.bottom) / 2),
    };
  });
  const transparent = chrome.seamColor === "transparent" || /rgba\([^)]*,\s*0\)/.test(chrome.seamColor);
  if (!transparent) throw new Error("Logo divider is still visible: " + JSON.stringify(chrome));
  if (chrome.barHeight > 42 || chrome.titleSize > 15.5 || chrome.titleCenterError > 3) {
    throw new Error("Format chapter title still has cramped geometry: " + JSON.stringify(chrome));
  }

  await page.click('[data-command="design"]');
  await page.waitForSelector(".style-library");

  const labButton = await page.evaluate(() => {
    const button = document.querySelector<HTMLElement>(".style-open-theme-lab")!;
    const label = button.querySelector<HTMLElement>("span");
    if (!label) throw new Error("Theme Lab button label wrapper missing");
    const buttonRect = button.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(label);
    const textRect = range.getBoundingClientRect();
    return {
      text: label.textContent?.trim(),
      x: Math.abs((textRect.left + textRect.right) / 2 - (buttonRect.left + buttonRect.right) / 2),
      y: Math.abs((textRect.top + textRect.bottom) / 2 - (buttonRect.top + buttonRect.bottom) / 2),
    };
  });
  if (labButton.text !== "Theme Lab" || labButton.x > 2 || labButton.y > 2.5) {
    throw new Error("Theme Lab launcher is not optically centered: " + JSON.stringify(labButton));
  }

  await page.click(".style-open-theme-lab");
  await page.waitForSelector('.theme-lab-window[aria-label="Theme Lab"]');
  const labHeader = await page.$eval(".theme-lab-header", (node) => node.textContent ?? "");
  if (labHeader.includes("Folio 3.1")) throw new Error("Legacy Folio 3.1 label is still visible in Theme Lab.");

  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('.theme-lab-window input[maxlength="64"]');
    if (!input) throw new Error("Theme name field missing");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "QA Saved Theme");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await findButton(page, "Save to Library");
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => button.textContent?.includes("Saved ✓")));

  await page.click(".theme-lab-close");
  await page.waitForSelector(".theme-lab-window", { hidden: true });
  await page.click('[data-command="design"]');
  await page.waitForSelector('[data-custom-theme]');
  const customLabel = await page.$eval('[data-custom-theme] .theme-name', (node) => node.textContent?.trim());
  if (customLabel !== "QA Saved Theme") throw new Error("Saved Theme Lab style did not appear in Book Style.");

  await page.hover('[data-custom-theme]');
  await page.waitForSelector(".theme-hover-preview iframe");
  await page.waitForFunction(() => Boolean(document.querySelector<HTMLIFrameElement>(".theme-hover-preview iframe")?.contentDocument?.querySelector("section.chapter")));

  await page.click('[data-custom-theme]');
  await page.waitForFunction(() => document.querySelector('[data-custom-theme]')?.classList.contains("selected"));

  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".style-category-list button")]
      .find((item) => item.textContent?.trim() === "Body");
    if (!button) throw new Error("Body design category missing");
    button.click();
  });
  await page.waitForFunction(() => document.querySelector(".customize-heading h3")?.textContent?.trim() === "Body");
  await page.evaluate(() => {
    const row = [...document.querySelectorAll<HTMLLabelElement>(".customize-row")]
      .find((item) => item.querySelector(":scope > span")?.textContent?.trim() === "Size");
    const select = row?.querySelector<HTMLSelectElement>("select");
    if (!select) throw new Error("Body size selector missing");
    select.value = "1.08em";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await page.click(".style-open-theme-lab");
  await page.waitForSelector(".theme-lab-window");
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".theme-lab-nav button")]
      .find((item) => item.textContent?.trim() === "Body");
    if (!button) throw new Error("Theme Lab Body panel missing");
    button.click();
  });
  await page.waitForFunction(() => [...document.querySelectorAll(".theme-lab-row > span:first-child")].some((node) => node.textContent?.trim() === "Type size"));
  const typeSize = await page.evaluate(() => {
    const row = [...document.querySelectorAll<HTMLLabelElement>(".theme-lab-row")]
      .find((item) => item.querySelector(":scope > span")?.textContent?.trim() === "Type size");
    return Number(row?.querySelector<HTMLInputElement>('input[type="range"]')?.value);
  });
  if (Math.abs(typeSize - 1.08) > .001) throw new Error("Design Body controls did not update active custom theme: " + typeSize);

  await page.click(".theme-lab-close");
  await page.waitForSelector(".theme-lab-window", { hidden: true });

  const beforeZoom = await page.$eval(".reader-device", (node) => node.getBoundingClientRect().width);
  await page.click('[aria-label="Zoom preview in"]');
  await page.waitForFunction(() => document.querySelector(".preview-zoom-readout")?.textContent?.includes("110%"));
  const afterZoom = await page.$eval(".reader-device", (node) => node.getBoundingClientRect().width);
  if (!(afterZoom > beforeZoom * 1.075)) {
    throw new Error("Whole preview did not physically zoom: " + JSON.stringify({ beforeZoom, afterZoom }));
  }
  await page.click(".preview-zoom-readout");
  await page.waitForFunction(() => document.querySelector(".preview-zoom-readout")?.textContent?.includes("100%"));

  await page.select('select[aria-label="Preview device"]', "print");
  await page.waitForFunction(() => Boolean(document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument?.querySelector(".pagedjs_page")), { timeout: 90_000 });

  const trims = ["5x8", "5.25x8", "5.5x8.5", "6x9", "8.5x11"];
  const widths: number[] = [];
  for (const trim of trims) {
    const response = page.waitForResponse((item) => {
      const url = new URL(item.url());
      return item.request().method() === "POST" && /\/preview-print$/.test(url.pathname);
    }, { timeout: 90_000 });
    await page.select('select[aria-label="Print trim"]', trim);
    const result = await response;
    if (!result.ok()) throw new Error("Print preview request failed for " + trim + ": " + result.status());
    await page.waitForSelector(".preview-loading", { hidden: true, timeout: 90_000 });
    await page.waitForFunction(() => Boolean(document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument?.querySelector(".pagedjs_page")), { timeout: 90_000 });
    const width = await page.evaluate(() => document.querySelector<HTMLIFrameElement>(".preview-frame")!.contentDocument!.querySelector<HTMLElement>(".pagedjs_page")!.getBoundingClientRect().width);
    widths.push(width);
    const leaked = await page.evaluate(() => document.body.innerText.includes("Print layout quality failure after final page calibration"));
    if (leaked || await page.$(".preview-error")) throw new Error("Raw Print layout diagnostics leaked into the UI for " + trim);
  }
  for (let index = 1; index < widths.length; index++) {
    if (!(widths[index] > widths[index - 1] + 5)) {
      throw new Error("Print trim preview widths did not increase correctly: " + JSON.stringify({ trims, widths }));
    }
  }

  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector('.rich-editor[contenteditable="true"]', { timeout: 30_000 });
  await page.click('[data-command="design"]');
  await page.waitForSelector('[data-custom-theme]', { timeout: 15_000 });
  const persisted = await page.$eval('[data-custom-theme] .theme-name', (node) => node.textContent?.trim());
  if (persisted !== "QA Saved Theme") throw new Error("Custom theme library did not survive page reload.");

  console.log("Folio 3.2 UI smoke passed: library, live custom preview, Design integration, chrome polish, whole-preview zoom and every Print trim.");
} finally {
  await closeBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

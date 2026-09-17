import express from "express";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

const qa = path.join(ROOT, "build", "qa-v207-controls");
await fs.mkdir(qa, { recursive: true });

const app = express();
app.use(express.json({ limit: "5mb" }));
registerApi(app);
registerEditorApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_request, response) => response.sendFile(path.join(ROOT, "web", "dist", "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(30_000);
  await page.setViewport({ width: 1536, height: 1024, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle0" });

  await page.waitForSelector(".start-shell .start-brand");
  const startBrand = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".start-shell .start-brand");
    if (!el) throw new Error("Start wordmark missing");
    const style = getComputedStyle(el);
    return { fontSize: style.fontSize, lineHeight: style.lineHeight, fontFamily: style.fontFamily };
  });
  if (startBrand.fontSize !== "38px" || startBrand.lineHeight !== "38px" || !/Folio Pelagiad Exact/i.test(startBrand.fontFamily)) {
    throw new Error(`Start wordmark mismatch: ${JSON.stringify(startBrand)}`);
  }
  await page.screenshot({ path: path.join(qa, "start-wordmark.png") });

  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample missing");
    button.click();
  });
  await page.waitForSelector(".folio-shell:not(.folio-empty-shell)");
  await page.waitForSelector(".library-add-section");
  await page.waitForSelector(".book-more-button");
  await page.waitForSelector(".folio-nav-icon");

  const geometry = await page.evaluate(() => {
    const brand = document.querySelector<HTMLElement>(".command-wordmark");
    const command = document.querySelector<HTMLElement>(".folio-commandbar");
    const library = document.querySelector<HTMLElement>(".library-pane");
    const preview = document.querySelector<HTMLElement>(".preview-pane");
    const add = document.querySelector<HTMLElement>(".library-add-section");
    if (!brand || !command || !library || !preview || !add) throw new Error("Mockup geometry incomplete");
    const brandStyle = getComputedStyle(brand);
    return {
      brandSize: brandStyle.fontSize,
      brandLine: brandStyle.lineHeight,
      brandFamily: brandStyle.fontFamily,
      commandHeight: command.getBoundingClientRect().height,
      libraryWidth: library.getBoundingClientRect().width,
      previewWidth: preview.getBoundingClientRect().width,
      addHeight: add.getBoundingClientRect().height,
    };
  });
  if (geometry.brandSize !== "38px" || geometry.brandLine !== "38px" || !/Folio Pelagiad Exact/i.test(geometry.brandFamily)) throw new Error(`Workspace wordmark mismatch: ${JSON.stringify(geometry)}`);
  if (Math.abs(geometry.commandHeight - 64) > .6) throw new Error(`Command bar is ${geometry.commandHeight}px`);
  if (Math.abs(geometry.libraryWidth - 255) > .6) throw new Error(`Sidebar is ${geometry.libraryWidth}px`);
  if (geometry.previewWidth < 450) throw new Error(`Preview too narrow: ${geometry.previewWidth}px`);
  if (Math.abs(geometry.addHeight - 42) > .6) throw new Error(`Add Section is ${geometry.addHeight}px`);

  const chapterRows = await page.$$(".contents-list .chapter-row");
  if (chapterRows.length > 1) {
    await chapterRows[1].click();
    await page.waitForSelector(".preview-loading", { hidden: true });
  }
  await page.waitForSelector(".section-kicker");
  await page.screenshot({ path: path.join(qa, "mockup-workspace.png") });

  // Functional smoke: injected and existing controls must all reach real handlers.
  await page.click(".book-more-button");
  await page.waitForSelector('.folio-dialog[aria-label="Book Details"]');
  await page.click('.folio-dialog[aria-label="Book Details"] button[aria-label="Close"]');
  await page.waitForSelector('.folio-dialog[aria-label="Book Details"]', { hidden: true });

  await page.click(".library-add-section");
  await page.waitForSelector('.folio-dialog[aria-label="Add Content"]');
  await page.click('.folio-dialog[aria-label="Add Content"] button[aria-label="Close"]');
  await page.waitForSelector('.folio-dialog[aria-label="Add Content"]', { hidden: true });

  await page.click('[data-command="design"]');
  await page.waitForSelector('.style-library[aria-label="Book style library"]');
  await page.click('.style-library button[aria-label="Close"]');
  await page.waitForSelector('.style-library[aria-label="Book style library"]', { hidden: true });

  await page.click('[data-command="add"]');
  await page.waitForSelector('.folio-dialog[aria-label="Add Content"]');
  await page.click('.folio-dialog[aria-label="Add Content"] button[aria-label="Close"]');

  const toneBefore = await page.$eval(".folio-shell", (el) => el.getAttribute("data-ui-tone"));
  await page.click(".tone-toggle");
  await page.waitForFunction((previous) => document.querySelector(".folio-shell")?.getAttribute("data-ui-tone") !== previous, {}, toneBefore);
  await page.click(".tone-toggle");
  await page.waitForFunction((previous) => document.querySelector(".folio-shell")?.getAttribute("data-ui-tone") === previous, {}, toneBefore);

  const deviceBefore = await page.$eval<HTMLSelectElement>(".device-label select", (el) => el.value);
  const deviceAfter = await page.evaluate((before) => {
    const select = document.querySelector<HTMLSelectElement>(".device-label select");
    if (!select) throw new Error("Device selector missing");
    const option = [...select.options].find((candidate) => candidate.value && candidate.value !== before);
    if (!option) throw new Error("No alternate preview device");
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return option.value;
  }, deviceBefore);
  await page.waitForFunction((value) => (document.querySelector(".device-label select") as HTMLSelectElement | null)?.value === value, {}, deviceAfter);
  await page.waitForSelector(".preview-loading", { hidden: true });

  const search = await page.$(".search-pill");
  if (search) {
    await search.click();
    await page.waitForSelector(".editor-search input");
    await page.click('.editor-search button[aria-label="Close search"]');
  }

  const next = await page.$('.device-nav button[aria-label="Next section"]');
  if (next) {
    const disabled = await next.evaluate((button) => (button as HTMLButtonElement).disabled);
    if (!disabled) {
      const before = await page.$eval(".device-nav span", (el) => el.textContent ?? "");
      await next.click();
      await page.waitForFunction((previous) => (document.querySelector(".device-nav span")?.textContent ?? "") !== previous, {}, before);
    }
  }

  await page.click(".generate-button");
  await page.waitForSelector(".generate-menu");
  const exportItems = await page.$$eval(".generate-menu > button", (buttons) => buttons.map((button) => button.textContent?.trim()).filter(Boolean));
  if (exportItems.length < 5) throw new Error(`Export menu incomplete: ${exportItems.join(", ")}`);
  await page.click(".generate-button");

  await page.click(".contents-row.cover-row");
  await page.waitForSelector(".cover-upload-button");
  const controls = await page.evaluate(() => {
    const replace = document.querySelector<HTMLElement>(".cover-upload-button");
    const exportButton = document.querySelector<HTMLElement>(".generate-button");
    const device = document.querySelector<HTMLElement>(".device-label select");
    if (!replace || !exportButton || !device) throw new Error("Control system incomplete");
    const rs = getComputedStyle(replace);
    const es = getComputedStyle(exportButton);
    const ds = getComputedStyle(device);
    return {
      replace: { height: replace.getBoundingClientRect().height, font: rs.fontFamily, radius: rs.borderRadius, align: rs.alignItems, justify: rs.justifyContent },
      exportButton: { height: exportButton.getBoundingClientRect().height, font: es.fontFamily, radius: es.borderRadius, align: es.alignItems, justify: es.justifyContent },
      device: { height: device.getBoundingClientRect().height, font: ds.fontFamily, radius: ds.borderRadius },
    };
  });
  for (const [name, metrics] of Object.entries(controls)) {
    if (Math.abs(metrics.height - 36) > .6) throw new Error(`${name} height ${metrics.height}`);
    if (!/Source Sans 3/i.test(metrics.font)) throw new Error(`${name} font ${metrics.font}`);
    if (metrics.radius !== "5px") throw new Error(`${name} radius ${metrics.radius}`);
  }
  if (controls.replace.align !== "center" || controls.replace.justify !== "center") throw new Error(`Replace Cover not centered`);
  if (controls.exportButton.align !== "center" || controls.exportButton.justify !== "center") throw new Error(`Export not centered`);
  await page.screenshot({ path: path.join(qa, "cover-controls.png") });

  await page.click('[data-command="add"]');
  await page.waitForSelector('.content-image-input[type="file"]');
  const imageInput = await page.$('.content-image-input[type="file"]');
  if (!imageInput) throw new Error("Full-page image input missing");
  await imageInput.uploadFile(path.join(ROOT, "samples", "clockwork-garden", "cover.png"));
  await page.waitForFunction(() => document.querySelector(".editor-pane")?.classList.contains("folio-image-page-mode"));
  await page.waitForFunction(() => {
    const selected = document.querySelector(".contents-list .contents-row.selected:not(.cover-row)");
    return (selected?.textContent ?? "").includes("Full-page Image");
  });
  await page.waitForSelector(".preview-loading", { hidden: true });
  const imagePage = await page.evaluate(() => {
    const wrap = document.querySelector<HTMLElement>(".editor-pane .section-title-wrap");
    const selected = document.querySelector<HTMLElement>(".contents-list .contents-row.selected:not(.cover-row)");
    const frame = document.querySelector<HTMLIFrameElement>(".preview-frame");
    const heading = frame?.contentDocument?.querySelector("main.book > section.image-page > h1, main.book > section.image-page > .chapter-title");
    return {
      titleDisplay: wrap ? getComputedStyle(wrap).display : "missing",
      selectedText: (selected?.textContent ?? "").trim(),
      previewHeading: (heading?.textContent ?? "").trim(),
    };
  });
  if (imagePage.titleDisplay !== "none") throw new Error(`Full-page title visible: ${imagePage.titleDisplay}`);
  if (!imagePage.selectedText.includes("Full-page Image")) throw new Error(`Neutral image label missing: ${imagePage.selectedText}`);
  if (imagePage.previewHeading) throw new Error(`Full-page preview heading visible: ${imagePage.previewHeading}`);
  await page.screenshot({ path: path.join(qa, "full-page-image-no-filename.png") });

  console.log(JSON.stringify({ startBrand, geometry, controls, imagePage, exportItems }, null, 2));
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

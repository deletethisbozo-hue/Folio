import puppeteer from "puppeteer";
import { promises as fs } from "node:fs";
import path from "node:path";

const qaDir = path.resolve("build", "qa-v324-regression");
await fs.mkdir(qaDir, { recursive: true });

const port = process.env.FOLIO_E2E_DEBUG_PORT || "43128";
const appPort = process.env.FOLIO_E2E_PORT || "43127";
const apiBase = `http://127.0.0.1:${appPort}`;
let browser;
let lastError;
for (let attempt = 0; attempt < 80; attempt++) {
  try {
    browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:" + port });
    break;
  } catch (error) {
    lastError = error;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
if (!browser) throw lastError || new Error("Could not connect to packaged Folio.");

try {
  let page;
  for (let attempt = 0; attempt < 80 && !page; attempt++) {
    const pages = await browser.pages();
    page = pages.find((candidate) => candidate.url().includes(`127.0.0.1:${appPort}`));
    if (!page) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!page) throw new Error("Packaged Folio window was not found.");

  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForSelector(".start-actions", { timeout: 15000 });
  const seededTheme = [{
    id: "qa-custom-theme",
    label: "QA Custom Theme",
    baseTheme: "decorative",
    config: { enabled: true, name: "QA Custom Theme", paper: "#fbfaf6", accent: "#856744", headingFont: "Libre Baskerville", bodyFont: "EB Garamond", headingAlign: "center", labelText: "CHAPTER" },
    createdAt: 1,
    updatedAt: 2,
  }];
  const seedThemeResponse = await fetch(`${apiBase}/api/library/themes`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ themes: seededTheme }),
  });
  if (!seedThemeResponse.ok) throw new Error("Could not seed packaged custom theme QA fixture.");
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample button is missing from packaged Folio.");
    button.click();
  });
  await page.waitForSelector('.rich-editor[contenteditable="true"]', { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector(".preview-loading"), { timeout: 15000 }).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const formatHeaderGeometry = await page.evaluate(() => {
    const bar = document.querySelector(".section-titlebar")?.getBoundingClientRect();
    const wrap = document.querySelector(".section-title-wrap")?.getBoundingClientRect();
    const toolbar = document.querySelector(".format-toolbar")?.getBoundingClientRect();
    const paper = document.querySelector(".editor-paper")?.getBoundingClientRect();
    if (!bar || !wrap || !toolbar || !paper) return null;
    return {
      barHeight: bar.height,
      toolbarHeight: toolbar.height,
      topGap: wrap.top - bar.top,
      bottomGap: bar.bottom - wrap.bottom,
      toolbarPaperGap: paper.top - toolbar.bottom,
    };
  });
  if (!formatHeaderGeometry
    || Math.abs(formatHeaderGeometry.barHeight - 40) > 1
    || Math.abs(formatHeaderGeometry.toolbarHeight - 36) > 1
    || formatHeaderGeometry.topGap < 2
    || formatHeaderGeometry.bottomGap < 2
    || Math.abs(formatHeaderGeometry.toolbarPaperGap) > 1) {
    throw new Error("Format chrome is cramped or the white toolbar seam returned: " + JSON.stringify(formatHeaderGeometry));
  }
  await page.screenshot({ path: path.join(qaDir, "01-format-header-and-preview.png") });
  await page.$eval(".rich-editor", (element) => {
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element); range.collapse(false);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  });
  await page.keyboard.press("Enter");
  await page.keyboard.type("PACKAGED UI DRAFT");
  await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.body?.textContent?.replace(/\u00ad/g, "").includes("PACKAGED UI DRAFT"), { timeout: 15000 });
  await page.$eval(".rich-editor", (element) => {
    element.focus();
    const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    const transfer = new DataTransfer();
    transfer.setData("text/html", "<p>Packaged Libre paragraph</p><p><strong>Second paragraph</strong></p>");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.body?.textContent?.replace(/\u00ad/g, "").includes("Packaged Libre paragraph"), { timeout: 15000 });
  await page.click('[title="Insert ornamental scene break"]');
  await page.waitForFunction(() => Boolean(document.querySelector("iframe")?.contentDocument?.querySelector(".scene-break")), { timeout: 15000 });
  await page.click('[data-command="design"]');
  await page.waitForSelector(".theme-sample");
  const builtInThemes = await page.$eval(".theme-sample:not(.theme-custom)", (items) => items.length);
  const customThemes = await page.$eval(".theme-sample.theme-custom", (items) => items.length);
  if (builtInThemes !== 13 || customThemes !== 1) throw new Error("Packaged style browser theme count mismatch: built-in=" + builtInThemes + ", custom=" + customThemes);
  const designGeometry = await page.evaluate(() => {
    const lab = document.querySelector(".style-open-theme-lab");
    const customName = document.querySelector(".theme-sample.theme-custom .theme-name");
    if (!(lab instanceof HTMLElement) || !(customName instanceof HTMLElement)) return null;
    const button = lab.getBoundingClientRect();
    const nameStyle = getComputedStyle(customName);
    return { buttonWidth: button.width, buttonHeight: button.height, nameAlign: nameStyle.textAlign, customName: customName.textContent?.trim() ?? "" };
  });
  if (!designGeometry || Math.abs(designGeometry.buttonWidth - 104) > 2 || Math.abs(designGeometry.buttonHeight - 32) > 2 || designGeometry.nameAlign !== "left" || designGeometry.customName !== "QA Custom Theme") {
    throw new Error("Theme Library geometry/alignment regression remains: " + JSON.stringify(designGeometry));
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
  await page.screenshot({ path: path.join(qaDir, "02-theme-library-and-theme-lab-button.png") });
  await page.click(".style-category-list button:nth-child(6)");
  const ornaments = await page.$$eval(".ornament-picker button[data-ornament]", (items) => items.length);
  if (ornaments < 20) throw new Error("Packaged ornament browser contains only " + ornaments + " ornaments.");
  await page.click(".style-library-close");
  const devices = await page.$eval('select[aria-label="Preview device"] option', (items) => items.length);
  if (devices < 6) throw new Error("Packaged preview contains only " + devices + " device modes.");
  const deviceSelectStyle = await page.$eval('select[aria-label="Preview device"]', (select) => {
    const style = getComputedStyle(select);
    return { width: select.getBoundingClientRect().width, textAlign: style.textAlign, textAlignLast: style.textAlignLast };
  });
  if (deviceSelectStyle.width < 110 || deviceSelectStyle.textAlign !== "center" || deviceSelectStyle.textAlignLast !== "center") {
    throw new Error("Device selector is not centered/wide enough: " + JSON.stringify(deviceSelectStyle));
  }
  const printStartedAt = Date.now();
  await page.select('select[aria-label="Preview device"]', "print");
  await page.waitForFunction(() => {
    const frame = document.querySelector("iframe");
    const printed = frame?.contentDocument?.querySelector(".pagedjs_page");
    const rect = printed?.getBoundingClientRect();
    return Boolean(rect && rect.width > 120 && rect.height > 160);
  }, { timeout: 45000 });
  const printOpenMs = Date.now() - printStartedAt;
  if (printOpenMs > 18000) throw new Error("Packaged Print preview took too long to open: " + printOpenMs + "ms");
  const fittedPrint = await page.evaluate(() => {
    const frame = document.querySelector("iframe");
    const printed = frame?.contentDocument?.querySelector(".pagedjs_page");
    const rect = printed?.getBoundingClientRect();
    return { pageWidth: rect?.width ?? 0, frameWidth: frame?.clientWidth ?? 0 };
  });
  if (!(fittedPrint.pageWidth > 120 && fittedPrint.pageWidth <= fittedPrint.frameWidth - 12)) {
    throw new Error("Packaged Print preview did not open fitted to the preview pane: " + JSON.stringify(fittedPrint));
  }
  await page.screenshot({ path: path.join(qaDir, "03-print-fit-100.png") });
  const beforeZoomOut = fittedPrint.pageWidth;
  await page.click('button[aria-label="Zoom preview out"]');
  await page.waitForFunction((before) => {
    const frame = document.querySelector("iframe");
    const printed = frame?.contentDocument?.querySelector(".pagedjs_page");
    return Boolean(printed && printed.getBoundingClientRect().width < before - 8);
  }, { timeout: 5000 }, beforeZoomOut);
  await page.screenshot({ path: path.join(qaDir, "04-print-zoomed-out.png") });
  await page.click(".preview-zoom-readout");
  // The paginated mode must show the editor's current section, not merely any
  // successfully-paginated copy from disk. This is the user-visible contract
  // that a raw serialized-HTML regex cannot reliably test after the compositor
  // has split words into spans at discretionary hyphenation points.
  await page.waitForFunction(() => {
    const text = document.querySelector("iframe")?.contentDocument?.body?.textContent?.replace(/\u00ad/g, "") || "";
    return text.includes("PACKAGED UI DRAFT") && text.includes("Packaged Libre paragraph");
  }, { timeout: 20000 });
  await page.select('select[aria-label="Preview device"]', "kindle-6-8");
  await page.waitForFunction(() => {
    const doc = document.querySelector("iframe")?.contentDocument;
    return Boolean(doc?.querySelector("section.chapter") && !doc.querySelector(".pagedjs_pages"));
  }, { timeout: 20000 });

  // Separately exercise the packaged print-preview API with a marker that cannot
  // be changed by dictionary hyphenation. Nothing is saved first, so this proves
  // the endpoint applies the live draft itself rather than accidentally succeeding
  // only because the UI autosaved before switching device modes.
  const apiMarker = "Z9X8Q7V6P5";
  const apiSampleResponse = await fetch(`${apiBase}/api/sample`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!apiSampleResponse.ok) throw new Error(`Packaged API sample failed: ${apiSampleResponse.status}`);
  const apiSample = await apiSampleResponse.json();
  const apiChapter = apiSample.sections?.find((section) => section.kind === "chapter");
  if (!apiChapter) throw new Error("Packaged API sample has no chapter for Print Preview probe.");
  const apiPrintResponse = await fetch(`${apiBase}/api/projects/${apiSample.projectId}/preview-print`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      meta: apiSample.meta,
      theme: "literary",
      typography: {},
      previewSectionId: apiChapter.id,
      draft: apiMarker,
      print: { trim: "6x9", binding: "paperback", startChaptersRecto: true, layout: "author-title-bottom" },
    }),
  });
  if (!apiPrintResponse.ok) throw new Error(`Packaged Print Preview API failed: ${apiPrintResponse.status}`);
  const apiPrint = await apiPrintResponse.json();
  const serializedPrint = String(apiPrint.html || "");
  // The compositor is allowed to wrap even a synthetic marker in nested spans,
  // so serialized HTML is not a valid semantic-text oracle. Parse the returned
  // document in the same Chromium instance and assert on textContent instead.
  const apiPrintText = await page.evaluate((html) => {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    return (parsed.body?.textContent || "").replace(/\u00ad/g, "");
  }, serializedPrint);
  const apiHasMarker = apiPrintText.includes(apiMarker);
  if (apiPrint.pages < 1 || !serializedPrint.includes("pagedjs_page") || !apiHasMarker) {
    throw new Error(`Packaged Print Preview API lost its unsaved live draft (pages=${apiPrint.pages}, marker=${apiHasMarker}).`);
  }

  await page.$eval(".rich-editor", (element) => {
    element.focus();
    const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    const words = "Najprawdopodobniej profesjonalne formatowanie całej książki powinno zachowywać wszystkie akapity oraz wyróżnienia bez niekontrolowanych odstępów pomiędzy zwyczajnymi słowami podczas dokładnego podglądu czytnika.";
    const rows = Array.from({ length: 5200 }, (_, index) => `<p class="P1" style="margin-top:0cm;margin-bottom:0.212cm;line-height:115%;orphans:2;widows:2"><span class="T1">${words} </span><span class="T2">${index === 5199 ? "PACKAGED WHOLE BOOK MARKER" : `fragment ${index + 1}`}</span></p>`).join("");
    const html = `<!doctype html><html><head><style>.P1{font-family:Liberation Serif}.T2{font-weight:bold}</style></head><body lang="pl-PL">${rows}</body></html>`;
    const transfer = new DataTransfer(); transfer.setData("text/html", html);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await page.waitForFunction(() => {
    const markdown = document.querySelector(".rich-editor")?.dataset.markdown || "";
    return markdown.includes("PACKAGED WHOLE BOOK MARKER") && (markdown.match(/\S+/g)?.length || 0) > 100000;
  }, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.body?.textContent?.replace(/\u00ad/g, "").includes("PACKAGED WHOLE BOOK MARKER"), { timeout: 30000 });
  const deviceVisible = await page.evaluate(() => {
    const stage = document.querySelector(".preview-stage").getBoundingClientRect();
    const device = document.querySelector(".reader-device").getBoundingClientRect();
    return device.width > 200 && device.height > 250 && device.left >= stage.left && device.right <= stage.right && device.top >= stage.top && device.bottom <= stage.bottom;
  });
  if (!deviceVisible) throw new Error("Packaged preview device disappeared after a large rich-text paste.");

  // This is a real trusted keyboard path after a 100k+ word manuscript exists.
  // A release that takes seconds per keystroke is not considered usable.
  await page.$eval(".rich-editor", (element) => {
    element.focus();
    const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  });
  const typingStarted = Date.now();
  await page.keyboard.type(" RESPONSIVE TYPING MARKER", { delay: 5 });
  await page.waitForFunction(() => document.querySelector(".rich-editor")?.dataset.markdown?.includes("RESPONSIVE TYPING MARKER"), { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.body?.textContent?.replace(/\u00ad/g, "").includes("RESPONSIVE TYPING MARKER"), { timeout: 8000 });
  if (Date.now() - typingStarted > 8000) throw new Error("Whole-book typing/preview response exceeded 8 seconds.");

  await page.waitForFunction(() => {
    const button = document.querySelector(".section-title-button");
    return button instanceof HTMLButtonElement && !button.disabled;
  }, { timeout: 60000 });
  await page.$eval(".section-title-button", (button) => {
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      throw new Error("Chapter rename button is not enabled after packaged large-manuscript editing.");
    }
    button.click();
  });
  await page.waitForSelector(".section-title-input", { timeout: 15000 });
  await page.$eval(".section-title-input", (element) => element.select());
  await page.keyboard.type("Packaged Renamed Chapter");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".contents-row.selected")?.textContent?.includes("Packaged Renamed Chapter"), { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector(".rich-editor")?.dataset.markdown?.includes("PACKAGED WHOLE BOOK MARKER"), { timeout: 15000 });
  // Rename updates the visible title optimistically, while the large-manuscript
  // save/re-ingest can still keep structural actions busy for a moment. Do not
  // mistake a disabled Delete button for a failed delete operation.
  await page.waitForFunction(() => {
    const button = document.querySelector(".section-delete");
    return button instanceof HTMLButtonElement && !button.disabled;
  }, { timeout: 60000 });
  page.once("dialog", (dialog) => void dialog.accept());
  await page.$eval(".section-delete", (button) => {
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      throw new Error("Section delete control did not become enabled after packaged rename.");
    }
    button.click();
  });
  await page.waitForFunction(() => ![...document.querySelectorAll(".contents-row")].some((row) => row.textContent?.includes("Packaged Renamed Chapter")), { timeout: 30000 });
  if (errors.length) throw new Error("Packaged browser errors: " + errors.join("; "));
  console.log("Packaged Folio 2.0.3 UI passed: startup screen, live-draft Print Preview, unsaved Print Preview API draft, responsive 100,000-word editing, rich-text sample, persistent preview, body-safe rename, 20+ ornaments, 13 curated themes, and grouped device profiles.");
} finally {
  browser.disconnect();
}

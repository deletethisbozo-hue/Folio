import puppeteer from "puppeteer";

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
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample button is missing from packaged Folio.");
    button.click();
  });
  await page.waitForSelector('.rich-editor[contenteditable="true"]', { timeout: 15000 });
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
  const themes = await page.$$eval(".theme-sample", (items) => items.length);
  if (themes !== 13) throw new Error("Packaged Folio 2.0 style browser expected exactly 13 curated themes, found " + themes + ".");
  await page.click(".style-category-list button:nth-child(6)");
  const ornaments = await page.$$eval(".ornament-picker button[data-ornament]", (items) => items.length);
  if (ornaments < 20) throw new Error("Packaged ornament browser contains only " + ornaments + " ornaments.");
  await page.click(".style-library-header button");
  const devices = await page.$eval('select[aria-label="Preview device"] option', (items) => items.length);
  if (devices < 6) throw new Error("Packaged preview contains only " + devices + " device modes.");
  await page.select('select[aria-label="Preview device"]', "print");
  await page.waitForFunction(() => {
    const frame = document.querySelector("iframe");
    const printed = frame?.contentDocument?.querySelector(".pagedjs_page");
    const rect = printed?.getBoundingClientRect();
    return Boolean(rect && rect.width > 120 && rect.height > 160);
  }, { timeout: 45000 });
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
  const serializedPrint = String(apiPrint.html || "").replace(/\u00ad/g, "");
  if (apiPrint.pages < 1 || !serializedPrint.includes("pagedjs_page") || !serializedPrint.includes(apiMarker)) {
    throw new Error(`Packaged Print Preview API lost its unsaved live draft (pages=${apiPrint.pages}, marker=${serializedPrint.includes(apiMarker)}).`);
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

  await page.click(".section-title-button");
  await page.waitForSelector(".section-title-input");
  await page.$eval(".section-title-input", (element) => element.select());
  await page.keyboard.type("Packaged Renamed Chapter");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".contents-row.selected")?.textContent?.includes("Packaged Renamed Chapter"), { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector(".rich-editor")?.dataset.markdown?.includes("PACKAGED WHOLE BOOK MARKER"), { timeout: 15000 });
  page.once("dialog", (dialog) => void dialog.accept());
  await page.click(".section-delete");
  await page.waitForFunction(() => ![...document.querySelectorAll(".contents-row")].some((row) => row.textContent?.includes("Packaged Renamed Chapter")), { timeout: 15000 });
  if (errors.length) throw new Error("Packaged browser errors: " + errors.join("; "));
  console.log("Packaged Folio 2.0.2 UI passed: startup screen, live-draft Print Preview, unsaved Print Preview API draft, responsive 100,000-word editing, rich-text sample, persistent preview, body-safe rename, 20+ ornaments, 13 curated themes, and grouped device profiles.");
} finally {
  browser.disconnect();
}

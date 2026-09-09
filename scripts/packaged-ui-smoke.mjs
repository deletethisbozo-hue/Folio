import puppeteer from "puppeteer";

const port = process.env.FOLIO_E2E_DEBUG_PORT || "43128";
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
    page = pages.find((candidate) => candidate.url().includes("127.0.0.1:43127"));
    if (!page) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!page) throw new Error("Packaged Folio window was not found.");

  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForSelector(".empty-actions", { timeout: 15000 });
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
  await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.body?.innerText.includes("PACKAGED UI DRAFT"), { timeout: 15000 });
  await page.$eval(".rich-editor", (element) => {
    element.focus();
    const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    const transfer = new DataTransfer();
    transfer.setData("text/html", "<p>Packaged Libre paragraph</p><p><strong>Second paragraph</strong></p>");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.body?.innerText.includes("Packaged Libre paragraph"), { timeout: 15000 });
  await page.click('[title="Insert ornamental scene break"]');
  await page.waitForFunction(() => Boolean(document.querySelector("iframe")?.contentDocument?.querySelector(".scene-break")), { timeout: 15000 });
  await page.click(".preview-style-button");
  await page.waitForSelector(".theme-sample");
  const themes = await page.$$eval(".theme-sample", (items) => items.length);
  if (themes < 20) throw new Error("Packaged style browser contains only " + themes + " themes.");
  await page.click(".style-category-list button:nth-child(6)");
  const ornaments = await page.$$eval(".ornament-picker button[data-ornament]", (items) => items.length);
  if (ornaments < 20) throw new Error("Packaged ornament browser contains only " + ornaments + " ornaments.");
  await page.click(".style-library-header button");
  const devices = await page.$$eval('select[aria-label="Preview device"] option', (items) => items.length);
  if (devices < 6) throw new Error("Packaged preview contains only " + devices + " device modes.");
  await page.$eval(".rich-editor", (element) => {
    element.focus();
    const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    const words = "Large packaged LibreOffice paragraph verifies that a multi thousand word manuscript cannot make the device or its live preview disappear after paste.";
    const html = Array.from({ length: 210 }, (_, index) => `<p>${words} ${index === 209 ? "PACKAGED LARGE PASTE MARKER" : index + 1}</p>`).join("");
    const transfer = new DataTransfer(); transfer.setData("text/html", html);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.body?.innerText.includes("PACKAGED LARGE PASTE MARKER"), { timeout: 30000 });
  const deviceVisible = await page.evaluate(() => {
    const stage = document.querySelector(".preview-stage").getBoundingClientRect();
    const device = document.querySelector(".reader-device").getBoundingClientRect();
    return device.width > 200 && device.height > 250 && device.left >= stage.left && device.right <= stage.right && device.top >= stage.top && device.bottom <= stage.bottom;
  });
  if (!deviceVisible) throw new Error("Packaged preview device disappeared after a large rich-text paste.");
  await page.click(".section-title-button");
  await page.waitForSelector(".section-title-input");
  await page.click(".section-title-input", { clickCount: 3 });
  await page.keyboard.type("Packaged Renamed Chapter");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".contents-row.selected")?.textContent?.includes("Packaged Renamed Chapter"), { timeout: 15000 });
  page.once("dialog", (dialog) => void dialog.accept());
  await page.click(".section-delete");
  await page.waitForFunction(() => ![...document.querySelectorAll(".contents-row")].some((row) => row.textContent?.includes("Packaged Renamed Chapter")), { timeout: 15000 });
  if (errors.length) throw new Error("Packaged browser errors: " + errors.join("; "));
  console.log("Packaged UI passed: rich-text sample, 4,000-word LibreOffice paste, persistent preview, 20+ ornaments, rename/delete, 20 themes, 6 device profiles.");
} finally {
  browser.disconnect();
}

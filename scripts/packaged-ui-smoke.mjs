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
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Open Sample"));
    button?.click();
  });
  await page.waitForSelector("textarea:not([readonly])", { timeout: 15000 });
  await page.$eval("textarea", (element) => {
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  });
  await page.keyboard.type("\n\nPACKAGED UI DRAFT");
  await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.body?.innerText.includes("PACKAGED UI DRAFT"), { timeout: 15000 });
  await page.click('[title="Insert ornamental scene break"]');
  await page.waitForFunction(() => Boolean(document.querySelector("iframe")?.contentDocument?.querySelector(".scene-break")), { timeout: 15000 });
  await page.click(".preview-style-button");
  await page.waitForSelector(".theme-sample");
  const themes = await page.$$eval(".theme-sample", (items) => items.length);
  if (themes < 20) throw new Error("Packaged style browser contains only " + themes + " themes.");
  await page.click(".style-library-header button");
  const devices = await page.$$eval('select[aria-label="Preview device"] option', (items) => items.length);
  if (devices < 6) throw new Error("Packaged preview contains only " + devices + " device modes.");
  if (errors.length) throw new Error("Packaged browser errors: " + errors.join("; "));
  console.log("Packaged UI passed: editable sample, live draft, ornament, 20 themes, 6 device profiles.");
} finally {
  browser.disconnect();
}

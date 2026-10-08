import puppeteer from "puppeteer";

const debugPort = process.env.FOLIO_E2E_DEBUG_PORT || "43128";
const appPort = process.env.FOLIO_E2E_PORT || "43127";
let browser;

for (let attempt = 0; attempt < 100 && !browser; attempt++) {
  try {
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${debugPort}` });
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
if (!browser) throw new Error("Could not connect to packaged Folio.");

try {
  let page;
  for (let attempt = 0; attempt < 100 && !page; attempt++) {
    const pages = await browser.pages();
    page = pages.find((candidate) => candidate.url().includes(`127.0.0.1:${appPort}`));
    if (!page) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!page) throw new Error("Packaged Folio window was not found.");

  await page.waitForSelector(".start-actions", { timeout: 20000 });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample button is missing.");
    button.click();
  });
  await page.waitForSelector('.rich-editor[contenteditable="true"]', { timeout: 25000 });
  await page.waitForSelector('[data-command="design"]', { timeout: 10000 });
  await page.click('[data-command="design"]');
  await page.waitForSelector(".style-library", { timeout: 10000 });

  const themeCount = await page.$$eval(".theme-sample", (items) => items.length);
  if (themeCount !== 13) throw new Error(`Expected 13 curated themes, found ${themeCount}.`);

  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".style-library button")].find((item) => item.textContent?.trim() === "Theme Lab");
    if (!button) throw new Error("Theme Lab button is missing.");
    button.click();
  });
  await page.waitForSelector('.theme-lab-window[aria-label="Theme Lab"]', { timeout: 10000 });

  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".theme-lab-nav button")]
      .find((item) => item.textContent?.trim() === "Body");
    if (!button) throw new Error("Theme Lab Body panel is missing.");
    button.click();
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".theme-lab-window select option")]
      .some((item) => item.textContent?.trim() === "Gelasio"),
    { timeout: 10000 },
  );
  const fontNames = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll(".theme-lab-window select option"),
      (item) => item.textContent?.trim(),
    ).filter(Boolean)
  );
  for (const required of ["Gelasio", "Newsreader", "EB Garamond", "Libre Baskerville"]) {
    if (!fontNames.includes(required)) throw new Error(`Theme Lab is missing bundled font: ${required}`);
  }
  if (fontNames.includes("Georgia")) throw new Error("Theme Lab still exposes Georgia.");

  const dialogRect = await page.$eval(".theme-lab-window", (element) => {
    const r = element.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
  if (dialogRect.width < 850 || dialogRect.height < 520) {
    throw new Error(`Theme Lab layout is unexpectedly small: ${dialogRect.width}x${dialogRect.height}`);
  }

  console.log("Folio 3.1 packaged smoke passed: sample opens, Design loads, 13 themes render, Theme Lab opens, canonical bundled fonts are exposed, and the builder has desktop layout.");
} finally {
  browser.disconnect();
}

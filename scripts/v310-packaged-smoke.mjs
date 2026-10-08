import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

const clickLabPanel = async (page, name) => {
  await page.evaluate((panel) => {
    const button = [...document.querySelectorAll(".theme-lab-nav button")]
      .find((item) => item.textContent?.trim() === panel);
    if (!button) throw new Error(`Theme Lab panel is missing: ${panel}`);
    button.click();
  }, name);
};

try {
  let page;
  for (let attempt = 0; attempt < 100 && !page; attempt++) {
    const pages = await browser.pages();
    page = pages.find((candidate) => candidate.url().includes(`127.0.0.1:${appPort}`));
    if (!page) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!page) throw new Error("Packaged Folio window was not found.");
  await page.setViewport({ width: 1280, height: 760, deviceScaleFactor: 1 });

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

  const geometry = await page.$eval(".theme-lab-window", (element) => {
    const r = element.getBoundingClientRect();
    return {
      width: r.width,
      height: r.height,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    };
  });
  if (geometry.width < 1000 || geometry.height < 600) {
    throw new Error(`Theme Lab desktop layout is unexpectedly small: ${geometry.width}x${geometry.height}`);
  }
  if (geometry.scrollWidth > geometry.clientWidth + 2) {
    throw new Error(`Theme Lab has horizontal overflow: ${geometry.scrollWidth} > ${geometry.clientWidth}`);
  }

  await page.setViewport({ width: 1000, height: 650, deviceScaleFactor: 1 });
  await page.waitForFunction(() => document.querySelector(".theme-lab-window")?.clientWidth > 0);
  const compactGeometry = await page.$eval(".theme-lab-window", (element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    rect: element.getBoundingClientRect().width,
  }));
  if (compactGeometry.scrollWidth > compactGeometry.clientWidth + 2 || compactGeometry.rect > 990) {
    throw new Error(`Theme Lab overflows the supported minimum window: ${JSON.stringify(compactGeometry)}`);
  }
  await page.setViewport({ width: 1280, height: 760, deviceScaleFactor: 1 });

  await clickLabPanel(page, "Body");
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

  const rangeGeometry = await page.$eval(".theme-lab-range-control", (element) => {
    const r = element.getBoundingClientRect();
    const input = element.querySelector("input");
    const output = element.querySelector("output");
    const ir = input?.getBoundingClientRect();
    const or = output?.getBoundingClientRect();
    return {
      width: r.width,
      inputRight: ir?.right ?? 0,
      outputLeft: or?.left ?? 0,
      outputRight: or?.right ?? 0,
      rowRight: r.right,
    };
  });
  if (rangeGeometry.inputRight > rangeGeometry.outputLeft + 1 || rangeGeometry.outputRight > rangeGeometry.rowRight + 1) {
    throw new Error("Theme Lab range control overlaps or escapes its row.");
  }

  await clickLabPanel(page, "Chapter");
  await page.waitForSelector(".theme-lab-controls .theme-lab-row", { timeout: 5000 });
  await page.waitForFunction(() => {
    const frame = document.querySelector(".theme-lab-preview-stage iframe");
    return Boolean(frame?.contentDocument?.querySelector(".dropcap"));
  }, { timeout: 15000 });

  const dropcapGeometry = await page.evaluate(() => {
    const frame = document.querySelector(".theme-lab-preview-stage iframe");
    const doc = frame?.contentDocument;
    const cap = doc?.querySelector(".dropcap");
    const para = cap?.closest("p");
    if (!cap || !para) return null;
    const cr = cap.getBoundingClientRect();
    const pr = para.getBoundingClientRect();
    const walker = doc.createTreeWalker(para, NodeFilter.SHOW_TEXT);
    let firstTextRect = null;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (cap.contains(node) || !node.data.trim()) continue;
      const range = doc.createRange();
      range.setStart(node, 0);
      range.setEnd(node, Math.min(node.data.length, 12));
      firstTextRect = range.getClientRects()[0] || null;
      if (firstTextRect) break;
    }
    return {
      capWidth: cr.width,
      paraWidth: pr.width,
      capRight: cr.right,
      textLeft: firstTextRect?.left ?? 0,
      capHeight: cr.height,
      paraHeight: pr.height,
    };
  });
  if (!dropcapGeometry) throw new Error("Theme Lab preview has no measurable drop cap.");
  if (dropcapGeometry.capWidth > dropcapGeometry.paraWidth * .42) {
    throw new Error("Theme Lab drop cap consumes too much paragraph width.");
  }
  if (dropcapGeometry.textLeft && dropcapGeometry.textLeft < dropcapGeometry.capRight - 2) {
    throw new Error("Theme Lab drop cap overlaps the first line of body text.");
  }
  if (dropcapGeometry.capHeight > dropcapGeometry.paraHeight * 1.35) {
    throw new Error("Theme Lab drop cap expands beyond the paragraph flow.");
  }

  await clickLabPanel(page, "Ornaments");
  await page.waitForSelector('.theme-lab-artwork-card input[type="file"]', { timeout: 5000 });
  const pngPath = path.join(os.tmpdir(), "folio-theme-lab-smoke.png");
  await fs.writeFile(pngPath, Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8AARAwMDAxQAAAKWgECmKX2WQAAAABJRU5ErkJggg==",
    "base64",
  ));
  const upload = await page.$('.theme-lab-artwork-card input[type="file"]');
  if (!upload) throw new Error("Theme Lab artwork file input is missing.");
  await upload.uploadFile(pngPath);
  await page.waitForSelector(".theme-lab-artwork-drop.has-image img", { timeout: 10000 });

  const imageGeometry = await page.$eval(".theme-lab-artwork-drop.has-image", (element) => {
    const card = element.closest(".theme-lab-artwork-card");
    const img = element.querySelector("img");
    const er = element.getBoundingClientRect();
    const cr = card?.getBoundingClientRect();
    const ir = img?.getBoundingClientRect();
    return {
      dropWidth: er.width,
      cardWidth: cr?.width ?? 0,
      imageWidth: ir?.width ?? 0,
      imageHeight: ir?.height ?? 0,
    };
  });
  if (imageGeometry.dropWidth > imageGeometry.cardWidth + 1 || imageGeometry.imageWidth > imageGeometry.cardWidth + 1 || imageGeometry.imageHeight > 120) {
    throw new Error("Uploaded artwork breaks Theme Lab card geometry.");
  }

  await page.waitForFunction(() => {
    const frame = document.querySelector(".theme-lab-preview-stage iframe");
    const doc = frame?.contentDocument;
    const heading = doc?.querySelector("section.chapter > h1, h1.chapter");
    if (!heading) return false;
    const after = doc.defaultView.getComputedStyle(heading, "::after").backgroundImage;
    const sectionBefore = doc.defaultView.getComputedStyle(heading.closest("section.chapter"), "::before").backgroundImage;
    return String(after).includes("data:image/png") || String(sectionBefore).includes("data:image/png");
  }, { timeout: 15000 });

  console.log("Folio 3.1 Theme Lab packaged smoke passed: stable layout, canonical fonts, safe drop-cap geometry, normal PNG upload, bounded artwork UI, and artwork render in live preview.");
} finally {
  browser.disconnect();
}

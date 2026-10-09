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

  const overlayGeometry = await page.evaluate(() => {
    const layer = document.querySelector(".style-overlay");
    const launcher = document.querySelector(".style-open-theme-lab");
    const r = layer?.getBoundingClientRect();
    const b = launcher?.getBoundingClientRect();
    return {x:r?.left,y:r?.top,width:r?.width,height:r?.height,
      viewportWidth:innerWidth,viewportHeight:innerHeight,buttonWidth:b?.width,
      buttonHeight:b?.height,blur:getComputedStyle(layer).backdropFilter};
  });
  if (Math.abs(overlayGeometry.x) > 1 || Math.abs(overlayGeometry.y) > 1
    || Math.abs(overlayGeometry.width - overlayGeometry.viewportWidth) > 2
    || Math.abs(overlayGeometry.height - overlayGeometry.viewportHeight) > 2) {
    throw new Error("Design blur does not cover entire viewport: " + JSON.stringify(overlayGeometry));
  }
  if (overlayGeometry.buttonWidth < 110 || overlayGeometry.buttonHeight < 30
    || !overlayGeometry.blur.includes("blur(")) {
    throw new Error("Theme Lab launcher/backdrop layout is invalid: " + JSON.stringify(overlayGeometry));
  }
  const launcherLabel = await page.$eval(".style-open-theme-lab", (button) => {
    const bounds = button.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(button);
    const textBounds = range.getBoundingClientRect();
    return {
      text: button.textContent?.trim(), iconCount: button.querySelectorAll("span,svg").length,
      centerError: Math.abs((textBounds.left + textBounds.right) / 2 - (bounds.left + bounds.right) / 2),
    };
  });
  if (launcherLabel.text !== "Theme Lab" || launcherLabel.iconCount !== 0 || launcherLabel.centerError > 3) {
    throw new Error("Theme Lab launcher label or centering regressed: " + JSON.stringify(launcherLabel));
  }

  const themeCount = await page.evaluate(() => document.querySelectorAll(".theme-sample").length);
  if (themeCount !== 13) throw new Error(`Expected 13 curated themes, found ${themeCount}.`);

  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".style-library button")].find((item) => item.textContent?.includes("Theme Lab"));
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
  await page.click(".theme-lab-font-row .folio-font-picker-trigger");
  await page.waitForSelector(".folio-font-picker-panel .folio-font-picker-option", {timeout: 10000});
  const fontNames = await page.$$eval(".folio-font-picker-panel .folio-font-picker-option strong",
    (items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  for (const required of ["Gelasio", "Newsreader", "EB Garamond", "Libre Baskerville", "CAT Altenglisch"]) {
    if (!fontNames.includes(required)) throw new Error("Theme Lab font gallery is missing " + required);
  }
  if (fontNames.includes("Georgia")) throw new Error("Legacy Georgia leaked into font gallery.");
  const specimenCheck = await page.evaluate(() => ({
    inlineSamples: document.querySelectorAll(".folio-font-picker-sample").length,
    optionTexts: [...document.querySelectorAll(".folio-font-picker-panel .folio-font-picker-option span")]
      .map((node) => node.textContent?.trim()),
  }));
  if (specimenCheck.inlineSamples !== 0 || !specimenCheck.optionTexts.length
    || specimenCheck.optionTexts.some((item) => item !== "Write. Format. Publish.")) {
    throw new Error("Font examples must exist only in the dropdown: " + JSON.stringify(specimenCheck));
  }
  await page.evaluate(() => {
    const option = [...document.querySelectorAll(".folio-font-picker-panel .folio-font-picker-option")]
      .find((item) => item.querySelector("strong")?.textContent?.trim() === "Gelasio");
    if (!option) throw new Error("Gelasio cannot be selected.");
    option.click();
  });
  await page.waitForFunction(() => {
    const label = document.querySelector(".theme-lab-font-row .folio-font-picker-selected");
    return label?.textContent?.trim() === "Gelasio";
  });

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

  // Matrix: every bundled family must seat without phantom blank rows.
  // Test both 2-line and 3-line presets in the actual packaged Chromium app.
  const fontMatrix = [
    "Source Serif 4", "Source Sans 3", "EB Garamond", "Libre Caslon Text",
    "Libre Baskerville", "Newsreader", "Gelasio", "Vollkorn",
    "Barlow Condensed", "Bodoni Moda", "Cinzel", "Grenze Gotisch",
    "Roboto Slab", "Jena Gotisch", "Manufacturing Consent", "Kings",
    "CAT Altenglisch", "Slavkappen",
  ];
  const failures = [];
  for (const preset of ["small", "large"]) {
    await page.evaluate((value) => {
      const row = [...document.querySelectorAll(".theme-lab-row")]
        .find((item) => item.textContent?.includes("Drop-cap size"));
      const select = row?.querySelector("select");
      if (!select) throw new Error("Drop-cap preset picker is missing.");
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, preset);
    for (const family of fontMatrix) {
      await page.evaluate(() => {
        const row = [...document.querySelectorAll(".theme-lab-font-row")]
          .find((item) => item.textContent?.includes("Drop-cap typeface"));
        if (!row) throw new Error("Drop-cap family picker is missing.");
        row.querySelector(".folio-font-picker-trigger")?.click();
      });
      await page.waitForSelector(".folio-font-picker-panel .folio-font-picker-option", {timeout:10000});
      await page.evaluate((font) => {
        const button = [...document.querySelectorAll(".folio-font-picker-panel .folio-font-picker-option")]
          .find((item) => item.querySelector("strong")?.textContent?.trim() === font);
        if (!button) throw new Error("Cannot select drop-cap font: " + font);
        button.click();
      }, family);
      try {
        await page.waitForFunction((font, expected) => {
          const doc = document.querySelector(".theme-lab-preview-stage iframe")?.contentDocument;
          const cap = doc?.querySelector(".dropcap");
          return cap && doc.defaultView.getComputedStyle(cap).fontFamily.includes(font)
            && cap.dataset.folioDropcapLines === String(expected)
            && cap.dataset.folioDropcapSeated;
        }, {timeout:15000}, family, preset === "large" ? 3 : 2);
        const m = await page.evaluate(() => {
          const doc = document.querySelector(".theme-lab-preview-stage iframe")?.contentDocument;
          const cap = doc?.querySelector(".dropcap");
          const para = cap?.closest("p");
          if (!cap || !para) return null;
          const walker = doc.createTreeWalker(para, NodeFilter.SHOW_TEXT);
          let body = null;
          while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!cap.contains(node) && node.data.trim()) { body = node; break; }
          }
          if (!body) return null;
          const range = doc.createRange();
          range.setStart(body,0);
          range.setEnd(body,Math.min(8,body.data.length));
          const text = range.getClientRects()[0];
          if (!text) return null;
          const cr = cap.getBoundingClientRect();
          const style = doc.defaultView.getComputedStyle(cap);
          const bodyStyle = doc.defaultView.getComputedStyle(para);
          const canvas = doc.createElement("canvas").getContext("2d");
          canvas.font = style.fontStyle+" "+style.fontWeight+" "+style.fontSize+" "+style.fontFamily;
          const ink = canvas.measureText(cap.textContent?.trim() || "S");
          return {
            seated:cap.dataset.folioDropcapSeated,
            wrapped:+(cap.dataset.folioDropcapWrappedLines || 0),
            lines:+(cap.dataset.folioDropcapLines || 0),
            capWidth:cr.width,
            paraWidth:para.getBoundingClientRect().width,
            bodySize:Number.parseFloat(bodyStyle.fontSize),
            visualGap:text.left - cr.left - ink.actualBoundingBoxRight,
            textIndent:Number.parseFloat(bodyStyle.textIndent) || 0,
          };
        });
        if (!m || m.seated !== "true" || m.wrapped !== m.lines || Math.abs(m.textIndent) > .5
            || m.capWidth > m.paraWidth*.41 || m.visualGap < -2.5
            || m.visualGap > Math.max(11, m.bodySize*.72)) {
          failures.push({preset,family,metrics:m});
        }
      } catch (error) {
        failures.push({preset,family,error:String(error)});
      }
    }
  }
  if (failures.length) throw new Error("Drop-cap font matrix failed: " + JSON.stringify(failures));
  console.log("Drop-cap matrix passed: " + fontMatrix.length + " bundled families × Small/Large.");

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

  // Regression: Apply to Book must survive the server round-trip, .folio flush,
  // a subsequent reload and reopening the modal. Old adopt() kept stale React state.
  const saveResponse = page.waitForResponse((response) =>
    /\/api\/projects\/[^/]+\/typography$/.test(new URL(response.url()).pathname)
      && response.request().method() === "POST", { timeout: 30000 });
  await page.click(".theme-lab-footer .theme-lab-button.primary");
  const applied = await (await saveResponse).json();
  await page.waitForFunction(() => !document.querySelector(".theme-lab-window"), { timeout: 30000 });
  if (applied.typography?.themeLab?.bodyFont !== "Gelasio"
    || applied.typography.themeLab.chapterOrnament?.dataUrl?.startsWith("data:image/png") !== true
    || !applied.typography.themeLab.enabled) {
    throw new Error("Applied Theme Lab typography/artwork did not persist in the returned book: "
      + JSON.stringify(applied.typography?.themeLab).slice(0, 600));
  }
  async function assertSavedBook(id, expected) {
    const saved = await page.evaluate(async (projectId) => {
      const response = await fetch(`/api/projects/${projectId}/reload`, { method: "POST" });
      if (!response.ok) throw new Error("Book reload failed: " + response.status);
      return response.json();
    }, id);
    const lab = saved.typography?.themeLab;
    if (lab?.name !== expected.name || lab?.bodyFont !== expected.bodyFont
      || lab?.paper !== expected.paper || saved.meta.theme !== expected.baseTheme) {
      throw new Error("Theme was lost during project reload: " + JSON.stringify({
        actual: { name: lab?.name, bodyFont: lab?.bodyFont, paper: lab?.paper, baseTheme: saved.meta.theme },
        expected,
      }));
    }
  }
  await assertSavedBook(applied.projectId, {
    name: applied.typography.themeLab.name, bodyFont: "Gelasio",
    paper: applied.typography.themeLab.paper, baseTheme: applied.meta.theme,
  });

  async function reopenThemeLab() {
    await page.click('[data-command="design"]');
    await page.waitForSelector(".style-library");
    await page.click(".style-open-theme-lab");
    await page.waitForSelector(".theme-lab-window");
  }
  await reopenThemeLab();
  await clickLabPanel(page, "Body");
  await page.waitForFunction(() => document.querySelector(".theme-lab-font-row .folio-font-picker-selected")?.textContent?.trim() === "Gelasio");

  // Imported theme packages must also replace the active book configuration.
  const imported = {
    format: "folio-theme", version: 1, baseTheme: applied.meta.theme,
    config: {
      enabled: true, name: "QA Imported Theme", paper: "#f3ede2", ink: "#292929",
      accent: "#8e6246", bodyFont: "Vollkorn", headingFont: "EB Garamond",
      titlePageFont: "EB Garamond", dropcapFont: "Gelasio",
      dropcap: true, dropcapSize: "small", bodySize: 1.06, lineHeight: 1.55,
    },
  };
  const importPath = path.join(os.tmpdir(), "folio-theme-lab-import-smoke.folio-theme.json");
  await fs.writeFile(importPath, JSON.stringify(imported), "utf8");
  const importInput = await page.$(".theme-lab-hidden-input");
  if (!importInput) throw new Error("Import Theme file control is missing.");
  await importInput.uploadFile(importPath);
  await clickLabPanel(page, "Foundation");
  await page.waitForFunction(() =>
    document.querySelector(".theme-lab-window input[maxlength='64']")?.value === "QA Imported Theme");
  const importedResponse = page.waitForResponse((response) =>
    /\/api\/projects\/[^/]+\/typography$/.test(new URL(response.url()).pathname)
      && response.request().method() === "POST", { timeout: 30000 });
  await page.click(".theme-lab-footer .theme-lab-button.primary");
  const importedBook = await (await importedResponse).json();
  await page.waitForFunction(() => !document.querySelector(".theme-lab-window"), { timeout: 30000 });
  await assertSavedBook(importedBook.projectId, {
    name: "QA Imported Theme", bodyFont: "Vollkorn",
    paper: "#f3ede2", baseTheme: imported.baseTheme,
  });

  // Copy this edited book into a genuine .folio container, close it and reopen it
  // from disk. A green in-memory preview is not proof that the book was saved.
  const savedFolioPath = path.join(os.tmpdir(), `folio-theme-lab-roundtrip-${process.pid}.folio`);
  await fs.rm(savedFolioPath, { force: true });
  const folioCopy = await page.evaluate(async ({ folder, projectPath }) => {
    const response = await fetch("/api/projects/import-folder", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder, path: projectPath }),
    });
    if (!response.ok) throw new Error("Could not create round-trip .folio: " + await response.text());
    return response.json();
  }, { folder: importedBook.folder, projectPath: savedFolioPath });
  await page.evaluate(async (id) => {
    const flushed = await fetch(`/api/projects/${id}/flush`, { method: "POST" });
    if (!flushed.ok) throw new Error("Could not flush .folio.");
    const closed = await fetch(`/api/projects/${id}/close`, { method: "POST" });
    if (!closed.ok) throw new Error("Could not close .folio.");
  }, folioCopy.projectId);
  const reopenedBook = await page.evaluate(async (projectPath) => {
    const response = await fetch("/api/projects/open-file", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath }),
    });
    if (!response.ok) throw new Error("Could not reopen saved .folio: " + await response.text());
    return response.json();
  }, savedFolioPath);
  const onDiskLab = reopenedBook.typography?.themeLab;
  if (onDiskLab?.name !== "QA Imported Theme" || onDiskLab.bodyFont !== "Vollkorn"
    || onDiskLab.paper !== "#f3ede2" || reopenedBook.meta.theme !== imported.baseTheme) {
    throw new Error("Imported theme was not preserved inside the .folio file.");
  }
  await page.evaluate(async (id) => {
    const response = await fetch(`/api/projects/${id}/close`, { method: "POST" });
    if (!response.ok) throw new Error("Could not close round-trip project.");
  }, reopenedBook.projectId);
  await fs.rm(savedFolioPath, { force: true });

  await reopenThemeLab();
  await clickLabPanel(page, "Body");
  await page.waitForFunction(() =>
    document.querySelector(".theme-lab-font-row .folio-font-picker-selected")?.textContent?.trim() === "Vollkorn");
  await page.click(".theme-lab-close");

  console.log("Folio 3.1 Theme Lab packaged smoke passed: launcher centering, dropdown-only font specimens, drop-cap matrix, artwork preview, Apply to Book persistence, reload, and imported theme round-trip.");
} finally {
  browser.disconnect();
}

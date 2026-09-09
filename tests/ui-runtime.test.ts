import express from "express";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log("  " + (ok ? "✓" : "✗") + " " + label + (detail ? " — " + detail : ""));
  ok ? pass++ : fail++;
};

async function stage<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new Error(`UI stage failed: ${name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

const app = express();
app.use(express.json({ limit: "5mb" }));
registerApi(app);
registerEditorApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "web", "dist", "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
const emptyBook = await fs.mkdtemp(path.join(os.tmpdir(), "folio-ui-empty-"));
const coverFixture = path.join(os.tmpdir(), `folio-cover-${Date.now()}.png`);
await fs.writeFile(coverFixture, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));

console.log("\nFolio browser UI");
try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  let pickedFolder: string | null = null;
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (pickedFolder && request.method() === "POST" && request.url().endsWith("/api/pick-folder")) {
      const path = pickedFolder;
      pickedFolder = null;
      void request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ path }) });
    } else {
      void request.continue();
    }
  });
  page.setDefaultTimeout(15000);
  await page.setViewport({ width: 1440, height: 900 });
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await stage("load workspace", () => page.goto(base, { waitUntil: "networkidle0" }));
  await stage("click Open Sample", () => page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample button is missing");
    (button as HTMLButtonElement).click();
  }));
  await stage("sample rich editor", () => page.waitForSelector('.rich-editor[contenteditable="true"]'));
  check("sample opens in a genuinely editable rich-text surface", await page.$eval(".rich-editor", (el) => (el as HTMLElement).contentEditable === "true"));

  await page.$eval(".rich-editor", (el) => {
    const editor = el as HTMLElement;
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor); range.collapse(false);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  });
  await page.keyboard.press("Enter");
  await page.keyboard.type("BROWSER LIVE DRAFT");
  await stage("sample live draft preview", () => page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.body?.innerText.includes("BROWSER LIVE DRAFT")));
  check("typing updates the visible device preview before autosave", true);

  await page.$eval(".rich-editor", (el) => {
    const editor = el as HTMLElement;
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
    selection?.removeAllRanges(); selection?.addRange(range);
    const transfer = new DataTransfer();
    transfer.setData("text/html", "<html><head><style>.T1{font-weight:bold}</style></head><body><p>Libre first <span class=\"T1\">bold</span></p><p>Libre second</p><ul><li>Writer list</li></ul></body></html>");
    editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await stage("LibreOffice rich paste", () => page.waitForFunction(() => {
    const markdown = (document.querySelector(".rich-editor") as HTMLElement)?.dataset.markdown ?? "";
    return markdown.includes("Libre first **bold**") && markdown.includes("Libre second") && markdown.includes("- Writer list");
  }));
  check("Writer class-based rich text preserves paragraphs, bold and lists", true);

  await page.$eval(".rich-editor", (el) => {
    const editor = el as HTMLElement;
    editor.focus();
    const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    const transfer = new DataTransfer(); transfer.setData("text/plain", "Plain Writer first paragraph\r\nPlain Writer second paragraph");
    editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await stage("plain Writer paragraphs", () => page.waitForFunction(() => (document.querySelector(".rich-editor") as HTMLElement)?.dataset.markdown?.includes("Plain Writer first paragraph\n\nPlain Writer second paragraph")));
  check("plain-text Writer paste keeps physical paragraphs instead of one run-on block", true);

  await page.click('[title="Insert ornamental scene break"]');
  await stage("ornamental break preview", () => page.waitForFunction(() => Boolean(document.querySelector("iframe")?.contentDocument?.querySelector(".scene-break"))));
  check("ornamental break button inserts a semantic break and renders the ornament", await page.$eval(".rich-editor", (el) => (el as HTMLElement).dataset.markdown?.includes("---") ?? false));
  await stage("sample autosave", () => page.waitForFunction(() => document.querySelector(".save-indicator")?.textContent === "Saved", { timeout: 10000 }));
  check("the browser flow reaches Saved instead of Save failed", true);

  await page.click(".preview-style-button");
  await stage("open visual theme gallery", () => page.waitForSelector(".theme-sample"));
  const themeCount = await page.$$eval(".theme-sample", (items) => items.length);
  const distinctCards = await page.$$eval(".theme-sample", (items) => {
    const signatures = items.map((item) => {
      const title = item.querySelector(".sample-title")!;
      const chapter = item.querySelector(".sample-chapter")!;
      const a = getComputedStyle(item);
      const b = getComputedStyle(title);
      const c = getComputedStyle(chapter);
      return [a.textAlign, a.alignItems, b.fontFamily, b.fontSize, b.fontStyle, b.fontWeight, b.textTransform, b.borderTopWidth, b.borderBottomWidth, b.borderLeftWidth, c.letterSpacing].join("|");
    });
    return new Set(signatures).size;
  });
  check("style browser exposes all 20 visual themes", themeCount >= 20, String(themeCount));
  check("theme cards have materially different visual signatures", distinctCards >= 15, String(distinctCards) + " distinct");

  await page.click(".style-category-list button:nth-child(6)");
  const ornamentCount = await page.$$eval(".ornament-picker button[data-ornament]", (items) => items.length);
  check("scene-break browser offers at least 20 visual ornaments", ornamentCount >= 20, String(ornamentCount));
  await page.click('.ornament-picker button[data-ornament="❖"]');
  await stage("live ornament selection", () => page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.querySelector(".scene-break")?.textContent?.includes("❖")));
  check("choosing an ornament updates the real preview immediately", true);
  await page.click(".style-category-list button:first-child");

  await page.click('.theme-sample[data-theme="editorial"]');
  await stage("render Editorial theme", () => page.waitForFunction(() => {
    const h1 = document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter > h1");
    return h1 ? parseFloat(getComputedStyle(h1).borderTopWidth) > 0 : false;
  }));
  const editorial = await page.evaluate(() => {
    const h1 = document.querySelector("iframe")!.contentDocument!.querySelector("section.chapter > h1")!;
    const css = getComputedStyle(h1);
    return css.textAlign + "|" + css.borderTopWidth + "|" + css.fontFamily;
  });
  await page.click('.theme-sample[data-theme="blackletter"]');
  await stage("render Blackletter theme", () => page.waitForFunction(() => {
    const h1 = document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter > h1");
    return Boolean(h1 && getComputedStyle(h1).fontFamily.includes("Old English"));
  }));
  const blackletter = await page.evaluate(() => {
    const h1 = document.querySelector("iframe")!.contentDocument!.querySelector("section.chapter > h1")!;
    const css = getComputedStyle(h1);
    return css.textAlign + "|" + css.borderTopWidth + "|" + css.fontFamily;
  });
  check("selecting themes changes the actual book layout, not only the name", editorial !== blackletter, editorial + " / " + blackletter);
  await page.evaluate(() => {
    const headingButton = [...document.querySelectorAll(".style-category-list button")].find((button) => button.textContent === "Chapter Heading");
    (headingButton as HTMLButtonElement | undefined)?.click();
  });
  await stage("chapter label control", () => page.waitForFunction(() => [...document.querySelectorAll(".customize-row > span")].some((node) => node.textContent === "Show theme label")));
  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".customize-row")].find((node) => node.querySelector("span")?.textContent === "Show theme label");
    (row?.querySelector('input[type="checkbox"]') as HTMLInputElement | null)?.click();
  });
  await stage("hide generated chapter label", () => page.waitForFunction(() => {
    const heading = document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter > h1");
    return heading ? getComputedStyle(heading, "::before").display === "none" : false;
  }));
  check("theme-generated chapter labels such as CHAPTER can be hidden", true);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".customize-row")].find((node) => node.querySelector("span")?.textContent === "Show theme label");
    (row?.querySelector('input[type="checkbox"]') as HTMLInputElement | null)?.click();
  });
  await page.click(".style-library-header button");

  const deviceModes = await page.$$eval('select[aria-label="Preview device"] option', (items) => items.map((item) => (item as HTMLOptionElement).value));
  check("preview offers Kindle, tablet, phone, Android and print profiles", deviceModes.length === 6, deviceModes.join(", "));
  await page.select('select[aria-label="Preview device"]', "iphone");
  await stage("switch to iPhone device", () => page.waitForSelector(".reader-device.device-iphone"));
  await stage("phone justified layout", () => page.waitForFunction(() => {
    const paragraph = document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter > p");
    return paragraph ? getComputedStyle(paragraph).textAlign === "justify" && getComputedStyle(paragraph).textAlignLast === "left" : false;
  }));
  check("Justified means justified on narrow readers, with a ragged final line", true);
  const centered = await page.evaluate(() => {
    const stage = document.querySelector(".preview-stage")!.getBoundingClientRect();
    const device = document.querySelector(".reader-device")!.getBoundingClientRect();
    return Math.abs((stage.left + stage.right) / 2 - (device.left + device.right) / 2) < 2;
  });
  check("device preview is geometrically centered in the right pane", centered);

  await page.$eval(".rich-editor", (el) => {
    const editor = el as HTMLElement;
    editor.focus();
    const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    const paragraph = "W Polsce i na świecie najprawdopodobniej profesjonalne formatowanie całej książki powinno zachowywać wszystkie akapity oraz wyróżnienia bez niekontrolowanych odstępów pomiędzy zwyczajnymi słowami podczas dokładnego podglądu czytnika.";
    // Writer emits a full HTML document, named paragraph classes, verbose
    // inline declarations and many spans. This is deliberately over 100,000
    // words — a clean 4k-word fragment did not reproduce the real failure.
    const rows = Array.from({ length: 5200 }, (_, index) =>
      `<p class="P1" style="margin-top:0cm;margin-bottom:0.212cm;line-height:115%;orphans:2;widows:2;text-autospace:ideograph-other"><span class="T1">${paragraph} </span><span class="T2" style="font-weight:bold">${index === 5199 ? "WHOLE BOOK FINAL MARKER" : `fragment ${index + 1}`}</span></p>`,
    ).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>.P1{font-family:Liberation Serif}.T1{font-style:normal}.T2{font-weight:bold}</style></head><body lang="pl-PL" dir="ltr">${rows}</body></html>`;
    const transfer = new DataTransfer(); transfer.setData("text/html", html);
    editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await stage("whole-book rich-text editor state", () => page.waitForFunction(() => {
    const markdown = (document.querySelector(".rich-editor") as HTMLElement)?.dataset.markdown ?? "";
    return markdown.includes("WHOLE BOOK FINAL MARKER") && (markdown.match(/\S+/g)?.length ?? 0) > 100_000;
  }, { timeout: 30000 }));
  await stage("immediate whole-book preview", () => page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.body?.innerText.includes("WHOLE BOOK FINAL MARKER"), { timeout: 30000 }));
  await page.setViewport({ width: 1180, height: 700 });
  const visibleAfterLargePaste = await page.evaluate(() => {
    const shell = document.querySelector(".folio-shell") as HTMLElement;
    const editor = document.querySelector(".rich-editor") as HTMLElement;
    const previewScroller = document.querySelector("iframe")?.contentDocument?.scrollingElement as HTMLElement | null;
    const stage = document.querySelector(".preview-stage")!.getBoundingClientRect();
    const device = document.querySelector(".reader-device")!.getBoundingClientRect();
    editor.scrollTop = editor.scrollHeight;
    if (previewScroller) previewScroller.scrollTop = previewScroller.scrollHeight;
    const shellRect = shell.getBoundingClientRect();
    return shellRect.top === 0 && shellRect.bottom <= innerHeight + 1 && document.documentElement.scrollHeight <= innerHeight + 1 &&
      editor.scrollHeight > editor.clientHeight && editor.scrollTop > 0 &&
      Boolean(previewScroller && previewScroller.scrollHeight > previewScroller.clientHeight && previewScroller.scrollTop > 0) &&
      device.width > 150 && device.height > 250 && device.left >= stage.left && device.right <= stage.right && device.top >= stage.top && device.bottom <= stage.bottom;
  });
  check("100,000-word paste keeps both panes fixed while only editor text scrolls", visibleAfterLargePaste);
  await stage("whole-book autosave", () => page.waitForFunction(() => document.querySelector(".save-indicator")?.textContent === "Saved", { timeout: 60000 }));
  check("the complete pasted book reaches autosave", true);

  await page.click(".preview-style-button");
  await stage("whole-book typography controls", () => page.waitForSelector(".style-category-list"));
  await page.evaluate(() => {
    const bodyButton = [...document.querySelectorAll(".style-category-list button")].find((button) => button.textContent === "Body");
    (bodyButton as HTMLButtonElement | undefined)?.click();
  });
  await stage("body alignment control", () => page.waitForFunction(() => [...document.querySelectorAll(".customize-row > span")].some((node) => node.textContent === "Alignment")));
  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".customize-row")].find((node) => node.querySelector("span")?.textContent === "Alignment");
    const select = row?.querySelector("select") as HTMLSelectElement | null;
    if (!select) throw new Error("Alignment control is missing");
    select.value = "justify";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.click(".style-library-header button");
  await page.select('select[aria-label="Preview device"]', "kindle-oasis");
  await stage("Polish professional justification", () => page.waitForFunction(() => {
    const doc = document.querySelector("iframe")?.contentDocument;
    const paragraph = doc?.querySelector("section.chapter > p");
    return Boolean(paragraph && getComputedStyle(paragraph).textAlign === "justify" && getComputedStyle(paragraph).textAlignLast === "left" && doc?.body.textContent?.includes("\u00ad") && doc?.body.textContent?.includes("W\u00a0Polsce"));
  }, { timeout: 30000 }));
  check("Polish justification uses discretionary word breaks and a ragged final line", true);
  await stage("ornament remains centered under justification", () => page.waitForFunction(() => {
    const ornament = document.querySelector("iframe")?.contentDocument?.querySelector(".scene-break");
    return ornament ? getComputedStyle(ornament).textAlign === "center" && getComputedStyle(ornament).textAlignLast === "center" : false;
  }));
  check("justified body text never pulls ornamental breaks off center", true);
  const dropcapBeforeDeviceChange = await page.evaluate(() => Boolean(document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter > p .dropcap")));
  await page.select('select[aria-label="Preview device"]', "iphone");
  await stage("narrow justified composition", () => page.waitForFunction(() => {
    const paragraph = document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter > p");
    return paragraph ? getComputedStyle(paragraph).textAlign === "justify" && getComputedStyle(paragraph).textAlignLast === "left" : false;
  }));
  check("narrow readers honor the selected justification and keep final lines natural", true);
  await stage("drop cap survives device change", () => page.waitForFunction(() => Boolean(document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter > p .dropcap"))));
  check("drop caps survive switching preview devices", dropcapBeforeDeviceChange);

  await page.click(".footer-add");
  await stage("open Add Content", () => page.waitForSelector(".add-chapter-box input"));
  await page.click(".add-chapter-box input", { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.keyboard.type("UI Added Chapter");
  await page.click(".add-chapter-box button");
  await stage("create named chapter", () => page.waitForFunction(() => [...document.querySelectorAll(".contents-row")].some((row) => row.textContent?.includes("UI Added Chapter"))));
  await stage("new chapter editable", () => page.waitForSelector('.rich-editor[contenteditable="true"]'));
  check("Add Content creates and selects an editable chapter", await page.$eval(".contents-row.selected", (el) => el.textContent?.includes("UI Added Chapter") ?? false));

  await page.click(".section-title-button");
  await stage("chapter title editor", () => page.waitForSelector(".section-title-input"));
  await page.click(".section-title-input", { clickCount: 3 });
  await page.keyboard.type("Renamed in UI");
  await page.keyboard.press("Enter");
  await stage("chapter renamed", () => page.waitForFunction(() => document.querySelector(".contents-row.selected")?.textContent?.includes("Renamed in UI")));
  check("chapter name can be edited from the title bar", true);

  await page.click(".section-subtitle-button");
  await stage("chapter subtitle editor", () => page.waitForSelector(".section-subtitle-input"));
  await page.click(".section-subtitle-input");
  await page.keyboard.type("Editable subtitle");
  await page.keyboard.press("Enter");
  await stage("chapter subtitle preview", () => page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.querySelector(".chapter-subtitle")?.textContent?.includes("Editable subtitle")));
  check("chapter subtitle can be added from the title bar and updates the preview", true);

  await page.click(".rich-editor");
  await page.keyboard.type(" DELETED CHAPTER PREVIEW MARKER");
  await stage("deleted-chapter marker preview", () => page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.body?.innerText.includes("DELETED CHAPTER PREVIEW MARKER")));

  page.once("dialog", (dialog) => void dialog.accept());
  await page.click(".section-delete");
  await stage("chapter deleted", () => page.waitForFunction(() => ![...document.querySelectorAll(".contents-row")].some((row) => row.textContent?.includes("Renamed in UI"))));
  check("chapter delete removes it from Contents", true);
  await stage("deleted chapter removed from preview", () => page.waitForFunction(() => !document.querySelector("iframe")?.contentDocument?.body?.innerText.includes("DELETED CHAPTER PREVIEW MARKER")));
  check("deleted chapter text cannot remain in the preview", true);

  pickedFolder = emptyBook;
  await page.click('[title="Open another book"]');
  await stage("open empty folder", () => page.waitForSelector(".empty-project-editor"));
  check("opening a new project in the same app clears the previous manuscript and preview", !(await page.$("iframe")) && !(await page.$eval("body", (body) => body.innerText.includes("WHOLE BOOK FINAL MARKER"))));
  check("an empty folder shows an actionable empty state instead of Loading section", true);
  await page.click(".empty-project-editor button");
  await stage("empty folder Add Content", () => page.waitForSelector(".add-chapter-box input"));
  await page.click(".add-chapter-box input", { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.keyboard.type("First Real Chapter");
  await page.click(".add-chapter-box button");
  await stage("first chapter editable", () => page.waitForSelector('.rich-editor[contenteditable="true"]'));
  await page.click(".rich-editor");
  await page.keyboard.type("The book can now be written.");
  await stage("first chapter live preview", () => page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.body?.innerText.includes("The book can now be written.")));
  check("a blank new book can add, edit and preview its first chapter", true);

  await page.click(".footer-add");
  await stage("front matter choices", () => page.waitForSelector(".content-kind-group"));
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".content-kind-group button")].find((item) => item.querySelector("span")?.textContent === "Dedication");
    (button as HTMLButtonElement | undefined)?.click();
  });
  await stage("editable front matter selected", () => page.waitForFunction(() => document.querySelector(".contents-row.selected")?.textContent?.includes("Dedication") && Boolean(document.querySelector(".section-delete"))));
  page.once("dialog", (dialog) => void dialog.accept());
  await page.click(".section-delete");
  await stage("front matter deleted", () => page.waitForFunction(() => ![...document.querySelectorAll(".contents-row")].some((row) => row.textContent?.includes("Dedication"))));
  check("editable front matter can be deleted from the same title-bar control", true);

  await page.click(".footer-add");
  await stage("back matter choices", () => page.waitForSelector(".content-kind-group"));
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".content-kind-group button")].find((item) => item.querySelector("span")?.textContent === "About the Author");
    (button as HTMLButtonElement | undefined)?.click();
  });
  await stage("editable back matter selected", () => page.waitForFunction(() => document.querySelector(".contents-row.selected")?.textContent?.includes("About the Author") && Boolean(document.querySelector(".section-delete"))));
  page.once("dialog", (dialog) => void dialog.accept());
  await page.click(".section-delete");
  await stage("back matter deleted", () => page.waitForFunction(() => ![...document.querySelectorAll(".contents-row")].some((row) => row.textContent?.includes("About the Author"))));
  check("editable back matter can be deleted from the same title-bar control", true);

  await page.click(".book-identity");
  await stage("open Book Details", () => page.waitForSelector('.folio-dialog[aria-label="Book Details"]'));
  const coverInput = await page.$('.cover-field input[type="file"]');
  await coverInput!.uploadFile(coverFixture);
  await stage("cover upload", () => page.waitForSelector(".cover-thumbnail img"));
  check("Book Details can add and display a real EPUB cover", true);
  const titleInput = await page.$(".details-grid .dialog-field input");
  await titleInput!.click();
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("Born Tied");
  await page.evaluate(() => {
    const dialog = document.querySelector('.folio-dialog[aria-label="Book Details"]')!;
    const save = [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Save");
    save?.click();
  });
  await stage("save Book Details", () => page.waitForFunction(() => document.querySelector(".book-title")?.textContent === "Born Tied"));
  check("Book Details controls generated title and copyright pages", true);
  check("no browser runtime errors occurred", browserErrors.length === 0, browserErrors.join("; "));
  await page.close();
} catch (error) {
  check("browser scenario completed", false, error instanceof Error ? error.message : String(error));
} finally {
  await closeBrowser();
  server.close();
  await fs.rm(emptyBook, { recursive: true, force: true });
  await fs.rm(coverFixture, { force: true });
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);

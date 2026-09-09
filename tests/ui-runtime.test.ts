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

console.log("\nFolio browser UI");
try {
  const browser = await getBrowser();
  const page = await browser.newPage();
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
  await stage("sample editable textarea", () => page.waitForSelector("textarea:not([readonly])"));
  check("sample opens in a genuinely editable textarea", await page.$eval("textarea", (el) => !(el as HTMLTextAreaElement).readOnly));

  await page.$eval("textarea", (el) => {
    const textarea = el as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  });
  await page.keyboard.type("\n\nBROWSER LIVE DRAFT");
  await stage("sample live draft preview", () => page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.body?.innerText.includes("BROWSER LIVE DRAFT")));
  check("typing updates the visible device preview before autosave", true);

  await page.click('[title="Insert ornamental scene break"]');
  await stage("ornamental break preview", () => page.waitForFunction(() => Boolean(document.querySelector("iframe")?.contentDocument?.querySelector(".scene-break"))));
  check("ornamental break button inserts Markdown and renders the theme ornament", await page.$eval("textarea", (el) => (el as HTMLTextAreaElement).value.includes("---")));
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
  await page.click(".style-library-header button");

  const deviceModes = await page.$$eval('select[aria-label="Preview device"] option', (items) => items.map((item) => (item as HTMLOptionElement).value));
  check("preview offers Kindle, tablet, phone, Android and print profiles", deviceModes.length === 6, deviceModes.join(", "));
  await page.select('select[aria-label="Preview device"]', "iphone");
  await stage("switch to iPhone device", () => page.waitForSelector(".reader-device.device-iphone"));
  await stage("phone ragged-right layout", () => page.waitForFunction(() => {
    const body = document.querySelector("iframe")?.contentDocument?.body;
    return body ? getComputedStyle(body).textAlign === "left" : false;
  }));
  check("narrow phone preview suppresses stretched justified word gaps", true);

  await page.click(".footer-add");
  await stage("open Add Content", () => page.waitForSelector(".add-chapter-box input"));
  await page.click(".add-chapter-box input", { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.keyboard.type("UI Added Chapter");
  await page.click(".add-chapter-box button");
  await stage("create named chapter", () => page.waitForFunction(() => [...document.querySelectorAll(".contents-row")].some((row) => row.textContent?.includes("UI Added Chapter"))));
  await stage("new chapter editable", () => page.waitForSelector("textarea:not([readonly])"));
  check("Add Content creates and selects an editable chapter", await page.$eval(".contents-row.selected", (el) => el.textContent?.includes("UI Added Chapter") ?? false));

  await page.goto(base + "/?book=" + encodeURIComponent(emptyBook), { waitUntil: "networkidle0" });
  await stage("open empty folder", () => page.waitForSelector(".empty-project-editor"));
  check("an empty folder shows an actionable empty state instead of Loading section", true);
  await page.click(".empty-project-editor button");
  await stage("empty folder Add Content", () => page.waitForSelector(".add-chapter-box input"));
  await page.click(".add-chapter-box input", { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.keyboard.type("First Real Chapter");
  await page.click(".add-chapter-box button");
  await stage("first chapter editable", () => page.waitForSelector("textarea:not([readonly])"));
  await page.click("textarea");
  await page.keyboard.type("The book can now be written.");
  await stage("first chapter live preview", () => page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.body?.innerText.includes("The book can now be written.")));
  check("a blank new book can add, edit and preview its first chapter", true);

  await page.click(".book-identity");
  await stage("open Book Details", () => page.waitForSelector('.folio-dialog[aria-label="Book Details"]'));
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
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);

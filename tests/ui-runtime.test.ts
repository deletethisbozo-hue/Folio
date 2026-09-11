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

  await page.click(".contents-row:not(.chapter-row)");
  await stage("generated title page", () => page.waitForSelector('.rich-editor[contenteditable="false"]'));
  await stage("title page authoritative preview", () => page.waitForFunction(() => Boolean(document.querySelector("iframe")?.contentDocument?.querySelector("section.titlepage .tp-author"))));
  const generatedPage = await page.evaluate(() => {
    const editor = document.querySelector(".rich-editor") as HTMLElement;
    const frame = document.querySelector("iframe")?.contentDocument;
    return {
      visibleEditorText: editor.innerText,
      visiblePreviewText: frame?.body.innerText ?? "",
      hasDropcap: Boolean(frame?.querySelector(".dropcap")),
      hasTitleHyphen: Boolean(frame?.querySelector("section.titlepage")?.textContent?.includes("\u00ad")),
    };
  });
  check("generated title page never exposes internal HTML in editor or preview", !generatedPage.visibleEditorText.includes("<p class=") && !generatedPage.visiblePreviewText.includes("<p class="));
  check("title/front matter receives neither drop caps nor discretionary hyphens", !generatedPage.hasDropcap && !generatedPage.hasTitleHyphen);
  const frontRowsBeforeDelete = await page.$$eval(".contents-list > .contents-row:not(.chapter-row)", (rows) => rows.length);
  await stage("generated front matter delete button ready", () => page.waitForFunction(() => {
    const button = document.querySelector(".section-delete") as HTMLButtonElement | null;
    return Boolean(button && !button.disabled);
  }));
  page.once("dialog", (dialog) => void dialog.accept());
  const deletionResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "DELETE" && /\/api\/projects\/[^/]+\/sections\//.test(response.url()),
    { timeout: 30000 },
  );
  await page.click(".section-delete");
  const deletionResponse = await stage("generated front matter DELETE response", () => deletionResponsePromise);
  if (!deletionResponse.ok()) {
    throw new Error(`Generated front matter DELETE failed with HTTP ${deletionResponse.status()}: ${await deletionResponse.text()}`);
  }
  await stage("generated front matter deletion", () => page.waitForFunction((before) =>
    document.querySelectorAll(".contents-list > .contents-row:not(.chapter-row)").length === before - 1,
    { timeout: 30000 },
    frontRowsBeforeDelete,
  ));
  check("generated title/front matter can be removed from the book", true);
  await page.click(".chapter-row");
  await stage("return to manuscript chapter", () => page.waitForSelector('.rich-editor[contenteditable="true"]'));

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
    const transfer = new DataTransfer();
    transfer.setData("text/html", "<p>Może<br>był nawet<br>nazbyt dociekliwy, lecz odpowiedział spokojnie.</p>");
    editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await stage("soft visual line paste", () => page.waitForFunction(() => {
    const editor = document.querySelector(".rich-editor") as HTMLElement;
    const preview = document.querySelector("iframe")?.contentDocument;
    const markdown = editor.dataset.markdown ?? "";
    return markdown.replace(/\s+/g, " ").includes("Może był nawet nazbyt dociekliwy") &&
      !markdown.includes("Może  \n") && !preview?.querySelector("section.chapter > p br");
  }));
  check("Writer visual line endings reflow instead of forcing stretched justified lines", true);

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

  await page.evaluate(() => {
    const frame = document.querySelector("iframe") as HTMLIFrameElement | null;
    const scroller = frame?.contentDocument?.scrollingElement as HTMLElement | null;
    if (scroller) scroller.scrollTop = Math.max(1, Math.floor(scroller.scrollHeight * .55));
    (window as any).__folioFrameLoads = 0;
    frame?.addEventListener("load", () => (window as any).__folioFrameLoads++);
  });
  await page.click('[data-command="design"]');
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
  check("style browser exposes all 30 visual themes", themeCount >= 30, String(themeCount));
  check("theme cards have materially different visual signatures", distinctCards >= 24, String(distinctCards) + " distinct");

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
  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".customize-row")].find((node) => node.querySelector("span")?.textContent === "Label text");
    const input = row?.querySelector("input") as HTMLInputElement | null;
    if (!input) throw new Error("Chapter label text input is missing");
    input.focus();
    input.select();
  });
  await page.keyboard.type("ROZDZIAŁ");
  await stage("numbered custom chapter label", () => page.waitForFunction(() => {
    const heading = document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter > h1");
    return heading ? getComputedStyle(heading, "::before").content.includes("ROZDZIAŁ 1") : false;
  }));
  check("arbitrary chapter label text is automatically numbered", true);
  await page.click(".style-library-header button");

  const deviceModes = await page.$$eval('select[aria-label="Preview device"] option', (items) => items.map((item) => (item as HTMLOptionElement).value));
  check("preview offers Kindle, tablet, phone, Android and print profiles", deviceModes.length === 6, deviceModes.join(", "));
  await page.select('select[aria-label="Preview device"]', "iphone");
  await stage("switch to iPhone device", () => page.waitForSelector(".reader-device.device-iphone"));
  await stage("phone justified layout", () => page.waitForFunction(() => {
    const paragraph = document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter > p");
    return Boolean(paragraph?.classList.contains("folio-composed") && paragraph.querySelector(".folio-composed-line"));
  }));
  check("Justified preview uses the bounded paragraph compositor", true);
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
  await page.$eval(".rich-editor", (el) => {
    const editor = el as HTMLElement;
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor); range.collapse(false);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  });
  const trustedTypingStarted = Date.now();
  await page.keyboard.type(" TRUSTED LARGE TYPING MARKER", { delay: 5 });
  await stage("trusted large-manuscript typing reaches model", () => page.waitForFunction(() =>
    (document.querySelector(".rich-editor") as HTMLElement)?.dataset.markdown?.includes("TRUSTED LARGE TYPING MARKER"), { timeout: 5000 }));
  await stage("trusted large-manuscript typing reaches preview", () => page.waitForFunction(() =>
    document.querySelector("iframe")?.contentDocument?.body?.innerText.includes("TRUSTED LARGE TYPING MARKER"), { timeout: 8000 }));
  check("trusted keyboard input stays responsive after a 100,000-word paste", Date.now() - trustedTypingStarted <= 8000);
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

  await page.click('[data-command="design"]');
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
  await new Promise((resolve) => setTimeout(resolve, 900));
  const stableStyleUpdate = await page.evaluate(() => ({
    loads: (window as any).__folioFrameLoads,
    scroll: (document.querySelector("iframe")?.contentDocument?.scrollingElement as HTMLElement | null)?.scrollTop ?? 0,
  }));
  check("style changes patch preview in place without reloading or losing reading position", stableStyleUpdate.loads === 0 && stableStyleUpdate.scroll > 0, JSON.stringify(stableStyleUpdate));
  await page.select('select[aria-label="Preview device"]', "kindle-oasis");
  await stage("Polish professional justification", () => page.waitForFunction(() => {
    const doc = document.querySelector("iframe")?.contentDocument;
    if (!doc || !/^pl(?:-|$)/i.test(doc.documentElement.lang || "")) return false;
    const paragraphs = [...doc.querySelectorAll<HTMLElement>("section.chapter > p.folio-composed")];
    const activeParagraph = paragraphs.find((paragraph) =>
      Boolean(paragraph.querySelector(".folio-line-justified") && paragraph.lastElementChild?.classList.contains("folio-line-natural"))
    );
    if (!activeParagraph) return false;
    const hasEmergencyLine = Boolean(activeParagraph.querySelector('.folio-line-emergency,[data-folio-emergency="true"]'));
    // U+00AD is an implementation detail of discretionary hyphenation. Strip it
    // before checking the Polish one-letter-preposition NBSP contract, otherwise
    // a legal breakpoint inside the following word makes the semantic assertion
    // fail even though both preprocessing steps worked correctly.
    const semanticText = (doc.body.textContent ?? "").replace(/\u00ad/g, "");
    return !hasEmergencyLine && semanticText.includes("W\u00a0Polsce");
  }, { timeout: 30000 }));
  check("Polish justification uses paragraph-wide breaks and a natural final line", true);
  const boundedWordGaps = await page.evaluate(() => {
    const doc = document.querySelector("iframe")?.contentDocument;
    if (!doc) return false;
    return [...doc.querySelectorAll<HTMLElement>(".folio-line-justified")].slice(0, 100).every((line) => {
      const words = [...line.querySelectorAll<HTMLElement>(".folio-word")];
      const limit = Number.parseFloat(getComputedStyle(line).fontSize) * .49;
      return words.slice(1).every((word, index) => word.getBoundingClientRect().left - words[index].getBoundingClientRect().right <= limit);
    });
  });
  check("professional compositor places a hard ceiling on expanded word gaps", boundedWordGaps);
  const professionalGeometry = await page.evaluate(() => {
    const doc = document.querySelector("iframe")?.contentDocument;
    const paragraph = [...(doc?.querySelectorAll<HTMLElement>("section.chapter > p.folio-composed") ?? [])]
      .find((candidate) => Boolean(candidate.querySelector(".folio-line-justified")));
    if (!doc || !paragraph) return { ok: false, reason: "missing composed paragraph" };
    const lines = [...paragraph.querySelectorAll<HTMLElement>(":scope > .folio-composed-line")];
    if (lines.length < 2) return { ok: false, reason: "too few composed lines" };
    const justified = lines.slice(0, -1).filter((line) => line.classList.contains("folio-line-justified"));
    const errors = justified.map((line) => {
      const lineRect = line.getBoundingClientRect();
      const range = doc.createRange();
      range.selectNodeContents(line);
      const contentRect = range.getBoundingClientRect();
      return Math.abs(lineRect.right - contentRect.right);
    });
    const fontSize = Number.parseFloat(getComputedStyle(paragraph).fontSize) || 16;
    const wordSpacing = justified.map((line) => Math.abs(Number(line.dataset.folioWordSpacing ?? 0)));
    const tracking = justified.map((line) => Math.abs(Number(line.dataset.folioTracking ?? 0)));
    const semanticGaps: number[] = [];
    for (const line of justified.slice(0, 12)) {
      const words = [...line.querySelectorAll<HTMLElement>(".folio-word")];
      for (let index = 1; index < words.length; index++) {
        if (words[index].dataset.folioSpaceBefore !== "true") continue;
        semanticGaps.push(words[index].getBoundingClientRect().left - words[index - 1].getBoundingClientRect().right);
      }
    }
    const cap = paragraph.querySelector<HTMLElement>(":scope > .dropcap.folio-composed-cap");
    let dropcapOk = true;
    if (cap) {
      const capRect = cap.getBoundingClientRect();
      const first = lines[0].getBoundingClientRect();
      const paragraphRect = paragraph.getBoundingClientRect();
      const later = lines.slice(2).map((line) => line.getBoundingClientRect()).find((rect) => Math.abs(rect.left - paragraphRect.left) < fontSize * .35);
      dropcapOk = first.left >= capRect.right - 1 && Boolean(later);
    }
    return {
      ok: justified.length > 0 &&
        Math.max(...errors, 0) <= 1.75 &&
        Math.max(...wordSpacing, 0) <= fontSize * .116 &&
        Math.max(...tracking, 0) <= fontSize * .0056 &&
        Math.max(...semanticGaps, 0) <= fontSize * .42 &&
        lines.at(-1)?.classList.contains("folio-line-natural") === true &&
        dropcapOk,
      maxRightError: Math.max(...errors, 0),
      maxWordSpacing: Math.max(...wordSpacing, 0),
      maxTracking: Math.max(...tracking, 0),
      maxSemanticGap: Math.max(...semanticGaps, 0),
      dropcapOk,
    };
  });
  check("non-final lines really reach the measure inside professional spacing limits", professionalGeometry.ok, JSON.stringify(professionalGeometry));

  const studioGeometry = await page.evaluate(() => {
    const shell = document.querySelector(".folio-shell")!.getBoundingClientRect();
    const command = document.querySelector(".folio-commandbar")!.getBoundingClientRect();
    const library = document.querySelector(".library-pane")!.getBoundingClientRect();
    const editorPane = document.querySelector(".editor-pane")!.getBoundingClientRect();
    const manuscript = document.querySelector(".manuscript-editor")!.getBoundingClientRect();
    const preview = document.querySelector(".preview-pane")!.getBoundingClientRect();
    const selected = getComputedStyle(document.querySelector(".contents-row.selected")!);
    const sidebar = getComputedStyle(document.querySelector(".library-pane")!);
    const title = getComputedStyle(document.querySelector(".section-title")!);
    return {
      ok: command.height >= 46 && library.width >= 190 && preview.width >= 390 && preview.width <= 470 &&
        manuscript.width < editorPane.width - 20 && manuscript.left > editorPane.left + 10 &&
        Number.parseFloat(title.fontSize) >= 18 && sidebar.backgroundImage === "none" &&
        selected.borderRadius === "0px" && shell.bottom <= innerHeight + 1,
      command: command.height,
      library: library.width,
      preview: preview.width,
      manuscript: manuscript.width,
      editor: editorPane.width,
      titleSize: title.fontSize,
      sidebarImage: sidebar.backgroundImage,
      selectedRadius: selected.borderRadius,
    };
  });
  check("1.0.7 keeps a legible professional preview beside the manuscript", studioGeometry.ok, JSON.stringify(studioGeometry));
  await stage("ornament remains centered under justification", () => page.waitForFunction(() => {
    const ornament = document.querySelector("iframe")?.contentDocument?.querySelector(".scene-break");
    return ornament ? getComputedStyle(ornament).textAlign === "center" && getComputedStyle(ornament).textAlignLast === "center" : false;
  }));
  check("justified body text never pulls ornamental breaks off center", true);
  const dropcapBeforeDeviceChange = await page.evaluate(() => Boolean(document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter > p .dropcap")));
  await page.select('select[aria-label="Preview device"]', "iphone");
  await stage("narrow justified composition", () => page.waitForFunction(() => {
    const paragraph = document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter > p");
    return Boolean(paragraph?.classList.contains("folio-composed") && paragraph.querySelector(".folio-composed-line"));
  }));
  check("narrow readers honor the selected justification and keep final lines natural", true);
  await stage("drop cap survives device change", () => page.waitForFunction(() => Boolean(document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter > p .dropcap"))));
  check("drop caps survive switching preview devices", dropcapBeforeDeviceChange);

  const chapterCountBeforeAdd = await page.$$eval(".contents-row.chapter-row", (rows) => rows.length);
  const addedChapterNumber = chapterCountBeforeAdd + 1;
  await page.click(".footer-add");
  await stage("open Add Content", () => page.waitForSelector(".add-chapter-box input"));
  await page.click(".add-chapter-box input", { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.keyboard.type("UI Added Chapter");
  await page.click(".add-chapter-box button");
  await stage("create named chapter", () => page.waitForFunction(() => [...document.querySelectorAll(".contents-row")].some((row) => row.textContent?.includes("UI Added Chapter"))));
  await stage("new chapter editable", () => page.waitForSelector('.rich-editor[contenteditable="true"]'));
  check("Add Content creates and selects an editable chapter", await page.$eval(".contents-row.selected", (el) => el.textContent?.includes("UI Added Chapter") ?? false));
  await stage("new chapter gets next automatic label number", async () => {
    try {
      await page.waitForFunction((expected) => {
        const heading = document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter > h1");
        return heading ? getComputedStyle(heading, "::before").content.includes(`ROZDZIAŁ ${expected}`) : false;
      }, { timeout: 30000 }, addedChapterNumber);
    } catch (error) {
      const snapshot = await page.evaluate(() => {
        const frameDoc = document.querySelector("iframe")?.contentDocument;
        const heading = frameDoc?.querySelector("section.chapter > h1");
        return {
          selected: document.querySelector(".contents-row.selected")?.textContent ?? null,
          chapterNumber: document.querySelector(".contents-row.selected .chapter-number")?.textContent ?? null,
          heading: heading?.outerHTML ?? null,
          before: heading ? getComputedStyle(heading, "::before").content : null,
          liveCss: frameDoc?.getElementById("folio-live-chapter-label")?.textContent ?? null,
          labelCss: [...(frameDoc?.querySelectorAll("style") ?? [])].map((style) => style.textContent).find((css) => css?.includes("ROZDZIAŁ")) ?? null,
        };
      });
      throw new Error(`${error instanceof Error ? error.message : String(error)}; ${JSON.stringify(snapshot)}`);
    }
  });
  await page.click('.section-move[title="Move chapter up"]');
  await stage("chapter reorder persists in UI", () => page.waitForFunction((expected) => document.querySelector(".contents-row.selected .chapter-number")?.textContent === `${expected}.`, {}, addedChapterNumber - 1));
  await stage("reordered chapter label renumbers", () => page.waitForFunction((expected) => {
    const heading = document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter > h1");
    return heading ? getComputedStyle(heading, "::before").content.includes(`ROZDZIAŁ ${expected}`) : false;
  }, {}, addedChapterNumber - 1));
  check("chapter arrows reorder sources and labels follow current order", true);

  await page.click(".rich-editor");
  await page.keyboard.type("HEADING EDITS MUST PRESERVE THIS ENTIRE CHAPTER BODY.");
  await stage("heading-safety body autosave", () => page.waitForFunction(() => document.querySelector(".save-indicator")?.textContent === "Saved"));

  await page.click(".section-title-button");
  await stage("chapter title editor", () => page.waitForSelector(".section-title-input"));
  await page.click(".section-title-input");
  await page.$eval(".section-title-input", (el) => (el as HTMLInputElement).select());
  await page.keyboard.type("Renamed in UI");
  await page.keyboard.press("Enter");
  await stage("chapter renamed", () => page.waitForFunction(() => document.querySelector(".contents-row.selected")?.textContent?.includes("Renamed in UI")));
  await stage("renamed chapter body reloaded", () => page.waitForFunction(() => document.querySelector(".rich-editor")?.getAttribute("data-markdown")?.includes("HEADING EDITS MUST PRESERVE THIS ENTIRE CHAPTER BODY")));
  check("chapter name can be edited without deleting its body", true);

  await page.click(".section-subtitle-button");
  await stage("chapter subtitle editor", () => page.waitForSelector(".section-subtitle-input"));
  await page.click(".section-subtitle-input");
  await page.keyboard.type("Editable subtitle");
  check("chapter subtitle field receives keyboard input", await page.$eval(".section-subtitle-input", (el) => (el as HTMLInputElement).value === "Editable subtitle"));
  await page.keyboard.press("Enter");
  await stage("chapter subtitle preview", async () => {
    try {
      await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.querySelector(".chapter-subtitle")?.textContent?.replace(/\u00ad/g, "").includes("Editable subtitle"));
    } catch (error) {
      const snapshot = await page.evaluate(() => {
        const frame = document.querySelector("iframe") as HTMLIFrameElement | null;
        const frameDoc = frame?.contentDocument;
        return {
          active: (document.activeElement as HTMLElement | null)?.className ?? null,
          selected: document.querySelector(".contents-row.selected")?.textContent ?? null,
          subtitleButton: document.querySelector(".section-subtitle-button")?.textContent ?? null,
          subtitleInput: (document.querySelector(".section-subtitle-input") as HTMLInputElement | null)?.value ?? null,
          subtitleDisabled: (document.querySelector(".section-subtitle-button") as HTMLButtonElement | null)?.disabled ?? null,
          save: document.querySelector(".save-indicator")?.textContent ?? null,
          appError: document.querySelector(".global-error")?.textContent ?? null,
          previewLoading: Boolean(document.querySelector(".preview-loading")),
          previewError: document.querySelector(".preview-error")?.textContent ?? null,
          frameReady: frameDoc?.readyState ?? null,
          frameTitle: frameDoc?.querySelector("section.chapter > h1")?.textContent ?? null,
          frameSubtitle: frameDoc?.querySelector(".chapter-subtitle")?.textContent ?? null,
          frameBody: frameDoc?.body?.innerText.slice(0, 300) ?? null,
        };
      });
      throw new Error(`${error instanceof Error ? error.message : String(error)}; snapshot=${JSON.stringify(snapshot)}`);
    }
  });
  check("chapter subtitle can be added without deleting its body", await page.$eval(".rich-editor", (el) => (el as HTMLElement).dataset.markdown?.includes("HEADING EDITS MUST PRESERVE THIS ENTIRE CHAPTER BODY") ?? false));

  await page.click(".rich-editor");
  await page.keyboard.type(" DELETED CHAPTER PREVIEW MARKER");
  check("post-subtitle typing reaches the editor model", await page.$eval(".rich-editor", (el) => (el as HTMLElement).dataset.markdown?.includes("DELETED CHAPTER PREVIEW MARKER") ?? false));
  await stage("deleted-chapter marker preview", async () => {
    try {
      await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.body?.textContent
        ?.replace(/[\u00ad-]/g, "")
        .includes("DELETED CHAPTER PREVIEW MARKER"));
    } catch (error) {
      const snapshot = await page.evaluate(() => {
        const editor = document.querySelector(".rich-editor") as HTMLElement | null;
        const frameDoc = (document.querySelector("iframe") as HTMLIFrameElement | null)?.contentDocument;
        return {
          active: (document.activeElement as HTMLElement | null)?.className ?? null,
          editorHasMarker: editor?.dataset.markdown?.includes("DELETED CHAPTER PREVIEW MARKER") ?? null,
          editorTail: editor?.dataset.markdown?.slice(-120) ?? null,
          selected: document.querySelector(".contents-row.selected")?.textContent ?? null,
          subtitle: document.querySelector(".section-subtitle-button")?.textContent ?? null,
          save: document.querySelector(".save-indicator")?.textContent ?? null,
          appError: document.querySelector(".global-error")?.textContent ?? null,
          frameTitle: frameDoc?.querySelector("section.chapter > h1")?.textContent ?? null,
          frameSubtitle: frameDoc?.querySelector(".chapter-subtitle")?.textContent ?? null,
          frameTail: frameDoc?.body?.innerText.replace(/\u00ad/g, "").slice(-200) ?? null,
        };
      });
      throw new Error(`${error instanceof Error ? error.message : String(error)}; snapshot=${JSON.stringify(snapshot)}`);
    }
  });

  page.once("dialog", (dialog) => void dialog.accept());
  await page.click(".section-delete");
  await stage("chapter deleted", () => page.waitForFunction(() => ![...document.querySelectorAll(".contents-row")].some((row) => row.textContent?.includes("Renamed in UI"))));
  check("chapter delete removes it from Contents", true);
  await stage("deleted chapter removed from preview", () => page.waitForFunction(() => !document.querySelector("iframe")?.contentDocument?.body?.textContent
    ?.replace(/[\u00ad-]/g, "")
    .includes("DELETED CHAPTER PREVIEW MARKER")));
  check("deleted chapter text cannot remain in the preview", true);

  pickedFolder = emptyBook;
  await page.click('[title="Open another book"]');
  await stage("open empty folder", () => page.waitForSelector(".empty-project-editor"));
  check("opening a new project in the same app clears the previous manuscript and preview", !(await page.$("iframe")) && !(await page.$eval("body", (body) => body.innerText.includes("WHOLE BOOK FINAL MARKER"))));
  check("an empty folder shows an actionable empty state instead of Loading section", true);
  await page.click(".footer-add");
  await stage("empty folder Add Content", () => page.waitForSelector(".add-chapter-box input"));
  await page.click(".add-chapter-box input", { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.keyboard.type("First Real Chapter");
  await page.click(".add-chapter-box button");
  await stage("first chapter editable", () => page.waitForSelector('.rich-editor[contenteditable="true"]'));
  await page.click(".rich-editor");
  await page.keyboard.type("The book can now be written.");
  await stage("first chapter live preview", () => page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.body?.textContent
    ?.replace(/[\u00ad-]/g, "")
    .includes("The book can now be written.")));
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

import express from "express";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";
import { contourAlphaPng } from "./fixtures/contour-alpha.ts";

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? passed++ : failed++;
};

const app = express();
app.use(express.json({ limit: "5mb" }));
registerApi(app);
registerEditorApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "web", "dist", "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
const fixture = path.join(os.tmpdir(), `folio-v6-opener-${Date.now()}.png`);
await fs.writeFile(fixture, contourAlphaPng);

console.log("\nFolio illustration V6 chapter opener + drop cap stability");

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(base, { waitUntil: "networkidle0" });

  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample button missing");
    (button as HTMLButtonElement).click();
  });
  await page.waitForSelector('.rich-editor[contenteditable="true"]');

  // Use a theme that historically hard-coded its own drop-cap font-size.
  // V6 passed on themes without that override and therefore missed the real bug.
  await page.click('button[data-command="design"]');
  await page.waitForSelector('.style-library[aria-label="Book style library"]');
  await page.evaluate(() => {
    const bookStyle = [...document.querySelectorAll<HTMLButtonElement>(".style-category-list button")]
      .find((item) => item.textContent?.trim() === "Book Style");
    bookStyle?.click();
  });
  await page.waitForSelector('button[data-theme="aubade"]');
  await page.click('button[data-theme="aubade"]');
  await page.evaluate(() => {
    const done = [...document.querySelectorAll<HTMLButtonElement>(".style-library-footer button")]
      .find((button) => button.textContent?.trim() === "Done");
    done?.click();
  });

  const openFirstParagraphSettings = async () => {
    await page.click('button[data-command="design"]');
    await page.waitForSelector('.style-library[aria-label="Book style library"]');
    await page.evaluate(() => {
      const button = [...document.querySelectorAll<HTMLButtonElement>(".style-category-list button")]
        .find((item) => item.textContent?.trim() === "First Paragraph");
      if (!button) throw new Error("First Paragraph style category missing");
      button.click();
    });
    await page.waitForFunction(() => [...document.querySelectorAll(".customize-row > span")].some((node) => node.textContent?.trim() === "Drop cap"));
  };

  await openFirstParagraphSettings();
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLLabelElement>(".customize-row")];
    const dropRow = rows.find((row) => row.querySelector("span")?.textContent?.trim() === "Drop cap");
    const sizeRow = rows.find((row) => row.querySelector("span")?.textContent?.trim() === "Drop cap size");
    const checkbox = dropRow?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const select = sizeRow?.querySelector<HTMLSelectElement>("select");
    if (!checkbox || !select) throw new Error("Drop cap controls missing");
    if (!checkbox.checked) checkbox.click();
    select.value = "small";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.evaluate(() => {
    const done = [...document.querySelectorAll<HTMLButtonElement>(".style-library-footer button")]
      .find((button) => button.textContent?.trim() === "Done");
    done?.click();
  });

  await page.waitForFunction(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const cap = doc?.querySelector<HTMLElement>("section.chapter .dropcap");
    const para = cap?.closest("p");
    if (!cap || !para) return false;
    const capSize = parseFloat(getComputedStyle(cap).fontSize);
    const bodySize = parseFloat(getComputedStyle(para).fontSize);
    return Number.isFinite(capSize) && Number.isFinite(bodySize) && capSize >= bodySize * 2.5;
  });

  const measureDropcap = async () => page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const cap = doc?.querySelector<HTMLElement>("section.chapter .dropcap");
    const para = cap?.closest("p");
    if (!doc || !cap || !para) return null;
    const cr = cap.getBoundingClientRect();
    const pr = para.getBoundingClientRect();
    let bodyText: Text | null = null;
    const walker = doc.createTreeWalker(para, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (cap.contains(node) || !node.data.trim()) continue;
      bodyText = node;
      break;
    }
    let firstLineLeft: number | null = null;
    let firstLineTop: number | null = null;
    if (bodyText) {
      const range = doc.createRange();
      range.setStart(bodyText, 0);
      range.setEnd(bodyText, Math.min(10, bodyText.data.length));
      const rr = range.getClientRects()[0];
      firstLineLeft = rr?.left ?? null;
      firstLineTop = rr?.top ?? null;
    }
    return {
      fontSize: parseFloat(getComputedStyle(cap).fontSize),
      capTopFromParagraph: cr.top - pr.top,
      capLeftFromParagraph: cr.left - pr.left,
      firstLineTopFromParagraph: firstLineTop == null ? null : firstLineTop - pr.top,
      firstLineLeftFromParagraph: firstLineLeft == null ? null : firstLineLeft - pr.left,
    };
  });

  const baseline = await measureDropcap();
  if (!baseline) throw new Error("Baseline drop cap geometry unavailable");

  // Insert normally, then use the same direct manipulation path a user uses to
  // move the illustration to the very top of chapter body.
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".rich-editor");
    const paragraphs = [...(editor?.querySelectorAll<HTMLElement>(":scope > p") ?? [])];
    const target = paragraphs.find((p) => (p.textContent?.trim().length ?? 0) > 80);
    if (!target) throw new Error("No insertion paragraph");
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  const upload = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/illustration")
  );
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.click(".illustration-button")]);
  await chooser.accept([fixture]);
  if (!(await upload).ok()) throw new Error("V6 opener fixture upload failed");
  await page.waitForSelector(".editor-illustration img[data-folio-asset]");

  const boxes = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".rich-editor");
    const image = editor?.querySelector<HTMLImageElement>(".editor-illustration img[data-folio-asset]");
    if (!editor || !image) return null;
    return { editor: editor.getBoundingClientRect().toJSON(), image: image.getBoundingClientRect().toJSON() };
  });
  if (!boxes) throw new Error("Illustration geometry unavailable");

  await page.mouse.move(boxes.image.left + boxes.image.width / 2, boxes.image.top + Math.min(50, boxes.image.height / 2));
  await page.mouse.down();
  await page.mouse.move(boxes.editor.left + boxes.editor.width * 0.82, boxes.editor.top + 3, { steps: 16 });
  await page.mouse.up();

  await page.waitForFunction(() => {
    const figure = document.querySelector<HTMLElement>(".rich-editor > .editor-illustration");
    return Boolean(
      figure?.classList.contains("folio-chapter-opener-editor") &&
      figure.dataset.folioWrap === "right" &&
      getComputedStyle(figure).float === "none"
    );
  });

  const editorOpenerLayout = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".rich-editor");
    const opener = editor?.querySelector<HTMLElement>(":scope > .editor-illustration.folio-chapter-opener-editor");
    if (!editor || !opener) return null;
    let para = opener.nextElementSibling as HTMLElement | null;
    while (para && (para.tagName !== "P" || !(para.textContent?.trim()))) para = para.nextElementSibling as HTMLElement | null;
    if (!para) return null;
    const or = opener.getBoundingClientRect();
    const pr = para.getBoundingClientRect();
    const style = getComputedStyle(opener);
    return {
      float: style.float,
      shapeOutside: style.shapeOutside,
      opener: or.toJSON(),
      paragraph: pr.toJSON(),
      overlaps: or.bottom > pr.top + 1 && or.top < pr.bottom - 1,
    };
  });
  check("editor chapter opener never covers first paragraph",
    Boolean(editorOpenerLayout && editorOpenerLayout.float === "none" && editorOpenerLayout.shapeOutside === "none" && !editorOpenerLayout.overlaps),
    JSON.stringify(editorOpenerLayout));
  if (!editorOpenerLayout || editorOpenerLayout.overlaps) throw new Error("Editor opener overlaps first paragraph");

  await page.waitForFunction(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const opener = doc?.querySelector<HTMLElement>("section.chapter > .folio-illustration-block.folio-chapter-opener");
    const para = doc?.querySelector<HTMLElement>("section.chapter > p .dropcap")?.closest("p");
    if (!opener || !para) return false;
    const or = opener.getBoundingClientRect();
    const pr = para.getBoundingClientRect();
    return getComputedStyle(opener).float === "none" && getComputedStyle(opener).shapeOutside === "none" && pr.top >= or.bottom - 1;
  });

  const after = await measureDropcap();
  if (!after) throw new Error("Drop cap geometry after opener unavailable");
  const invariant =
    Math.abs(after.fontSize - baseline.fontSize) < 0.2 &&
    Math.abs(after.capTopFromParagraph - baseline.capTopFromParagraph) < 1.5 &&
    Math.abs((after.firstLineTopFromParagraph ?? 0) - (baseline.firstLineTopFromParagraph ?? 0)) < 1.5;
  check("chapter opener does not change drop cap metrics", invariant, JSON.stringify({ baseline, after }));
  if (!invariant) throw new Error("Chapter opener changed drop cap geometry");

  const openerLayout = await page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const opener = doc?.querySelector<HTMLElement>("section.chapter > .folio-illustration-block.folio-chapter-opener");
    const heading = doc?.querySelector<HTMLElement>("section.chapter > h1");
    const para = doc?.querySelector<HTMLElement>("section.chapter > p .dropcap")?.closest("p");
    if (!opener || !heading || !para) return null;
    const or = opener.getBoundingClientRect();
    const hr = heading.getBoundingClientRect();
    const pr = para.getBoundingClientRect();
    return {
      float: getComputedStyle(opener).float,
      headingGap: or.top - hr.bottom,
      paragraphGap: pr.top - or.bottom,
      alignRight: Math.abs(or.right - (opener.parentElement?.getBoundingClientRect().right ?? or.right)),
    };
  });
  check("chapter opener is tight to the chapter heading and non-wrapping",
    Boolean(openerLayout && openerLayout.float === "none" && openerLayout.headingGap <= 18 && openerLayout.paragraphGap >= -1),
    JSON.stringify(openerLayout));
  if (!openerLayout || openerLayout.headingGap > 18) throw new Error("Chapter opener is still too far from heading");

  await openFirstParagraphSettings();
  const authoritativePreview = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "POST" && /\/preview(?:\?|$)/.test(new URL(response.url()).pathname);
  }, { timeout: 20000 }).catch(() => null);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll<HTMLLabelElement>(".customize-row")]
      .find((item) => item.querySelector("span")?.textContent?.trim() === "Drop cap size");
    const select = row?.querySelector<HTMLSelectElement>("select");
    if (!select) throw new Error("Drop cap size selector missing");
    select.value = "medium";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.evaluate(() => {
    const done = [...document.querySelectorAll<HTMLButtonElement>(".style-library-footer button")]
      .find((button) => button.textContent?.trim() === "Done");
    done?.click();
  });
  await page.waitForFunction((smallSize) => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const cap = doc?.querySelector<HTMLElement>("section.chapter .dropcap");
    return Boolean(cap && parseFloat(getComputedStyle(cap).fontSize) > Number(smallSize) * 1.15);
  }, {}, baseline.fontSize);

  await authoritativePreview;
  await new Promise((resolve) => setTimeout(resolve, 250));
  const medium = await measureDropcap();
  check("Medium drop cap stays larger after authoritative server preview",
    Boolean(medium && medium.fontSize > baseline.fontSize * 1.15),
    JSON.stringify({ small: baseline.fontSize, medium: medium?.fontSize }));
  if (!medium || medium.fontSize <= baseline.fontSize * 1.15) throw new Error("Drop cap size override disappeared after server preview");

  await page.close();
} catch (error) {
  failed++;
  console.error("✗ illustration V6 chapter opener scenario completed");
  console.error(error);
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(fixture, { force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

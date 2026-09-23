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
  const aubadePreview = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "POST" && /\/preview(?:\?|$)/.test(new URL(response.url()).pathname);
  }, { timeout: 20000 });
  await page.click('button[data-theme="aubade"]');
  await page.evaluate(() => {
    const done = [...document.querySelectorAll<HTMLButtonElement>(".style-library-footer button")]
      .find((button) => button.textContent?.trim() === "Done");
    done?.click();
  });
  await aubadePreview;
  await page.waitForFunction(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    return getComputedStyle(doc?.body ?? document.body).backgroundColor === "rgb(255, 247, 234)";
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

  const measureDropcapFontSize = async () => page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const cap = doc?.querySelector<HTMLElement>("section.chapter .dropcap");
    return cap ? parseFloat(getComputedStyle(cap).fontSize) : null;
  });

  await openFirstParagraphSettings();
  const pickerState = await page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLLabelElement>(".customize-row")];
    const size = rows.find((row) => row.querySelector("span")?.textContent?.trim() === "Drop cap size")
      ?.querySelector<HTMLSelectElement>("select");
    const font = rows.find((row) => row.querySelector("span")?.textContent?.trim() === "Drop cap typeface")
      ?.querySelector<HTMLSelectElement>("select");
    return {
      sizeValue: size?.value,
      sizeOptions: [...(size?.options ?? [])].map((option) => ({ value: option.value, text: option.textContent?.trim() })),
      fontOptions: [...(font?.options ?? [])].map((option) => option.textContent?.trim()),
    };
  });
  const hasSeparateThemeAndSmall =
    pickerState.sizeValue === "theme" &&
    pickerState.sizeOptions.some((option) => option.value === "theme" && option.text === "Current theme size") &&
    pickerState.sizeOptions.some((option) => option.value === "small" && option.text === "Small");
  check("Current theme size and Small are separate drop-cap states", hasSeparateThemeAndSmall, JSON.stringify(pickerState.sizeOptions));
  if (!hasSeparateThemeAndSmall) throw new Error("Drop cap size picker still aliases theme default to Small");

  const requestedFonts = ["Jena Gotisch", "Manufacturing Consent", "Kings", "CAT Altenglisch", "Slavkappen"];
  const hasRequestedFonts = requestedFonts.every((name) => pickerState.fontOptions.includes(name));
  check("Drop cap font picker exposes all requested licensed fonts", hasRequestedFonts, JSON.stringify(pickerState.fontOptions));
  if (!hasRequestedFonts) throw new Error("Drop cap font picker is missing requested fonts");

  const bookStylesFont = await page.$eval(".style-library-header h2", (node) => getComputedStyle(node).fontFamily);
  const uiFontOk = !/Georgia|Times New Roman/i.test(bookStylesFont);
  check("Book Styles header keeps the UI sans-serif font", uiFontOk, bookStylesFont);
  if (!uiFontOk) throw new Error("Book Styles header fell back to manuscript serif font");

  await page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLLabelElement>(".customize-row")];
    const dropRow = rows.find((row) => row.querySelector("span")?.textContent?.trim() === "Drop cap");
    const checkbox = dropRow?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!checkbox) throw new Error("Drop cap checkbox missing");
    if (!checkbox.checked) checkbox.click();
  });
  await page.evaluate(() => {
    const done = [...document.querySelectorAll<HTMLButtonElement>(".style-library-footer button")]
      .find((button) => button.textContent?.trim() === "Done");
    done?.click();
  });
  await page.waitForFunction(() => Boolean(
    document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument?.querySelector("section.chapter .dropcap")
  ));
  const themeDefaultSize = await measureDropcapFontSize();
  if (!themeDefaultSize) throw new Error("Theme-default drop cap size unavailable");
  const themeDefaultBodySize = await page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const para = doc?.querySelector<HTMLElement>("section.chapter > p");
    return para ? parseFloat(getComputedStyle(para).fontSize) : null;
  });
  const themeDefaultIsRealDropcap = Boolean(
    themeDefaultBodySize &&
    themeDefaultSize >= themeDefaultBodySize * 2.5
  );
  check("Current theme size renders as an actual drop cap",
    themeDefaultIsRealDropcap,
    JSON.stringify({ themeDefaultSize, themeDefaultBodySize }));
  if (!themeDefaultIsRealDropcap) throw new Error("Current theme size collapsed to body-text size");

  await openFirstParagraphSettings();
  const smallPreview = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "POST" && /\/preview(?:\?|$)/.test(new URL(response.url()).pathname);
  }, { timeout: 20000 });
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLLabelElement>(".customize-row")];
    const sizeRow = rows.find((row) => row.querySelector("span")?.textContent?.trim() === "Drop cap size");
    const select = sizeRow?.querySelector<HTMLSelectElement>("select");
    if (!select) throw new Error("Drop cap size selector missing");
    select.value = "small";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const done = [...document.querySelectorAll<HTMLButtonElement>(".style-library-footer button")]
      .find((button) => button.textContent?.trim() === "Done");
    done?.click();
  });
  await smallPreview;
  await page.waitForFunction(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const cap = doc?.querySelector<HTMLElement>("section.chapter .dropcap");
    const para = cap?.closest<HTMLElement>("p");
    if (!cap || !para) return false;
    const capSize = parseFloat(getComputedStyle(cap).fontSize);
    const bodySize = parseFloat(getComputedStyle(para).fontSize);
    return Number.isFinite(capSize) && Number.isFinite(bodySize) &&
      Math.abs(capSize - bodySize * 3) < 0.45 &&
      para.classList.contains("folio-native-dropcap") &&
      cap.dataset.folioDropcapSeated === "true" &&
      getComputedStyle(cap).float === "left";
  });
  const explicitSmallSize = await measureDropcapFontSize();
  check("Explicit Small resolves to its final 3em size after authoritative preview",
    Boolean(explicitSmallSize && Math.abs(explicitSmallSize - themeDefaultSize) >= 0.5),
    JSON.stringify({ themeDefaultSize, explicitSmallSize }));
  if (!explicitSmallSize || Math.abs(explicitSmallSize - themeDefaultSize) < 0.5) {
    throw new Error("Explicit Small is still indistinguishable from Current theme size");
  }

  const measureDropcap = async () => page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const cap = doc?.querySelector<HTMLElement>("section.chapter .dropcap");
    const para = cap?.closest("p");
    if (!doc || !cap || !para) return null;
    const cr = cap.getBoundingClientRect();
    const pr = para.getBoundingClientRect();
    let nextPara = para.nextElementSibling as HTMLElement | null;
    while (nextPara && nextPara.tagName !== "P") nextPara = nextPara.nextElementSibling as HTMLElement | null;
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
    const capStyle = getComputedStyle(cap);
    const bodyStyle = getComputedStyle(para);
    const canvas = doc.createElement("canvas").getContext("2d");
    let opticalTopDelta: number | null = null;
    let bodyLineHeight: number | null = null;
    if (canvas && bodyText && firstLineTop != null) {
      canvas.font = `${bodyStyle.fontStyle} ${bodyStyle.fontWeight} ${bodyStyle.fontSize} ${bodyStyle.fontFamily}`;
      const bodyMetrics = canvas.measureText("Hh");
      const bodyAsc = bodyMetrics.fontBoundingBoxAscent || bodyMetrics.actualBoundingBoxAscent;
      const bodyDesc = bodyMetrics.fontBoundingBoxDescent || bodyMetrics.actualBoundingBoxDescent;
      bodyLineHeight = bodyStyle.lineHeight === "normal"
        ? bodyAsc + bodyDesc
        : parseFloat(bodyStyle.lineHeight) || bodyAsc + bodyDesc;
      const bodyBaseline = firstLineTop + (bodyLineHeight - (bodyAsc + bodyDesc)) / 2 + bodyAsc;
      const bodyInkTop = bodyBaseline - bodyMetrics.actualBoundingBoxAscent;

      canvas.font = `${capStyle.fontStyle} ${capStyle.fontWeight} ${capStyle.fontSize} ${capStyle.fontFamily}`;
      const capMetrics = canvas.measureText(cap.textContent || "H");
      const capAsc = capMetrics.fontBoundingBoxAscent || capMetrics.actualBoundingBoxAscent;
      const capDesc = capMetrics.fontBoundingBoxDescent || capMetrics.actualBoundingBoxDescent;
      const capLineHeight = capStyle.lineHeight === "normal"
        ? capAsc + capDesc
        : parseFloat(capStyle.lineHeight) || capAsc + capDesc;
      const capBaseline = cr.top + parseFloat(capStyle.paddingTop || "0") +
        (capLineHeight - (capAsc + capDesc)) / 2 + capAsc;
      const capInkTop = capBaseline - capMetrics.actualBoundingBoxAscent;
      opticalTopDelta = capInkTop - bodyInkTop;
    }

    const capRightFromParagraph = cr.right - pr.left;
    const firstLineLeftFromParagraph = firstLineLeft == null ? null : firstLineLeft - pr.left;
    return {
      fontSize: parseFloat(capStyle.fontSize),
      capTopFromParagraph: cr.top - pr.top,
      capLeftFromParagraph: cr.left - pr.left,
      capRightFromParagraph,
      capWidth: cr.width,
      firstLineTopFromParagraph: firstLineTop == null ? null : firstLineTop - pr.top,
      firstLineLeftFromParagraph,
      firstLineGapAfterCap: firstLineLeftFromParagraph == null ? null : firstLineLeftFromParagraph - capRightFromParagraph,
      nextParagraphGap: nextPara ? nextPara.getBoundingClientRect().top - pr.bottom : null,
      paragraphHeight: pr.height,
      dropcapLines: Number(cap.dataset.folioDropcapLines ?? 0),
      opticalTopDelta,
      bodyLineHeight,
      paragraphClass: para.className,
      capClass: cap.className,
      capPosition: capStyle.position,
      capFloat: capStyle.float,
    };
  });

  const measureCapLineCollisions = async () => page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const cap = doc?.querySelector<HTMLElement>("section.chapter .dropcap");
    const para = cap?.closest<HTMLElement>("p");
    if (!doc || !cap || !para) return null;
    const cr = cap.getBoundingClientRect();
    const collisions: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    const walker = doc.createTreeWalker(para, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (cap.contains(node) || !node.data.trim()) continue;
      const range = doc.createRange();
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width <= 1 || rect.height <= 1) continue;
        const vertical = rect.bottom > cr.top + .5 && rect.top < cr.bottom - .5;
        const horizontal = rect.left < cr.right - .5 && rect.right > cr.left + .5;
        if (vertical && horizontal) collisions.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
      }
    }
    return {
      cap: cr.toJSON(),
      float: getComputedStyle(cap).float,
      position: getComputedStyle(cap).position,
      collisions,
    };
  });

  const measureUnderCapHole = async () => page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const cap = doc?.querySelector<HTMLElement>("section.chapter .dropcap");
    const para = cap?.closest<HTMLElement>("p");
    if (!doc || !cap || !para) return null;
    const cr = cap.getBoundingClientRect();
    const rects: DOMRect[] = [];
    const walker = doc.createTreeWalker(para, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (cap.contains(node) || !node.data.trim()) continue;
      const range = doc.createRange();
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width > 1 && rect.height > 1) rects.push(rect);
      }
    }
    const lines = [...new Map(
      rects
        .sort((a, b) => a.top - b.top || a.left - b.left)
        .map((r) => [Math.round(r.top * 2) / 2, r])
    ).values()].sort((a, b) => a.top - b.top);
    if (lines.length < 4) return null;

    const firstBelowIndex = lines.findIndex((r) => r.top >= cr.bottom - 0.5);
    if (firstBelowIndex <= 0) return null;
    const previous = lines[firstBelowIndex - 1];
    const firstBelow = lines[firstBelowIndex];
    const returnGap = firstBelow.top - previous.bottom;

    const normalGaps: number[] = [];
    for (let i = firstBelowIndex + 1; i < lines.length; i++) {
      const gap = lines[i].top - lines[i - 1].bottom;
      if (gap >= -0.5 && gap < 50) normalGaps.push(gap);
    }
    normalGaps.sort((a, b) => a - b);
    const normalGap = normalGaps.length
      ? normalGaps[Math.floor(normalGaps.length / 2)]
      : 0;

    return {
      cap: cr.toJSON(),
      returnGap,
      normalGap,
      excessGap: returnGap - normalGap,
      firstBelow: firstBelow.toJSON(),
      previous: previous.toJSON(),
      lineCount: lines.length,
    };
  });

  const baseline = await measureDropcap();
  if (!baseline) throw new Error("Baseline drop cap geometry unavailable");
  const smallCollision = await measureCapLineCollisions();
  const smallHole = await measureUnderCapHole();
  const smallHealthy = Boolean(
    baseline.opticalTopDelta != null &&
    Math.abs(baseline.opticalTopDelta) <= 1.25 &&
    baseline.dropcapLines >= 2 &&
    baseline.dropcapLines <= 5 &&
    smallCollision &&
    smallCollision.float === "left" &&
    smallCollision.position !== "absolute" &&
    smallCollision.collisions.length === 0 &&
    smallHole &&
    smallHole.excessGap <= 2
  );
  check("Small drop cap is optically seated and never enters prose",
    smallHealthy,
    JSON.stringify({ geometry: baseline, collision: smallCollision, hole: smallHole }));
  if (!smallHealthy) throw new Error("Small drop cap failed full geometry qualification");

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
  if (!(await upload).ok()) throw new Error("V8 opener fixture upload failed");
  await page.waitForSelector(".editor-illustration img[data-folio-asset]");

  const insertedLayout = await page.evaluate(() => {
    const figure = document.querySelector<HTMLElement>(".rich-editor > .editor-illustration");
    if (!figure) return null;
    const style = getComputedStyle(figure);
    const rect = figure.getBoundingClientRect();
    const next = figure.nextElementSibling as HTMLElement | null;
    const nextRect = next?.getBoundingClientRect();
    return {
      wrap: figure.dataset.folioWrap,
      float: style.float,
      shapeOutside: style.shapeOutside,
      figure: rect.toJSON(),
      next: nextRect?.toJSON() ?? null,
      overlapsNext: Boolean(nextRect && rect.bottom > nextRect.top + 1 && rect.top < nextRect.bottom - 1),
    };
  });
  check("freshly inserted illustration starts as a non-wrapping block",
    Boolean(insertedLayout && insertedLayout.wrap === "none" && insertedLayout.float === "none" && !insertedLayout.overlapsNext),
    JSON.stringify(insertedLayout));
  if (!insertedLayout || insertedLayout.wrap !== "none" || insertedLayout.float !== "none" || insertedLayout.overlapsNext) {
    throw new Error("Fresh illustration still intrudes into editor prose");
  }

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
  const authoritativeAfterOpener = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "POST" && /\/preview(?:\?|$)/.test(new URL(response.url()).pathname);
  }, { timeout: 10000 }).catch(() => null);
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
    const cap = doc?.querySelector<HTMLElement>("section.chapter > p .dropcap");
    const para = cap?.closest<HTMLElement>("p");
    if (!opener || !para || !cap) return false;
    const or = opener.getBoundingClientRect();
    const pr = para.getBoundingClientRect();
    return getComputedStyle(opener).float === "none" &&
      getComputedStyle(opener).shapeOutside === "none" &&
      pr.top >= or.bottom - 1 &&
      para.classList.contains("folio-native-dropcap") &&
      getComputedStyle(cap).float === "left" &&
      !para.classList.contains("folio-composed-dropcap");
  });

  await authoritativeAfterOpener;
  await new Promise((resolve) => setTimeout(resolve, 250));
  await page.waitForFunction(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const cap = doc?.querySelector<HTMLElement>("section.chapter .dropcap");
    const para = cap?.closest<HTMLElement>("p");
    return Boolean(cap && para?.classList.contains("folio-native-dropcap") && getComputedStyle(cap).float === "left");
  });

  const after = await measureDropcap();
  if (!after) throw new Error("Drop cap geometry after opener unavailable");
  const invariant =
    Math.abs(after.fontSize - baseline.fontSize) < 0.2 &&
    Math.abs(after.capTopFromParagraph - baseline.capTopFromParagraph) < 1.5 &&
    Math.abs((after.firstLineTopFromParagraph ?? 0) - (baseline.firstLineTopFromParagraph ?? 0)) < 1.5 &&
    Math.abs((after.firstLineLeftFromParagraph ?? 0) - (baseline.firstLineLeftFromParagraph ?? 0)) < 1.5 &&
    Math.abs((after.nextParagraphGap ?? 0) - (baseline.nextParagraphGap ?? 0)) < 1.5;
  check("chapter opener leaves horizontal and vertical drop-cap flow unchanged", invariant, JSON.stringify({ baseline, after }));
  if (!invariant) throw new Error("Chapter opener changed drop cap text flow");

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

  const setDropcapSize = async (size: "theme" | "small" | "medium" | "large" | "xlarge") => {
    await openFirstParagraphSettings();
    const authoritative = page.waitForResponse((response) => {
      const request = response.request();
      return request.method() === "POST" && /\/preview(?:\?|$)/.test(new URL(response.url()).pathname);
    }, { timeout: 20000 }).catch(() => null);
    await page.evaluate((nextSize) => {
      const row = [...document.querySelectorAll<HTMLLabelElement>(".customize-row")]
        .find((item) => item.querySelector("span")?.textContent?.trim() === "Drop cap size");
      const select = row?.querySelector<HTMLSelectElement>("select");
      if (!select) throw new Error("Drop cap size selector missing");
      select.value = nextSize;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      const done = [...document.querySelectorAll<HTMLButtonElement>(".style-library-footer button")]
        .find((button) => button.textContent?.trim() === "Done");
      done?.click();
    }, size);
    await authoritative;
    await page.waitForFunction(() => {
      const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
      const cap = doc?.querySelector<HTMLElement>("section.chapter .dropcap");
      const para = cap?.closest<HTMLElement>("p");
      return Boolean(cap && para?.classList.contains("folio-native-dropcap") &&
        cap.dataset.folioDropcapSeated === "true" &&
        getComputedStyle(cap).float === "left");
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
  };

  const sizeResults: Record<string, Awaited<ReturnType<typeof measureDropcap>>> = { small: baseline };
  let previousExplicit = baseline;

  for (const size of ["medium", "large", "xlarge"] as const) {
    await setDropcapSize(size);
    const geometry = await measureDropcap();
    const collision = await measureCapLineCollisions();
    const hole = await measureUnderCapHole();
    sizeResults[size] = geometry;

    const visuallySeated = Boolean(
      geometry &&
      geometry.opticalTopDelta != null &&
      Math.abs(geometry.opticalTopDelta) <= 1.25
    );
    const flowSafe = Boolean(
      geometry &&
      collision &&
      collision.float === "left" &&
      collision.position !== "absolute" &&
      collision.collisions.length === 0 &&
      hole &&
      hole.excessGap <= 2 &&
      Math.abs((geometry.nextParagraphGap ?? 0) - (baseline.nextParagraphGap ?? 0)) < 1.5 &&
      geometry.dropcapLines >= 2 &&
      geometry.dropcapLines <= 5
    );
    const grows = Boolean(previousExplicit && geometry && geometry.fontSize > previousExplicit.fontSize * 1.08);

    check(`${size} drop cap is optically seated, grows, and never enters prose`,
      visuallySeated && flowSafe && grows,
      JSON.stringify({ geometry, collision, hole, previousSize: previousExplicit?.fontSize }));
    if (!geometry || !visuallySeated || !flowSafe || !grows) {
      throw new Error(`${size} drop cap failed full geometry qualification`);
    }
    previousExplicit = geometry;
  }

  const xlarge = sizeResults.xlarge!;
  check("All explicit drop-cap sizes grow monotonically",
    Boolean(sizeResults.small && sizeResults.medium && sizeResults.large && sizeResults.xlarge &&
      sizeResults.small.fontSize < sizeResults.medium.fontSize &&
      sizeResults.medium.fontSize < sizeResults.large.fontSize &&
      sizeResults.large.fontSize < sizeResults.xlarge.fontSize),
    JSON.stringify(Object.fromEntries(Object.entries(sizeResults).map(([key, value]) => [key, value?.fontSize]))));
  if (!(sizeResults.small && sizeResults.medium && sizeResults.large && sizeResults.xlarge &&
    sizeResults.small.fontSize < sizeResults.medium.fontSize &&
    sizeResults.medium.fontSize < sizeResults.large.fontSize &&
    sizeResults.large.fontSize < sizeResults.xlarge.fontSize)) {
    throw new Error("Drop-cap size ladder is not monotonic");
  }

  // Let autosave persist XL first. This reproduces the real regression where
  // selecting "Current theme size" omitted dropcapSize from JSON and the server
  // merged the just-saved XL value straight back into the authoritative preview.
  await new Promise((resolve) => setTimeout(resolve, 650));
  await openFirstParagraphSettings();
  const authoritativeThemeSize = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "POST" && /\/preview(?:\?|$)/.test(new URL(response.url()).pathname);
  }, { timeout: 20000 }).catch(() => null);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll<HTMLLabelElement>(".customize-row")]
      .find((item) => item.querySelector("span")?.textContent?.trim() === "Drop cap size");
    const select = row?.querySelector<HTMLSelectElement>("select");
    if (!select) throw new Error("Drop cap size selector missing");
    select.value = "theme";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const done = [...document.querySelectorAll<HTMLButtonElement>(".style-library-footer button")]
      .find((button) => button.textContent?.trim() === "Done");
    done?.click();
  });
  await authoritativeThemeSize;
  await page.waitForFunction((themeSize) => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const cap = doc?.querySelector<HTMLElement>("section.chapter .dropcap");
    return Boolean(cap && Math.abs(parseFloat(getComputedStyle(cap).fontSize) - Number(themeSize)) < 0.35);
  }, {}, themeDefaultSize);
  await page.waitForFunction(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const cap = doc?.querySelector<HTMLElement>("section.chapter .dropcap");
    return cap?.dataset.folioDropcapSeated === "true";
  });
  const restoredThemeDropcap = await measureDropcap();
  const restoredThemeCollision = await measureCapLineCollisions();
  const restoredThemeHole = await measureUnderCapHole();
  const restoredThemeHealthy = Boolean(
    restoredThemeDropcap &&
    Math.abs(restoredThemeDropcap.fontSize - themeDefaultSize) < 0.35 &&
    restoredThemeDropcap.opticalTopDelta != null &&
    Math.abs(restoredThemeDropcap.opticalTopDelta) <= 1.25 &&
    restoredThemeDropcap.dropcapLines >= 2 &&
    restoredThemeDropcap.dropcapLines <= 5 &&
    restoredThemeCollision &&
    restoredThemeCollision.float === "left" &&
    restoredThemeCollision.position !== "absolute" &&
    restoredThemeCollision.collisions.length === 0 &&
    restoredThemeHole &&
    restoredThemeHole.excessGap <= 2
  );
  check("Current theme size clears persisted XL and keeps full drop-cap geometry healthy",
    restoredThemeHealthy,
    JSON.stringify({ themeDefaultSize, restored: restoredThemeDropcap, collision: restoredThemeCollision, hole: restoredThemeHole }));
  if (!restoredThemeHealthy) {
    throw new Error("Current theme size failed full drop-cap geometry qualification");
  }

  await page.click('button[data-command="design"]');
  await page.waitForSelector('.style-library[aria-label="Book style library"]');

  // Reproduce the user's actual ugly combination: Grimoire frame + Jena Gotisch.
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".style-category-list button")]
      .find((item) => item.textContent?.trim() === "Book Style");
    if (!button) throw new Error("Book Style category missing");
    button.click();
  });
  const grimoirePreview = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "POST" && /\/preview(?:\?|$)/.test(new URL(response.url()).pathname);
  }, { timeout: 20000 }).catch(() => null);
  await page.click('button[data-theme="grimoire"]');
  await grimoirePreview;
  await new Promise((resolve) => setTimeout(resolve, 650));

  const grimoireHeadingBaseline = await page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const heading = doc?.querySelector<HTMLElement>("section.chapter > h1");
    if (!heading || !doc?.defaultView) return null;
    const style = doc.defaultView.getComputedStyle(heading);
    return { fontFamily: style.fontFamily, fontWeight: style.fontWeight, lineHeight: style.lineHeight, fontSize: style.fontSize };
  });
  if (!grimoireHeadingBaseline) throw new Error("Grimoire heading baseline unavailable");

  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".style-category-list button")]
      .find((item) => item.textContent?.trim() === "Chapter Heading");
    if (!button) throw new Error("Chapter Heading category missing");
    button.click();
  });
  const chapterFontOptions = await page.evaluate(() => {
    const row = [...document.querySelectorAll<HTMLLabelElement>(".customize-row")]
      .find((item) => item.querySelector("span")?.textContent?.trim() === "Typeface");
    return [...(row?.querySelector<HTMLSelectElement>("select")?.options ?? [])]
      .map((option) => option.textContent?.trim());
  });
  const chapterHasRequestedFonts = ["Jena Gotisch", "Manufacturing Consent", "Kings", "CAT Altenglisch", "Slavkappen"]
    .every((name) => chapterFontOptions.includes(name));
  check("Chapter Heading picker exposes all requested licensed fonts", chapterHasRequestedFonts, JSON.stringify(chapterFontOptions));
  if (!chapterHasRequestedFonts) throw new Error("Chapter Heading font picker is missing requested fonts");

  const jenaPreview = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "POST" && /\/preview(?:\?|$)/.test(new URL(response.url()).pathname);
  }, { timeout: 20000 }).catch(() => null);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll<HTMLLabelElement>(".customize-row")]
      .find((item) => item.querySelector("span")?.textContent?.trim() === "Typeface");
    const select = row?.querySelector<HTMLSelectElement>("select");
    if (!select) throw new Error("Chapter heading typeface selector missing");
    select.value = "Folio Jena Gotisch";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await jenaPreview;
  await page.waitForFunction(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    return Boolean(doc && doc.fonts.status === "loaded" && doc.querySelector("section.chapter > h1"));
  });

  const jenaHeading = await page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const heading = doc?.querySelector<HTMLElement>("section.chapter > h1");
    if (!heading || !doc?.defaultView) return null;
    const style = doc.defaultView.getComputedStyle(heading);
    return {
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      fontSize: parseFloat(style.fontSize),
      lineHeight: parseFloat(style.lineHeight),
      letterSpacing: parseFloat(style.letterSpacing),
      clientWidth: heading.clientWidth,
      scrollWidth: heading.scrollWidth,
    };
  });
  const jenaNormalized = Boolean(jenaHeading &&
    /Folio Jena Gotisch/i.test(jenaHeading.fontFamily) &&
    Number(jenaHeading.fontWeight) <= 400 &&
    jenaHeading.lineHeight >= jenaHeading.fontSize * 1.14 &&
    jenaHeading.letterSpacing >= jenaHeading.fontSize * 0.045 &&
    jenaHeading.scrollWidth <= jenaHeading.clientWidth + 2);
  check("Jena Gotisch heading is optically normalized and contained by the theme frame",
    jenaNormalized, JSON.stringify(jenaHeading));
  if (!jenaNormalized) throw new Error("Jena Gotisch still breaks the chapter heading geometry");

  const screenshotDir = path.join(ROOT, "build", "qa-illustrations-v4");
  await fs.mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, "v10-jena-grimoire.png"), fullPage: true });

  // Persist Jena, then choose Theme default. The authoritative preview must
  // return to Grimoire instead of merging the persisted Jena override back in.
  await new Promise((resolve) => setTimeout(resolve, 650));
  const defaultHeadingPreview = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "POST" && /\/preview(?:\?|$)/.test(new URL(response.url()).pathname);
  }, { timeout: 20000 }).catch(() => null);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll<HTMLLabelElement>(".customize-row")]
      .find((item) => item.querySelector("span")?.textContent?.trim() === "Typeface");
    const select = row?.querySelector<HTMLSelectElement>("select");
    if (!select) throw new Error("Chapter heading typeface selector missing");
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await defaultHeadingPreview;
  await page.waitForFunction(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const heading = doc?.querySelector<HTMLElement>("section.chapter > h1");
    return Boolean(heading && !/Folio Jena Gotisch/i.test(getComputedStyle(heading).fontFamily));
  });
  const restoredHeadingFamily = await page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>(".preview-frame")?.contentDocument;
    const heading = doc?.querySelector<HTMLElement>("section.chapter > h1");
    return heading ? getComputedStyle(heading).fontFamily : "";
  });
  check("Theme default clears a persisted Jena heading override",
    restoredHeadingFamily === grimoireHeadingBaseline.fontFamily,
    JSON.stringify({ expected: grimoireHeadingBaseline.fontFamily, restored: restoredHeadingFamily }));
  if (restoredHeadingFamily !== grimoireHeadingBaseline.fontFamily) {
    throw new Error("Theme default still keeps the persisted chapter heading font");
  }
  await page.screenshot({ path: path.join(screenshotDir, "v10-theme-default-restored.png"), fullPage: true });

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

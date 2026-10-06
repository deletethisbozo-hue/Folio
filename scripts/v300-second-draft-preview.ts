import express from "express";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { registerWriteStudioApi } from "../server/write-studio-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

const qa = path.join(ROOT, "build", "qa-v300-second-draft");
await fs.mkdir(qa, { recursive: true });

const app = express();
app.use(express.json({ limit: "5mb" }));
registerApi(app);
registerEditorApi(app);
registerWriteStudioApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_request, response) => response.sendFile(path.join(ROOT, "web", "dist", "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const settle = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(40_000);
  await page.setViewport({ width: 1536, height: 1024, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle0" });

  await page.evaluate(() => {
    const open = [...document.querySelectorAll<HTMLButtonElement>(".start-actions button")]
      .find((button) => button.textContent?.includes("Open Sample"));
    if (!open) throw new Error("Open Sample missing");
    open.click();
  });
  await page.waitForSelector('.folio-shell[data-workspace-mode="format"]');
  await page.waitForSelector(".manuscript-editor");
  await page.evaluate(() => {
    const write = [...document.querySelectorAll<HTMLButtonElement>(".workspace-mode-switch button")]
      .find((button) => button.textContent?.trim() === "Write");
    if (!write) throw new Error("Write mode button missing");
    write.click();
  });
  await page.waitForSelector('.folio-shell[data-workspace-mode="write"]');

  const secondDraftButton = await page.$(".editor-second-draft-toggle");
  if (!secondDraftButton) throw new Error("Second Draft toolbar button missing");
  await secondDraftButton.click();
  await page.waitForSelector(".second-draft-pane");
  await page.waitForFunction(() => (document.querySelector(".second-draft-source")?.textContent?.trim().length ?? 0) > 80);

  const initial = await page.evaluate(() => {
    const source = document.querySelector<HTMLElement>(".second-draft-source");
    const split = document.querySelector<HTMLButtonElement>(".editor-split-toggle");
    const second = document.querySelector<HTMLButtonElement>(".editor-second-draft-toggle");
    return {
      editable: source?.getAttribute("contenteditable"),
      splitPressed: split?.getAttribute("aria-pressed"),
      secondPressed: second?.getAttribute("aria-pressed"),
      candidates: document.querySelectorAll(".second-draft-header select option").length,
    };
  });
  if (initial.editable !== "false" || initial.splitPressed !== "false" || initial.secondPressed !== "true" || initial.candidates < 2) {
    throw new Error("Second Draft mode/legacy Split separation failed: " + JSON.stringify(initial));
  }

  await page.click(".second-draft-pair");
  await page.waitForFunction(() => document.querySelector(".second-draft-progress")?.textContent?.includes("0%"));
  await settle();
  const controlDefaults = await page.evaluate(() => ({
    burn: document.querySelector<HTMLButtonElement>(".second-draft-head-actions button[title^='Source Burn']")?.getAttribute("aria-pressed"),
    scroll: document.querySelector<HTMLButtonElement>(".second-draft-head-actions button[title^='Paired Scroll']")?.getAttribute("aria-pressed"),
    memory: document.querySelector<HTMLButtonElement>(".second-draft-head-actions button[title^='Memory Rewrite']")?.getAttribute("aria-pressed"),
  }));
  if (controlDefaults.burn !== "true" || controlDefaults.scroll !== "true" || controlDefaults.memory !== "false") {
    throw new Error("Second Draft control defaults failed: " + JSON.stringify(controlDefaults));
  }
  await page.screenshot({ path: path.join(qa, "01-second-draft-pairing.png") });

  async function assertActionbarFits(label: string) {
    const problems = await page.evaluate(() => {
      const bar = document.querySelector<HTMLElement>(".second-draft-actionbar");
      if (!bar) return ["action bar missing"];
      const rr = bar.getBoundingClientRect();
      return [...bar.querySelectorAll<HTMLElement>("button, select")].flatMap((control) => {
        const r = control.getBoundingClientRect();
        const outside = r.top < rr.top - 1 || r.bottom > rr.bottom + 1;
        const overflow = control.scrollWidth > control.clientWidth + 1 || control.scrollHeight > control.clientHeight + 1;
        return outside || overflow
          ? [`${control.tagName.toLowerCase()} "${control.textContent?.trim() ?? ""}" outside=${outside} overflow=${overflow} box=${Math.round(r.width)}x${Math.round(r.height)} scroll=${control.scrollWidth}x${control.scrollHeight}`]
          : [];
      });
    });
    if (problems.length) throw new Error(`Second Draft action bar overflow (${label}): ${problems.join(" | ")}`);
  }

  async function selectSourceText(skip = 0) {
    return page.evaluate((skipIndex) => {
      const editor = document.querySelector<HTMLElement>(".second-draft-source");
      if (!editor) throw new Error("Second Draft source missing");
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (node.data.trim().length >= 50) nodes.push(node);
      }
      const node = nodes[Math.min(skipIndex, nodes.length - 1)];
      if (!node) throw new Error("No selectable source prose found");
      const start = Math.max(0, node.data.search(/\S/));
      const end = Math.min(node.length, start + 48);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      editor.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return selection.toString();
    }, skip);
  }

  const firstSelection = await selectSourceText(0);
  if (!firstSelection.trim()) throw new Error("Source selection failed");
  await page.waitForFunction(() => [...document.querySelectorAll(".second-draft-actionbar button")].some((button) => button.textContent?.includes("Rewrite this")));
  await settle();
  await page.screenshot({ path: path.join(qa, "02-rewrite-this.png") });
  await assertActionbarFits("Rewrite This");
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-actionbar button")]
      .find((item) => item.textContent?.includes("Rewrite this"));
    button?.click();
  });
  await page.waitForFunction(() => [...document.querySelectorAll(".second-draft-actionbar button")].some((button) => button.textContent?.includes("Done")));
  await settle();
  await page.screenshot({ path: path.join(qa, "03-rewrite-rail-active.png") });
  await assertActionbarFits("active Rewrite actions");
  const hasCancel = await page.evaluate(() =>
    [...document.querySelectorAll(".second-draft-actionbar button")].some((button) => button.textContent?.trim() === "Cancel"),
  );
  if (!hasCancel) throw new Error("Active Rewrite has no Cancel action");
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-actionbar button")]
      .find((item) => item.textContent?.trim() === "Cancel");
    button?.click();
  });
  await page.waitForFunction(() =>
    ![...document.querySelectorAll(".second-draft-actionbar button")].some((button) => button.textContent?.includes("Done")),
  );
  const cancelledProgress = await page.$eval(".second-draft-progress", (el) => el.textContent?.trim() ?? "");
  if (!cancelledProgress.startsWith("0%")) throw new Error("Cancel left processed progress behind: " + cancelledProgress);
  await selectSourceText(0);
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".second-draft-actionbar button")].some((button) => button.textContent?.includes("Rewrite this")),
  );
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-actionbar button")]
      .find((item) => item.textContent?.includes("Rewrite this"));
    button?.click();
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".second-draft-actionbar button")].some((button) => button.textContent?.includes("Done")),
  );

  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".manuscript-editor");
    if (!editor) throw new Error("Target editor missing");
    editor.focus();
    const p = document.createElement("p");
    p.textContent = "Second Draft QA rewrite anchor.";
    editor.appendChild(p);
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "Second Draft QA rewrite anchor." }));
  });
  await settle(100);
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-actionbar button")]
      .find((item) => item.textContent?.includes("Done"));
    button?.click();
  });
  await page.waitForFunction(() => {
    const text = document.querySelector(".second-draft-progress")?.textContent ?? "";
    return parseInt(text, 10) > 0;
  });
  const burn = await page.evaluate(() => ({
    rewrittenHighlight: Boolean((CSS as unknown as { highlights?: { has(name: string): boolean } }).highlights?.has("folio-source-rewritten")),
    activeHighlight: Boolean((CSS as unknown as { highlights?: { has(name: string): boolean } }).highlights?.has("folio-source-active")),
  }));
  if (!burn.rewrittenHighlight || burn.activeHighlight) throw new Error("Source Burn did not move active source to rewritten state: " + JSON.stringify(burn));
  await settle();
  await page.screenshot({ path: path.join(qa, "04-source-burn.png") });
  await page.click(".second-draft-head-actions button[title^='Source Burn']");
  await page.waitForFunction(() =>
    document.querySelector(".second-draft-head-actions button[title^='Source Burn']")?.getAttribute("aria-pressed") === "false",
  );
  await settle(80);
  const burnOff = await page.evaluate(() =>
    Boolean((CSS as unknown as { highlights?: { has(name: string): boolean } }).highlights?.has("folio-source-rewritten")),
  );
  if (burnOff) throw new Error("Source Burn toggle off left processed highlights visible");
  await page.screenshot({ path: path.join(qa, "04a-source-burn-off.png") });
  await page.click(".second-draft-head-actions button[title^='Source Burn']");
  await page.waitForFunction(() =>
    document.querySelector(".second-draft-head-actions button[title^='Source Burn']")?.getAttribute("aria-pressed") === "true"
    && Boolean((CSS as unknown as { highlights?: { has(name: string): boolean } }).highlights?.has("folio-source-rewritten")),
  );

  await page.click(".second-draft-head-actions button[title^='Memory Rewrite']");
  await page.waitForSelector(".second-draft-pane.memory-mode");
  const blurred = await page.$eval(".second-draft-source", (el) => getComputedStyle(el).filter);
  if (blurred === "none") throw new Error("Memory Rewrite did not hide source");
  await settle();
  await page.screenshot({ path: path.join(qa, "05-memory-rewrite-hidden.png") });
  await page.keyboard.down("Alt");
  await page.waitForSelector(".second-draft-pane.memory-peek");
  await page.waitForFunction(() => {
    const source = document.querySelector(".second-draft-source");
    return source instanceof HTMLElement && getComputedStyle(source).filter === "none";
  });
  await settle();
  const peekFilter = await page.$eval(".second-draft-source", (el) => getComputedStyle(el).filter);
  await page.screenshot({ path: path.join(qa, "06-memory-rewrite-peek.png") });
  await page.keyboard.up("Alt");
  if (peekFilter !== "none") throw new Error("Hold-Alt Memory peek did not reveal source: " + peekFilter);
  await page.click(".second-draft-head-actions button[title^='Memory Rewrite']");

  const secondSelection = await selectSourceText(1);
  if (!secondSelection.trim()) throw new Error("Second source selection failed");
  await page.waitForSelector(".actionbar-send-ahead select");
  const destination = await page.$eval(".actionbar-send-ahead select", (select) => {
    const option = [...(select as HTMLSelectElement).options].find((item) => item.value);
    if (!option) return "";
    (select as HTMLSelectElement).value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return option.value;
  });
  if (!destination) throw new Error("Sample book has no Send Ahead destination");
  await settle();
  await page.screenshot({ path: path.join(qa, "07-send-ahead.png") });
  await assertActionbarFits("Send Ahead");
  await page.click(".actionbar-send-ahead button");
  await settle(160);
  const sentHighlight = await page.evaluate(() =>
    Boolean((CSS as unknown as { highlights?: { has(name: string): boolean } }).highlights?.has("folio-source-sent")),
  );
  if (!sentHighlight) throw new Error("Send Ahead did not mark its source as processed");
  await settle();
  await page.screenshot({ path: path.join(qa, "08-send-ahead-processed.png") });

  const scrollGeometry = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>(".manuscript-editor");
    const source = document.querySelector<HTMLElement>(".second-draft-source");
    if (!target || !source) throw new Error("Second Draft editors missing for paired-scroll QA");
    target.style.setProperty("height", "180px", "important");
    source.style.setProperty("height", "180px", "important");
    return {
      targetMax: target.scrollHeight - target.clientHeight,
      sourceMax: source.scrollHeight - source.clientHeight,
    };
  });
  if (scrollGeometry.targetMax <= 0 || scrollGeometry.sourceMax <= 0) {
    throw new Error("Paired Scroll QA could not create scrollable editors: " + JSON.stringify(scrollGeometry));
  }
  await page.click(".second-draft-head-actions button[title^='Paired Scroll']");
  await page.waitForFunction(() =>
    document.querySelector(".second-draft-head-actions button[title^='Paired Scroll']")?.getAttribute("aria-pressed") === "false",
  );
  await settle(80);
  await page.$eval(".second-draft-source", (el) => { (el as HTMLElement).scrollTop = 0; });
  const scrollOffBefore = await page.$eval(".second-draft-source", (el) => (el as HTMLElement).scrollTop);
  await page.$eval(".manuscript-editor", (el) => {
    const editor = el as HTMLElement;
    editor.scrollTop = Math.max(1, (editor.scrollHeight - editor.clientHeight) * .25);
    editor.dispatchEvent(new Event("scroll"));
  });
  await settle(220);
  const scrollOffAfter = await page.$eval(".second-draft-source", (el) => (el as HTMLElement).scrollTop);
  if (Math.abs(scrollOffAfter - scrollOffBefore) > 1) {
    throw new Error(`Paired Scroll off still moved source: ${scrollOffBefore} -> ${scrollOffAfter}`);
  }
  await page.screenshot({ path: path.join(qa, "09a-paired-scroll-off.png") });

  const manualAnchor = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>(".manuscript-editor")!;
    const source = document.querySelector<HTMLElement>(".second-draft-source")!;
    const targetMax = target.scrollHeight - target.clientHeight;
    const sourceMax = source.scrollHeight - source.clientHeight;
    target.scrollTop = targetMax * .27;
    source.scrollTop = sourceMax * .68;
    return { target: target.scrollTop, source: source.scrollTop, targetMax, sourceMax };
  });
  await page.click(".second-draft-align");
  await page.waitForFunction(() =>
    document.querySelector(".second-draft-head-actions button[title^='Paired Scroll']")?.getAttribute("aria-pressed") === "true"
    && Boolean(document.querySelector(".second-draft-reset-align")),
  );
  await page.$eval(".second-draft-source", (el) => { (el as HTMLElement).scrollTop = 0; });
  await page.$eval(".manuscript-editor", (el, top) => {
    const editor = el as HTMLElement;
    editor.scrollTop = Number(top);
    editor.dispatchEvent(new Event("scroll"));
  }, manualAnchor.target);
  await settle(220);
  const manualAlignedSource = await page.$eval(".second-draft-source", (el) => (el as HTMLElement).scrollTop);
  if (Math.abs(manualAlignedSource - manualAnchor.source) > 14) {
    throw new Error(`Manual Paired Scroll anchor failed: expected ~${manualAnchor.source}, got ${manualAlignedSource}`);
  }
  await page.screenshot({ path: path.join(qa, "09b-paired-scroll-manual-alignment.png") });

  const beforeScroll = await page.$eval(".second-draft-source", (el) => (el as HTMLElement).scrollTop);
  await page.$eval(".manuscript-editor", (el) => {
    const editor = el as HTMLElement;
    editor.scrollTop = Math.max(1, (editor.scrollHeight - editor.clientHeight) * .45);
    editor.dispatchEvent(new Event("scroll"));
  });
  await settle(220);
  const afterScroll = await page.$eval(".second-draft-source", (el) => (el as HTMLElement).scrollTop);
  if (afterScroll <= beforeScroll) throw new Error(`Paired Scroll did not move source: ${beforeScroll} -> ${afterScroll}; ${JSON.stringify(scrollGeometry)}`);

  await page.screenshot({ path: path.join(qa, "09-paired-scroll.png") });

  const sealDisabled = await page.$eval(".actionbar-seal", (button) => (button as HTMLButtonElement).disabled);
  if (sealDisabled) throw new Error("Seal should be available after resolving active source blocks");
  await settle();
  await page.screenshot({ path: path.join(qa, "10-chapter-seal-ready.png") });
  await assertActionbarFits("Chapter Seal");
  await page.click(".actionbar-seal");
  await page.waitForSelector(".second-draft-reveal");
  const reveal = await page.evaluate(() => ({
    title: document.querySelector(".second-draft-reveal h2")?.textContent?.trim(),
    stats: [...document.querySelectorAll(".second-draft-reveal-grid strong")].map((item) => Number(item.textContent ?? 0)),
    words: [...document.querySelectorAll(".second-draft-reveal-words strong")].map((item) => Number((item.textContent ?? "0").replace(/[^\d]/g, ""))),
  }));
  if (reveal.title !== "Draft 2" || reveal.words.some((value) => !value) || reveal.stats[0] < 1 || reveal.stats[3] < 1) {
    throw new Error("Chapter Reveal stats failed: " + JSON.stringify(reveal));
  }
  await page.screenshot({ path: path.join(qa, "11-chapter-reveal.png") });
  await page.click(".second-draft-reveal-close");

  // Midnight parity while Second Draft remains open.
  await page.click(".tone-toggle");
  await page.waitForFunction(() => document.querySelector(".folio-shell")?.getAttribute("data-ui-tone") === "midnight");
  await settle(180);
  const geometry = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>(".second-draft-pane")!;
    const bar = document.querySelector<HTMLElement>(".second-draft-actionbar")!;
    const source = document.querySelector<HTMLElement>(".second-draft-source-paper")!;
    const sourceEditor = document.querySelector<HTMLElement>(".second-draft-source")!;
    const p = pane.getBoundingClientRect(), b = bar.getBoundingClientRect(), s = source.getBoundingClientRect(), e = sourceEditor.getBoundingClientRect();
    return {
      pane: { left:p.left,right:p.right,top:p.top,bottom:p.bottom },
      bar:{left:b.left,right:b.right,top:b.top,bottom:b.bottom},
      source:{left:s.left,right:s.right},
      editor:{left:e.left,right:e.right},
    };
  });
  if (geometry.bar.left < geometry.pane.left - 1 || geometry.bar.right > geometry.pane.right + 1) {
    throw new Error("Second Draft action bar clips outside its pane in Midnight: " + JSON.stringify(geometry));
  }
  if (geometry.editor.left - geometry.source.left > 48) {
    throw new Error("Second Draft source text is still horizontally crushed by action UI: " + JSON.stringify(geometry));
  }
  await page.screenshot({ path: path.join(qa, "12-second-draft-midnight.png") });

  // Closing Second Draft must leave legacy Split intact and editable.
  await page.click(".second-draft-head-actions button[aria-label='Close Second Draft']");
  await page.waitForFunction(() => !document.querySelector(".second-draft-pane"));
  await page.click(".editor-split-toggle");
  await page.waitForSelector(".writing-split-editor[contenteditable='true']");
  const legacyEditable = await page.$eval(".writing-split-editor", (el) => el.getAttribute("contenteditable"));
  if (legacyEditable !== "true") throw new Error("Legacy Split stopped being editable after Second Draft");
  await page.screenshot({ path: path.join(qa, "13-legacy-split-still-intact.png") });

  console.log("Folio 3.0 Second Draft browser QA passed.");
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

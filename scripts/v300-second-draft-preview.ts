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
  await page.screenshot({ path: path.join(qa, "01-second-draft-paired.png") });

  // Switching the dropdown must not apply the existing pair's ranges/actions to another source.
  const pairedSourceId = await page.$eval(".second-draft-header select", (select) => (select as HTMLSelectElement).value);
  const alternateSourceId = await page.$eval(".second-draft-header select", (select) => {
    const control = select as HTMLSelectElement;
    const alternate = [...control.options].find((option) => option.value && option.value !== control.value);
    if (!alternate) return "";
    control.value = alternate.value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return alternate.value;
  });
  if (!alternateSourceId) throw new Error("Second Draft QA needs a second source chapter");
  await page.waitForFunction(() =>
    Boolean(document.querySelector(".second-draft-pair"))
    && !document.querySelector(".second-draft-actionbar")
    && !document.querySelector(".second-draft-sync-controls"),
  );
  await page.$eval(".second-draft-header select", (select, pairedId) => {
    const control = select as HTMLSelectElement;
    control.value = String(pairedId);
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }, pairedSourceId);
  await page.waitForSelector(".second-draft-actionbar");
  await page.waitForSelector(".second-draft-sync-controls");

  const editorAlignment = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>(".manuscript-editor");
    const source = document.querySelector<HTMLElement>(".second-draft-source");
    if (!target || !source) throw new Error("Second Draft editors missing for alignment QA");
    const t = target.getBoundingClientRect();
    const src = source.getBoundingClientRect();
    return { targetTop: t.top, sourceTop: src.top, delta: Math.abs(t.top - src.top) };
  });
  if (editorAlignment.delta > 2) {
    throw new Error("Second Draft editor surfaces are vertically misaligned: " + JSON.stringify(editorAlignment));
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

  async function selectTargetText(skip = 0) {
    return page.evaluate((skipIndex) => {
      const editor = document.querySelector<HTMLElement>(".manuscript-editor");
      if (!editor) throw new Error("Second Draft target missing");
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (node.data.trim().length >= 24) nodes.push(node);
      }
      const node = nodes[Math.min(skipIndex, nodes.length - 1)];
      if (!node) throw new Error("No selectable target prose found");
      const start = Math.max(0, node.data.search(/\S/));
      const end = Math.min(node.length, start + 36);
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

  const expectedRewriteStart = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".manuscript-editor");
    if (!editor) throw new Error("Target editor missing before Rewrite This");
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node: Text | null = null;
    while (walker.nextNode()) {
      const candidate = walker.currentNode as Text;
      if (candidate.data.trim().length >= 16) { node = candidate; break; }
    }
    if (!node) throw new Error("No target prose available for caret QA");
    const localOffset = Math.min(node.length, Math.max(4, node.data.search(/\S/) + 12));
    const range = document.createRange();
    range.setStart(node, localOffset);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    editor.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    const prefix = document.createRange();
    prefix.selectNodeContents(editor);
    prefix.setEnd(node, localOffset);
    return prefix.toString().length;
  });

  const firstSelection = await selectSourceText(0);
  if (!firstSelection.trim()) throw new Error("Source selection failed");
  await page.waitForFunction(() => [...document.querySelectorAll(".second-draft-action-buttons button")].some((button) => button.textContent?.includes("Rewrite this")));
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-action-buttons button")]
      .find((item) => item.textContent?.includes("Rewrite this"));
    button?.click();
  });
  await page.waitForFunction(() => [...document.querySelectorAll(".second-draft-action-buttons button")].some((button) => button.textContent?.includes("Done")));
  await settle(120);

  const restoredRewriteStart = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".manuscript-editor");
    const selection = window.getSelection();
    if (!editor || !selection?.focusNode || !editor.contains(selection.focusNode)) return -1;
    const prefix = document.createRange();
    prefix.selectNodeContents(editor);
    prefix.setEnd(selection.focusNode, selection.focusOffset);
    return prefix.toString().length;
  });
  if (Math.abs(restoredRewriteStart - expectedRewriteStart) > 1) {
    throw new Error(`Rewrite This lost the target caret anchor: expected ${expectedRewriteStart}, restored ${restoredRewriteStart}`);
  }

  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".manuscript-editor");
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount || !selection.focusNode || !editor.contains(selection.focusNode)) {
      throw new Error("Target caret missing before rewrite insertion");
    }
    const text = " Second Draft QA rewrite anchor.";
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  });
  await settle(100);
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-action-buttons button")]
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

  // A rewritten source decision must be reversible without deleting target prose.
  await selectSourceText(0);
  await page.waitForFunction(() => [...document.querySelectorAll(".second-draft-action-buttons button")]
    .some((button) => button.textContent?.trim() === "Undo rewrite"));
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-action-buttons button")]
      .find((item) => item.textContent?.trim() === "Undo rewrite");
    button?.click();
  });
  await page.waitForFunction(() =>
    !(CSS as unknown as { highlights?: { has(name: string): boolean } }).highlights?.has("folio-source-rewritten"),
  );
  await selectSourceText(0);
  await page.waitForFunction(() => [...document.querySelectorAll(".second-draft-action-buttons button")]
    .some((button) => button.textContent?.includes("Rewrite this") && !(button as HTMLButtonElement).disabled));
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-action-buttons button")]
      .find((item) => item.textContent?.includes("Rewrite this"));
    button?.click();
  });
  await page.waitForFunction(() => [...document.querySelectorAll(".second-draft-action-buttons button")]
    .some((button) => button.textContent?.includes("Done")));
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-action-buttons button")]
      .find((item) => item.textContent?.includes("Done"));
    button?.click();
  });
  await page.waitForFunction(() =>
    Boolean((CSS as unknown as { highlights?: { has(name: string): boolean } }).highlights?.has("folio-source-rewritten")),
  );

  await page.click(".second-draft-head-actions button[title*='Hide source']");
  await page.waitForSelector(".second-draft-pane.memory-mode");
  const blurred = await page.$eval(".second-draft-source", (el) => getComputedStyle(el).filter);
  if (blurred === "none") throw new Error("Memory Rewrite did not hide source");
  await page.keyboard.down("Alt");
  await page.waitForSelector(".second-draft-pane.memory-peek");
  const peekFilter = await page.$eval(".second-draft-source", (el) => getComputedStyle(el).filter);
  await page.keyboard.up("Alt");
  if (peekFilter !== "none") throw new Error("Hold-Alt Memory peek did not reveal source: " + peekFilter);
  await page.click(".second-draft-head-actions button[title*='Hide source']");

  const secondSelection = await selectSourceText(1);
  if (!secondSelection.trim()) throw new Error("Second source selection failed");
  await page.waitForSelector(".second-draft-send-ahead select");
  const destination = await page.$eval(".second-draft-send-ahead select", (select) => {
    const option = [...(select as HTMLSelectElement).options].find((item) => item.value);
    if (!option) return "";
    (select as HTMLSelectElement).value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return option.value;
  });
  if (!destination) throw new Error("Sample book has no Send Ahead destination");
  await page.waitForFunction(() => {
    const button = document.querySelector<HTMLButtonElement>(".second-draft-send-ahead button");
    return Boolean(button && !button.disabled && button.dataset.sendReady === "true");
  });
  const sendHitTest = await page.$eval(".second-draft-send-ahead button", (button) => {
    const rect = button.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      visible: rect.width > 0 && rect.height > 0,
      topTag: top?.tagName ?? "",
      topClass: (top as HTMLElement | null)?.className ?? "",
      clickable: top === button || button.contains(top),
      ready: (button as HTMLButtonElement).dataset.sendReady,
      disabled: (button as HTMLButtonElement).disabled,
    };
  });
  if (!sendHitTest.visible || !sendHitTest.clickable || sendHitTest.ready !== "true" || sendHitTest.disabled) {
    throw new Error("Send Ahead control is not genuinely clickable: " + JSON.stringify(sendHitTest));
  }
  const sendResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/write-studio/second-draft/send-ahead")
    && response.request().method() === "POST",
  );
  await page.$eval(".second-draft-send-ahead button", (button) => (button as HTMLButtonElement).click());
  const sendResponse = await sendResponsePromise;
  const sendPayload = await sendResponse.json().catch(async () => ({ raw: await sendResponse.text().catch(() => "") }));
  if (!sendResponse.ok()) {
    throw new Error("Send Ahead request failed: " + JSON.stringify({ status: sendResponse.status(), payload: sendPayload }));
  }
  const sentBlocks = Array.isArray((sendPayload as any)?.secondDraft?.blocks)
    ? (sendPayload as any).secondDraft.blocks.filter((block: any) => block?.status === "sent")
    : [];
  if (!sentBlocks.length) {
    throw new Error("Send Ahead response contained no sent block: " + JSON.stringify(sendPayload));
  }
  try {
    await page.waitForFunction(() =>
      Boolean((CSS as unknown as { highlights?: { has(name: string): boolean } }).highlights?.has("folio-source-sent")),
      { timeout: 3000 },
    );
  } catch {
    const uiDebug = await page.evaluate(() => {
      const registry = (CSS as unknown as { highlights?: { has(name: string): boolean } }).highlights;
      return {
        sentHighlight: Boolean(registry?.has("folio-source-sent")),
        rewrittenHighlight: Boolean(registry?.has("folio-source-rewritten")),
        progress: document.querySelector(".second-draft-progress")?.textContent ?? "",
        action: document.querySelector(".second-draft-action-copy strong")?.textContent ?? "",
        error: document.querySelector(".error-banner,.error-text,.folio-error")?.textContent ?? "",
        sourceTextLength: document.querySelector(".second-draft-source")?.textContent?.length ?? -1,
      };
    });
    throw new Error("Send Ahead persisted but Source Burn did not refresh: " + JSON.stringify({ sentBlocks, uiDebug }));
  }

  // Later must be a real queue, not a permanent unresolved tombstone.
  const laterSelection = await selectSourceText(2);
  if (!laterSelection.trim()) throw new Error("Later source selection failed");
  await page.evaluate(() => {
    const later = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-action-buttons button")]
      .find((button) => button.textContent?.trim() === "Later");
    if (!later) throw new Error("Later action missing");
    later.click();
  });
  await page.waitForFunction(() => document.querySelector(".second-draft-action-copy strong")?.textContent?.includes("Later queue"));
  const sealWhileLater = await page.$eval(".second-draft-seal", (button) => (button as HTMLButtonElement).disabled);
  if (!sealWhileLater) throw new Error("Seal must stay disabled while Later queue is unresolved");
  await page.evaluate(() => {
    const resume = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-action-buttons button")]
      .find((button) => button.textContent?.trim() === "Resume next");
    if (!resume) throw new Error("Resume next missing for Later queue");
    resume.click();
  });
  await page.waitForFunction(() => document.querySelector(".second-draft-action-copy strong")?.textContent?.trim() === "Rewriting");
  await page.evaluate(() => {
    const keep = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-action-buttons button")]
      .find((button) => button.textContent?.trim() === "Keep");
    if (!keep) throw new Error("Keep action missing after resuming Later block");
    keep.click();
  });
  await page.waitForFunction(() => !(document.querySelector(".second-draft-seal") as HTMLButtonElement | null)?.disabled);

  const scrollGeometry = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>(".manuscript-editor");
    const source = document.querySelector<HTMLElement>(".second-draft-source");
    if (!target || !source) throw new Error("Second Draft editors missing for paired-scroll QA");
    let fixture = document.querySelector<HTMLStyleElement>("#second-draft-scroll-fixture");
    if (!fixture) {
      fixture = document.createElement("style");
      fixture.id = "second-draft-scroll-fixture";
      fixture.textContent = [
        '.folio-shell[data-workspace-mode="write"][data-split-view="true"] .editor-pane .manuscript-editor',
        '.folio-shell[data-workspace-mode="write"][data-split-view="true"] .second-draft-pane .second-draft-source',
      ].join(",") + "{height:180px!important;}";
      document.head.appendChild(fixture);
    }
    return {
      targetMax: target.scrollHeight - target.clientHeight,
      sourceMax: source.scrollHeight - source.clientHeight,
    };
  });
  if (scrollGeometry.targetMax <= 0 || scrollGeometry.sourceMax <= 0) {
    throw new Error("Paired Scroll QA could not create scrollable editors: " + JSON.stringify(scrollGeometry));
  }
  // Paired Scroll is intentionally inert until the writer explicitly links matching text on both sides.
  const beforeUnlinkedScroll = await page.$eval(".second-draft-source", (el) => (el as HTMLElement).scrollTop);
  await page.$eval(".manuscript-editor", (el) => {
    const editor = el as HTMLElement;
    editor.scrollTop = Math.max(1, (editor.scrollHeight - editor.clientHeight) * .42);
    editor.dispatchEvent(new Event("scroll"));
  });
  await settle(180);
  const afterUnlinkedScroll = await page.$eval(".second-draft-source", (el) => (el as HTMLElement).scrollTop);
  if (Math.abs(afterUnlinkedScroll - beforeUnlinkedScroll) > 2) {
    throw new Error(`Paired Scroll moved before any text link existed: ${beforeUnlinkedScroll} -> ${afterUnlinkedScroll}`);
  }

  const linkedSourceText = await selectSourceText(3);
  const linkedTargetText = await selectTargetText(1);
  if (!linkedSourceText.trim() || !linkedTargetText.trim()) throw new Error("Could not select matching text for Paired Scroll");
  await page.waitForFunction(() => {
    const link = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-sync-controls button")]
      .find((button) => button.textContent?.trim() === "Link lines");
    return Boolean(link && !link.disabled);
  });
  await page.evaluate(() => {
    const link = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-sync-controls button")]
      .find((button) => button.textContent?.trim() === "Link lines");
    link?.click();
  });
  await page.waitForFunction(() => /Synced.*1 link/.test(document.querySelector(".second-draft-sync-status")?.textContent ?? ""));

  const beforeLinkedMove = await page.$eval(".second-draft-source", (el) => (el as HTMLElement).scrollTop);
  await page.$eval(".manuscript-editor", (el) => {
    const editor = el as HTMLElement;
    const max = Math.max(1, editor.scrollHeight - editor.clientHeight);
    editor.scrollTop = Math.min(max, editor.scrollTop + max * .18);
    editor.dispatchEvent(new Event("scroll"));
  });
  await settle(220);
  const afterLinkedMove = await page.$eval(".second-draft-source", (el) => (el as HTMLElement).scrollTop);
  if (Math.abs(afterLinkedMove - beforeLinkedMove) < 2) {
    throw new Error(`Paired Scroll did not react after explicit line link: ${beforeLinkedMove} -> ${afterLinkedMove}`);
  }

  // Pause/resume only exists after at least one explicit line link.
  await page.evaluate(() => {
    const sync = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-sync-controls button")]
      .find((button) => button.textContent?.trim() === "Sync");
    if (!sync || sync.disabled) throw new Error("Second Draft Sync control missing after line link");
    sync.click();
  });
  await page.waitForFunction(() => document.querySelector(".second-draft-sync-status")?.textContent?.includes("Paused"));
  await page.evaluate(() => {
    const sync = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-sync-controls button")]
      .find((button) => button.textContent?.trim() === "Sync");
    sync?.click();
  });
  await page.waitForFunction(() => document.querySelector(".second-draft-sync-status")?.textContent?.includes("Synced"));

  // Mode remount must restore both scroll positions and Second Draft UI state.
  await page.click(".second-draft-head-actions button[title*='Hide source']");
  await page.waitForSelector(".second-draft-pane.memory-mode");
  const savedBeforeRemount = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>(".manuscript-editor")!;
    const source = document.querySelector<HTMLElement>(".second-draft-source")!;
    const storage = Object.fromEntries(
      Object.keys(localStorage)
        .filter((key) => key.startsWith("folio.second-draft.view.v3:"))
        .map((key) => [key, localStorage.getItem(key)]),
    );
    return {
      target: target.scrollTop / Math.max(1, target.scrollHeight - target.clientHeight),
      source: source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight),
      targetMax: Math.max(0, target.scrollHeight - target.clientHeight),
      sourceMax: Math.max(0, source.scrollHeight - source.clientHeight),
      storage,
    };
  });
  await page.click(".second-draft-head-actions button[aria-label='Close Second Draft']");
  await page.waitForFunction(() => !document.querySelector(".second-draft-pane"));
  await page.click(".editor-second-draft-toggle");
  await page.waitForSelector(".second-draft-pane.memory-mode");
  await page.waitForFunction(() => (document.querySelector(".second-draft-source")?.textContent?.trim().length ?? 0) > 80);
  await settle(420);
  const restoredAfterRemount = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>(".manuscript-editor")!;
    const source = document.querySelector<HTMLElement>(".second-draft-source")!;
    const storage = Object.fromEntries(
      Object.keys(localStorage)
        .filter((key) => key.startsWith("folio.second-draft.view.v3:"))
        .map((key) => [key, localStorage.getItem(key)]),
    );
    const paper = document.querySelector<HTMLElement>(".second-draft-source-paper");
    const pane = document.querySelector<HTMLElement>(".second-draft-pane");
    const shell = document.querySelector<HTMLElement>(".folio-shell");
    const sourceStyle = getComputedStyle(source);
    const paperStyle = paper ? getComputedStyle(paper) : null;
    const paneStyle = pane ? getComputedStyle(pane) : null;
    return {
      target: target.scrollTop / Math.max(1, target.scrollHeight - target.clientHeight),
      source: source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight),
      targetMax: Math.max(0, target.scrollHeight - target.clientHeight),
      sourceMax: Math.max(0, source.scrollHeight - source.clientHeight),
      status: document.querySelector(".second-draft-sync-status")?.textContent ?? "",
      storage,
      geometry: {
        sourceClientHeight: source.clientHeight,
        sourceScrollHeight: source.scrollHeight,
        sourceRectHeight: source.getBoundingClientRect().height,
        sourceHeight: sourceStyle.height,
        sourceOverflowY: sourceStyle.overflowY,
        paperClientHeight: paper?.clientHeight ?? -1,
        paperScrollHeight: paper?.scrollHeight ?? -1,
        paperRectHeight: paper?.getBoundingClientRect().height ?? -1,
        paperHeight: paperStyle?.height ?? "",
        paperFlex: paperStyle?.flex ?? "",
        paneClientHeight: pane?.clientHeight ?? -1,
        paneScrollHeight: pane?.scrollHeight ?? -1,
        paneRectHeight: pane?.getBoundingClientRect().height ?? -1,
        paneHeight: paneStyle?.height ?? "",
        shellSplit: shell?.dataset.splitView ?? "",
        textLength: source.textContent?.length ?? -1,
      },
    };
  });
  if (Math.abs(restoredAfterRemount.target - savedBeforeRemount.target) > .10
      || Math.abs(restoredAfterRemount.source - savedBeforeRemount.source) > .10
      || !/Synced.*1 link/.test(restoredAfterRemount.status)) {
    await page.screenshot({ path: path.join(qa, "debug-remount-geometry.png") });
    throw new Error("Second Draft view state was not restored after mode remount: " + JSON.stringify({ savedBeforeRemount, restoredAfterRemount }));
  }
  await page.click(".second-draft-head-actions button[title*='Hide source']");
  await page.evaluate(() => document.querySelector("#second-draft-scroll-fixture")?.remove());
  await settle(220);

  await page.screenshot({ path: path.join(qa, "02-second-draft-burn-memory-send-scroll.png") });

  const sealDisabled = await page.$eval(".second-draft-seal", (button) => (button as HTMLButtonElement).disabled);
  if (sealDisabled) throw new Error("Seal should be available after resolving active source blocks");
  await page.click(".second-draft-seal");
  await page.waitForSelector(".second-draft-reveal");
  const reveal = await page.evaluate(() => ({
    title: document.querySelector(".second-draft-reveal h2")?.textContent?.trim(),
    stats: [...document.querySelectorAll(".second-draft-reveal-grid strong")].map((item) => Number(item.textContent ?? 0)),
    words: [...document.querySelectorAll(".second-draft-reveal-words strong")].map((item) => Number((item.textContent ?? "0").replace(/[^\d]/g, ""))),
  }));
  if (reveal.title !== "Draft 2" || reveal.words.some((value) => !value) || reveal.stats[0] < 1 || reveal.stats[3] < 1) {
    throw new Error("Chapter Reveal stats failed: " + JSON.stringify(reveal));
  }
  await page.screenshot({ path: path.join(qa, "03-chapter-reveal.png") });
  await page.click(".second-draft-reveal-close");

  // Midnight parity while Second Draft remains open.
  await page.click(".tone-toggle");
  await page.waitForFunction(() => document.querySelector(".folio-shell")?.getAttribute("data-ui-tone") === "midnight");
  await settle(180);
  const geometry = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>(".second-draft-pane")!;
    const actions = document.querySelector<HTMLElement>(".second-draft-actionbar")!;
    const source = document.querySelector<HTMLElement>(".second-draft-source-paper")!;
    const p = pane.getBoundingClientRect(), a = actions.getBoundingClientRect(), src = source.getBoundingClientRect();
    return {
      pane: { left:p.left,right:p.right,top:p.top,bottom:p.bottom },
      actions:{left:a.left,right:a.right,top:a.top,bottom:a.bottom},
      source:{left:src.left,right:src.right,top:src.top,bottom:src.bottom},
      oldRail: Boolean(document.querySelector(".second-draft-rail")),
    };
  });
  if (geometry.oldRail
      || geometry.actions.left < geometry.pane.left - 1
      || geometry.actions.right > geometry.pane.right + 1
      || geometry.actions.bottom > geometry.source.bottom) {
    throw new Error("Second Draft integrated controls clip or old rail survived in Midnight: " + JSON.stringify(geometry));
  }
  await page.screenshot({ path: path.join(qa, "04-second-draft-midnight.png") });

  // Closing Second Draft must leave legacy Split intact and editable.
  await page.click(".second-draft-head-actions button[aria-label='Close Second Draft']");
  await page.waitForFunction(() => !document.querySelector(".second-draft-pane"));
  await page.click(".editor-split-toggle");
  await page.waitForSelector(".writing-split-editor[contenteditable='true']");
  const legacyEditable = await page.$eval(".writing-split-editor", (el) => el.getAttribute("contenteditable"));
  if (legacyEditable !== "true") throw new Error("Legacy Split stopped being editable after Second Draft");
  await page.screenshot({ path: path.join(qa, "05-legacy-split-still-intact.png") });

  console.log("Folio 3.0 Second Draft browser QA passed.");
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

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

  await page.$eval(".manuscript-editor", (el) => {
    const editor = el as HTMLElement;
    const probe = document.createElement("p");
    probe.dataset.initialRepeatsQa = "true";
    probe.textContent = "Lantern copper lantern marble lantern velvet lantern quartz lantern. The empty platform waited. The empty platform waited.";
    editor.appendChild(probe);
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: probe.textContent }));
  });

  const secondDraftButton = await page.$(".editor-second-draft-toggle");
  if (!secondDraftButton) throw new Error("Second Draft toolbar button missing");
  await secondDraftButton.click();
  await page.waitForSelector(".second-draft-pane");
  await page.waitForFunction(() => (document.querySelector(".second-draft-source")?.textContent?.trim().length ?? 0) > 80);
  await page.waitForFunction(() => {
    const registry = (CSS as unknown as { highlights?: { has(name: string): boolean } }).highlights;
    const repeats = document.querySelector<HTMLButtonElement>(".second-draft-repeat-toggle");
    return Boolean(
      repeats?.getAttribute("aria-pressed") === "true"
      && registry?.has("folio-repeat-high")
      && registry?.has("folio-repeat-phrase")
    );
  });
  await page.$eval(".manuscript-editor", (el) => {
    const editor = el as HTMLElement;
    editor.querySelector('[data-initial-repeats-qa="true"]')?.remove();
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
  });

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
  await page.screenshot({ path: path.join(qa, "01-main-light.png") });

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
  await page.waitForSelector(".second-draft-intent-select:not([disabled])");
  await page.select(".second-draft-intent-select:not([disabled])", "tighten");
  await settle(100);
  await page.screenshot({ path: path.join(qa, "02-selection-light.png") });
  await page.waitForFunction(() => [...document.querySelectorAll(".second-draft-action-buttons button")].some((button) => button.textContent?.includes("Rewrite this")));
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-action-buttons button")]
      .find((item) => item.textContent?.includes("Rewrite this"));
    button?.click();
  });
  await page.waitForFunction(() => [...document.querySelectorAll(".second-draft-action-buttons button")].some((button) => button.textContent?.includes("Done")));
  await settle(120);
  await page.screenshot({ path: path.join(qa, "03-active-rewrite-light.png") });

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
  const mapState = await page.evaluate(() => ({
    track: Boolean(document.querySelector(".second-draft-map-track")),
    segments: document.querySelectorAll(".second-draft-map-segment").length,
    scene: document.querySelector(".second-draft-scene-controls")?.textContent?.trim() ?? "",
  }));
  if (!mapState.track || mapState.segments < 1 || !mapState.scene.includes("Scene")) {
    throw new Error("Revision map or scene navigation missing: " + JSON.stringify(mapState));
  }

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
    const editor = document.querySelector<HTMLElement>(".manuscript-editor");
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount || !selection.focusNode || !editor.contains(selection.focusNode)) {
      throw new Error("Target caret missing before demo rewrite insertion");
    }
    const text = " The address had led her to the wall, where the city seemed to run out of names.";
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
  await settle(80);
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-action-buttons button")]
      .find((item) => item.textContent?.includes("Done"));
    button?.click();
  });
  await page.waitForFunction(() =>
    Boolean((CSS as unknown as { highlights?: { has(name: string): boolean } }).highlights?.has("folio-source-rewritten")),
  );

  // Compare Rewrite must show the actual source and current target slice.
  await selectSourceText(0);
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>(".second-draft-action-buttons button")]
    .some((button) => button.textContent?.trim() === "Compare rewrite"));
  await page.evaluate(() => {
    const compare = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-action-buttons button")]
      .find((button) => button.textContent?.trim() === "Compare rewrite");
    compare?.click();
  });
  await page.waitForSelector(".second-draft-compare");
  const compareState = await page.$eval(".second-draft-compare", (dialog) => ({
    text: dialog.textContent ?? "",
    columns: dialog.querySelectorAll(".second-draft-compare-grid article").length,
  }));
  if (compareState.columns !== 2 || !compareState.text.includes("Source") || !compareState.text.includes("Rewrite")
      || !compareState.text.includes("Intent: Tighten") || !compareState.text.includes("Word diff")
      || compareState.text.includes("No target text captured for this rewrite.")
      || !compareState.text.includes("The address had led her to the wall")) {
    throw new Error("Compare Rewrite is missing real source/rewrite/intent/diff content: " + JSON.stringify(compareState));
  }
  const diffPieces = await page.$eval(".second-draft-word-diff", (diff) => ({
    added: diff.querySelectorAll(".added").length,
    removed: diff.querySelectorAll(".removed").length,
  }));
  if (!diffPieces.added || !diffPieces.removed) throw new Error("Word diff must show both added and removed words: " + JSON.stringify(diffPieces));
  await page.screenshot({ path: path.join(qa, "04-compare-light.png") });
  await page.click(".second-draft-compare .second-draft-drawer-head button");
  await page.waitForFunction(() => !document.querySelector(".second-draft-compare"));

  // Issues must persist category + note.
  await selectSourceText(3);
  await page.click(".second-draft-flag-issue");
  await page.waitForSelector(".second-draft-issues-drawer");
  await page.select(".second-draft-issue-form select", "pacing");
  await page.type(".second-draft-issue-form input", "Tighten this beat before the reveal.");
  await page.click(".second-draft-issue-form button");
  await page.waitForFunction(() =>
    (document.querySelector(".second-draft-head-actions")?.textContent ?? "").includes("Issues 1"),
  );
  const issueState = await page.$eval(".second-draft-issues-drawer", (drawer) => drawer.textContent ?? "");
  if (!issueState.includes("Pacing") || !issueState.includes("Tighten this beat before the reveal.")) {
    throw new Error("Second Draft issue did not persist category/note: " + issueState);
  }
  await page.screenshot({ path: path.join(qa, "05-issues-light.png") });
  await page.click(".second-draft-issues-drawer .second-draft-drawer-head button");
  await page.waitForFunction(() => !document.querySelector(".second-draft-issues-drawer"));

  // Chapter review passes persist independently from source decisions.
  await page.evaluate(() => {
    const passes = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-head-actions button")]
      .find((button) => button.textContent?.startsWith("Passes"));
    if (!passes) throw new Error("Second Draft Passes control missing");
    passes.click();
  });
  await page.waitForSelector(".second-draft-review-drawer");
  await page.evaluate(() => {
    const pacing = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-pass-grid button")]
      .find((button) => button.textContent?.includes("Pacing"));
    if (!pacing) throw new Error("Pacing review pass control missing");
    pacing.click();
  });
  await page.waitForFunction(() =>
    (document.querySelector(".second-draft-review-drawer")?.textContent ?? "").includes("1/7 complete"),
  );
  await page.evaluate(() => {
    const continuity = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-pass-grid button")]
      .find((button) => button.textContent?.includes("Continuity"));
    if (!continuity) throw new Error("Continuity review pass control missing");
    continuity.click();
  });
  await page.waitForFunction(() =>
    (document.querySelector(".second-draft-review-drawer")?.textContent ?? "").includes("2/7 complete"),
  );
  await page.screenshot({ path: path.join(qa, "06-passes-light.png") });
  await page.click(".second-draft-review-drawer .second-draft-drawer-head button");
  await page.waitForFunction(() => !document.querySelector(".second-draft-review-drawer"));

  // Chapter draft brief is persisted with the Second Draft project state.
  await page.evaluate(() => {
    const brief = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-head-actions button")]
      .find((button) => button.textContent?.startsWith("Brief"));
    if (!brief) throw new Error("Second Draft Brief control missing");
    brief.click();
  });
  await page.waitForSelector(".second-draft-brief-drawer");
  await page.type(".second-draft-brief-drawer textarea", "Tighten the middle and make the reveal land harder.");
  await page.screenshot({ path: path.join(qa, "07-brief-light.png") });
  await page.click(".second-draft-brief-actions button");
  await page.waitForFunction(() =>
    [...document.querySelectorAll<HTMLButtonElement>(".second-draft-head-actions button")]
      .some((button) => button.textContent?.includes("Brief •")),
  );

  await page.click(".second-draft-head-actions button[title*='Hide source']");
  await page.waitForSelector(".second-draft-pane.memory-mode");
  await settle(120);
  await page.screenshot({ path: path.join(qa, "09-memory-light.png") });
  const blurred = await page.$eval(".second-draft-source", (el) => getComputedStyle(el).filter);
  if (blurred === "none") throw new Error("Memory Rewrite did not hide source");
  await page.keyboard.down("Alt");
  await page.waitForSelector(".second-draft-pane.memory-peek");
  await settle(180);
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

  // Live repetition heatmap must analyze the actual editable target without
  // mutating its DOM structure or relying on the Writing Studio drawer.
  const targetBeforeRepetitionQa = await page.$eval(".manuscript-editor", (el) => (el as HTMLElement).innerHTML);
  await page.$eval(".manuscript-editor", (el) => {
    const editor = el as HTMLElement;
    const probe = document.createElement("p");
    probe.dataset.repetitionQa = "true";
    probe.textContent = "Lantern copper lantern marble lantern velvet lantern quartz lantern. The empty platform waited. The empty platform waited.";
    editor.appendChild(probe);
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: probe.textContent }));
  });
  await page.waitForFunction(() => {
    const registry = (CSS as unknown as { highlights?: { has(name: string): boolean } }).highlights;
    const repeats = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-head-actions button")]
      .find((button) => button.textContent?.startsWith("Repeats"));
    return Boolean(registry?.has("folio-repeat-high") && registry?.has("folio-repeat-phrase") && repeats && /Repeats\s+\d+/.test(repeats.textContent ?? ""));
  });
  const repetitionQa = await page.evaluate(() => {
    const registry = (CSS as unknown as { highlights?: { has(name: string): boolean } }).highlights;
    const repeats = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-head-actions button")]
      .find((button) => button.textContent?.startsWith("Repeats"));
    return {
      high: Boolean(registry?.has("folio-repeat-high")),
      phrase: Boolean(registry?.has("folio-repeat-phrase")),
      medium: Boolean(registry?.has("folio-repeat-medium")),
      low: Boolean(registry?.has("folio-repeat-low")),
      label: repeats?.textContent?.trim() ?? "",
    };
  });
  if (!repetitionQa.high || !repetitionQa.phrase || !/^Repeats\s+[1-9]/.test(repetitionQa.label)) {
    throw new Error("Second Draft repetition heatmap did not expose repeated target prose: " + JSON.stringify(repetitionQa));
  }
  await page.screenshot({ path: path.join(qa, "16-repetition-heatmap-light.png") });
  await page.$eval(".manuscript-editor", (el, html) => {
    const editor = el as HTMLElement;
    editor.innerHTML = String(html);
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "historyUndo" }));
  }, targetBeforeRepetitionQa);
  await settle(160);

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
  await settle(120);
  await page.screenshot({ path: path.join(qa, "08-linked-sync-map-light.png") });

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

  // The bottom of one document must map cleanly to the bottom region of the
  // other instead of drifting because text coordinates exceed legal scrollTop.
  await page.$eval(".manuscript-editor", (el) => {
    const editor = el as HTMLElement;
    editor.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 900 }));
    editor.scrollTop = Math.max(0, editor.scrollHeight - editor.clientHeight);
    editor.dispatchEvent(new Event("scroll"));
  });
  await settle(220);
  const bottomSync = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>(".manuscript-editor")!;
    const source = document.querySelector<HTMLElement>(".second-draft-source")!;
    return {
      target: target.scrollTop / Math.max(1, target.scrollHeight - target.clientHeight),
      source: source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight),
    };
  });
  if (bottomSync.target < .98 || bottomSync.source < .9) {
    throw new Error("Paired Scroll drifted at the document end: " + JSON.stringify(bottomSync));
  }

  // Taking control of the opposite editor immediately must reverse the driver
  // without the previous programmatic scroll bouncing it back.
  await page.$eval(".second-draft-source", (el) => {
    const editor = el as HTMLElement;
    editor.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -700 }));
    editor.scrollTop = Math.max(1, (editor.scrollHeight - editor.clientHeight) * .37);
    editor.dispatchEvent(new Event("scroll"));
  });
  await settle(220);
  const reverseSync = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>(".manuscript-editor")!;
    const source = document.querySelector<HTMLElement>(".second-draft-source")!;
    return {
      target: target.scrollTop,
      source: source.scrollTop,
      targetRatio: target.scrollTop / Math.max(1, target.scrollHeight - target.clientHeight),
      sourceRatio: source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight),
    };
  });
  if (Math.abs(reverseSync.sourceRatio - .37) > .08 || reverseSync.targetRatio > .92) {
    throw new Error("Source did not take control of Paired Scroll cleanly: " + JSON.stringify(reverseSync));
  }
  await settle(220);
  const stableAfterReverse = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>(".manuscript-editor")!;
    const source = document.querySelector<HTMLElement>(".second-draft-source")!;
    return { target: target.scrollTop, source: source.scrollTop };
  });
  if (
    Math.abs(stableAfterReverse.target - reverseSync.target) > 1.5
    || Math.abs(stableAfterReverse.source - reverseSync.source) > 1.5
  ) {
    throw new Error("Paired Scroll kept bouncing after user input stopped: " + JSON.stringify({ reverseSync, stableAfterReverse }));
  }

  // Release stress gate: >10k words on both sides, twelve explicit links,
  // individual link removal, jump-to-link, and stable bidirectional scrolling.
  const beforeLongScrollQa = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>(".manuscript-editor")!;
    const source = document.querySelector<HTMLElement>(".second-draft-source")!;
    return { target: target.innerHTML, source: source.innerHTML };
  });
  await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>(".manuscript-editor")!;
    const source = document.querySelector<HTMLElement>(".second-draft-source")!;
    const targetFragment = document.createDocumentFragment();
    const sourceFragment = document.createDocumentFragment();
    for (let paragraph = 0; paragraph < 125; paragraph++) {
      const targetP = document.createElement("p");
      targetP.dataset.longScrollQa = String(paragraph);
      const targetWords: string[] = [];
      for (let word = 0; word < 90; word++) targetWords.push(`t${paragraph}w${word}`);
      targetP.textContent = targetWords.join(" ");
      targetFragment.appendChild(targetP);

      const sourceP = document.createElement("p");
      sourceP.dataset.longScrollQa = String(paragraph);
      const sourceWords: string[] = [];
      for (let word = 0; word < 90; word++) sourceWords.push(`s${paragraph}w${word}`);
      sourceP.textContent = sourceWords.join(" ");
      sourceFragment.appendChild(sourceP);
    }
    target.appendChild(targetFragment);
    source.appendChild(sourceFragment);
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "long-scroll-qa" }));
  });
  await settle(220);

  const longGeometry = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>(".manuscript-editor")!;
    const source = document.querySelector<HTMLElement>(".second-draft-source")!;
    return {
      targetWords: target.textContent?.trim().match(/\S+/g)?.length ?? 0,
      sourceWords: source.textContent?.trim().match(/\S+/g)?.length ?? 0,
      targetMax: target.scrollHeight - target.clientHeight,
      sourceMax: source.scrollHeight - source.clientHeight,
    };
  });
  if (longGeometry.targetWords < 10_000 || longGeometry.sourceWords < 10_000 || longGeometry.targetMax <= 0 || longGeometry.sourceMax <= 0) {
    throw new Error("Long-manuscript scroll fixture did not exceed 10k words: " + JSON.stringify(longGeometry));
  }

  // Start the stress map clean.
  await page.evaluate(() => {
    const reset = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-sync-controls button")]
      .find((button) => button.textContent?.trim() === "Reset links");
    reset?.click();
  });
  await page.waitForFunction(() => document.querySelector(".second-draft-sync-status")?.textContent?.includes("Select matching lines"));

  for (let linkIndex = 0; linkIndex < 12; linkIndex++) {
    await page.evaluate((index) => {
      const paragraph = Math.min(124, 5 + index * 10);
      const source = document.querySelector<HTMLElement>(".second-draft-source")!;
      const target = document.querySelector<HTMLElement>(".manuscript-editor")!;

      const sourceNode = document.querySelector<HTMLElement>(`.second-draft-source [data-long-scroll-qa="${paragraph}"]`)?.firstChild;
      if (!(sourceNode instanceof Text)) throw new Error("Long-scroll QA source text node missing");
      const sourceRange = document.createRange();
      sourceRange.setStart(sourceNode, 0);
      sourceRange.setEnd(sourceNode, Math.min(28, sourceNode.length));
      const sourceSelection = window.getSelection()!;
      sourceSelection.removeAllRanges();
      sourceSelection.addRange(sourceRange);
      source.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

      const targetNode = document.querySelector<HTMLElement>(`.manuscript-editor [data-long-scroll-qa="${paragraph}"]`)?.firstChild;
      if (!(targetNode instanceof Text)) throw new Error("Long-scroll QA target text node missing");
      const targetRange = document.createRange();
      targetRange.setStart(targetNode, 0);
      targetRange.setEnd(targetNode, Math.min(28, targetNode.length));
      const targetSelection = window.getSelection()!;
      targetSelection.removeAllRanges();
      targetSelection.addRange(targetRange);
      target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    }, linkIndex);
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
    await page.waitForFunction((expected) => {
      const status = document.querySelector(".second-draft-sync-status")?.textContent ?? "";
      return status.includes(`${expected} link`);
    }, {}, linkIndex + 1);
  }

  await page.evaluate(() => {
    const links = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-sync-controls button")]
      .find((button) => button.textContent?.trim() === "Links 12");
    if (!links) throw new Error("Manage Links button missing after twelve links");
    links.click();
  });
  await page.waitForSelector(".second-draft-links-popover");
  const linkRowsBeforeRemove = await page.$$eval(".second-draft-link-row", (rows) => rows.length);
  if (linkRowsBeforeRemove !== 12) throw new Error("Manage Links did not list all twelve links: " + linkRowsBeforeRemove);

  await page.click(".second-draft-link-row:nth-child(6) .second-draft-link-jump");
  await settle(140);
  const jumpPosition = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>(".manuscript-editor")!;
    const source = document.querySelector<HTMLElement>(".second-draft-source")!;
    return {
      target: target.scrollTop / Math.max(1, target.scrollHeight - target.clientHeight),
      source: source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight),
    };
  });
  if (jumpPosition.target <= .15 || jumpPosition.source <= .15 || jumpPosition.target >= .8 || jumpPosition.source >= .8) {
    throw new Error("Manage Links jump did not reveal the linked middle region: " + JSON.stringify(jumpPosition));
  }

  await page.click(".second-draft-link-row:nth-child(6) .second-draft-link-remove");
  await page.waitForFunction(() => document.querySelectorAll(".second-draft-link-row").length === 11);
  await page.waitForFunction(() => /11 links/.test(document.querySelector(".second-draft-sync-status")?.textContent ?? ""));
  await page.screenshot({ path: path.join(qa, "17-manage-scroll-links-light.png") });

  // Restore the normal QA manuscript, then leave one valid link for remount testing.
  await page.evaluate((saved) => {
    const target = document.querySelector<HTMLElement>(".manuscript-editor")!;
    const source = document.querySelector<HTMLElement>(".second-draft-source")!;
    target.innerHTML = saved.target;
    source.innerHTML = saved.source;
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "historyUndo" }));
  }, beforeLongScrollQa);
  await page.evaluate(() => {
    const reset = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-sync-controls button")]
      .find((button) => button.textContent?.trim() === "Reset links");
    reset?.click();
  });
  await page.waitForFunction(() => document.querySelector(".second-draft-sync-status")?.textContent?.includes("Select matching lines"));
  const remountSourceLink = await selectSourceText(3);
  const remountTargetLink = await selectTargetText(1);
  if (!remountSourceLink.trim() || !remountTargetLink.trim()) throw new Error("Could not recreate link after long-scroll stress QA");
  await page.evaluate(() => {
    const link = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-sync-controls button")]
      .find((button) => button.textContent?.trim() === "Link lines");
    link?.click();
  });
  await page.waitForFunction(() => /Synced.*1 link/.test(document.querySelector(".second-draft-sync-status")?.textContent ?? ""));
  await settle(160);

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
  const persistedReviewUi = await page.$eval(".second-draft-head-actions", (head) => head.textContent ?? "");
  if (!persistedReviewUi.includes("Issues 1") || !persistedReviewUi.includes("Passes 2/7") || !persistedReviewUi.includes("Brief •")) {
    throw new Error("Second Draft issues/review passes/brief did not survive remount: " + persistedReviewUi);
  }

  if (Math.abs(restoredAfterRemount.target - savedBeforeRemount.target) > .10
      || Math.abs(restoredAfterRemount.source - savedBeforeRemount.source) > .10
      || !/Synced.*1 link/.test(restoredAfterRemount.status)) {
    await page.screenshot({ path: path.join(qa, "debug-remount-geometry.png") });
    throw new Error("Second Draft view state was not restored after mode remount: " + JSON.stringify({ savedBeforeRemount, restoredAfterRemount }));
  }
  await page.click(".second-draft-head-actions button[title*='Hide source']");
  await page.evaluate(() => document.querySelector("#second-draft-scroll-fixture")?.remove());
  await settle(220);

  await page.screenshot({ path: path.join(qa, "10-workspace-light.png") });

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
  await page.screenshot({ path: path.join(qa, "11-chapter-reveal-light.png") });
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
  await page.screenshot({ path: path.join(qa, "12-main-midnight.png") });

  await page.evaluate(() => {
    const issues = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-head-actions button")]
      .find((button) => button.textContent?.startsWith("Issues"));
    issues?.click();
  });
  await page.waitForSelector(".second-draft-issues-drawer");
  await settle(100);
  await page.screenshot({ path: path.join(qa, "13-issues-midnight.png") });
  await page.click(".second-draft-issues-drawer .second-draft-drawer-head button");

  await selectSourceText(0);
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>(".second-draft-action-buttons button")]
    .some((button) => button.textContent?.trim() === "Compare rewrite"));
  await page.evaluate(() => {
    const compare = [...document.querySelectorAll<HTMLButtonElement>(".second-draft-action-buttons button")]
      .find((button) => button.textContent?.trim() === "Compare rewrite");
    compare?.click();
  });
  await page.waitForSelector(".second-draft-compare");
  await settle(100);
  await page.screenshot({ path: path.join(qa, "14-compare-midnight.png") });
  await page.click(".second-draft-compare .second-draft-drawer-head button");

  // Closing Second Draft must leave legacy Split intact and editable.
  await page.click(".second-draft-head-actions button[aria-label='Close Second Draft']");
  await page.waitForFunction(() => !document.querySelector(".second-draft-pane"));
  await page.click(".editor-split-toggle");
  await page.waitForSelector(".writing-split-editor[contenteditable='true']");
  const legacyEditable = await page.$eval(".writing-split-editor", (el) => el.getAttribute("contenteditable"));
  if (legacyEditable !== "true") throw new Error("Legacy Split stopped being editable after Second Draft");
  await page.screenshot({ path: path.join(qa, "15-legacy-split-still-intact.png") });

  console.log("Folio 3.0 Second Draft browser QA passed.");
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

import express from "express";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

const qa = path.join(ROOT, "build", "qa-v210-writing-studio");
await fs.mkdir(qa, { recursive: true });

const app = express();
app.use(express.json({ limit: "5mb" }));
registerApi(app);
registerEditorApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_request, response) => response.sendFile(path.join(ROOT, "web", "dist", "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function settle(ms = 250) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(40_000);
  await page.setViewport({ width: 1536, height: 1024, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle0" });

  await page.waitForSelector(".start-shell .start-brand");
  const dashboardActions = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLButtonElement>(".start-actions button")].map((button) => button.textContent?.trim() ?? ""),
  );
  for (const expected of ["New Book", "Open Book…", "Import Folder…", "Open Sample"]) {
    if (!dashboardActions.includes(expected)) throw new Error(`Dashboard project-file action missing: ${expected} — ${dashboardActions.join(" | ")}`);
  }
  await settle();
  await page.screenshot({ path: path.join(qa, "01-dashboard.png") });

  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((node) => node.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample missing");
    button.click();
  });

  await page.waitForSelector('.folio-shell[data-workspace-mode="format"]');
  await page.waitForSelector(".command-wordmark");
  await page.waitForSelector(".manuscript-editor");

  const geometry = await page.evaluate(() => {
    const startSize = getComputedStyle(document.querySelector(".command-wordmark")!).fontSize;
    const wordmark = document.querySelector<HTMLElement>(".command-wordmark")!;
    const command = document.querySelector<HTMLElement>(".folio-commandbar")!;
    const wordRect = wordmark.getBoundingClientRect();
    const commandRect = command.getBoundingClientRect();
    return {
      startSize,
      wordTop: Math.round(wordRect.top),
      wordHeight: Math.round(wordRect.height),
      commandTop: Math.round(commandRect.top),
      commandHeight: Math.round(commandRect.height),
      kicker: Boolean(document.querySelector(".section-kicker")),
    };
  });
  if (geometry.wordTop !== geometry.commandTop || geometry.wordHeight !== geometry.commandHeight) {
    throw new Error(`Wordmark masthead geometry drifted: ${JSON.stringify(geometry)}`);
  }
  if (geometry.commandHeight !== 64) throw new Error(`Expected 64px masthead, got ${geometry.commandHeight}`);
  if (geometry.kicker) throw new Error("Duplicate Chapter N kicker is still present");

  await page.waitForSelector(".preview-frame");
  await page.waitForFunction(() => {
    const frame = document.querySelector<HTMLIFrameElement>(".preview-frame");
    const text = frame?.contentDocument?.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
    const loading = document.querySelector<HTMLElement>(".preview-loading");
    const loadingVisible = Boolean(loading && getComputedStyle(loading).display !== "none" && getComputedStyle(loading).visibility !== "hidden");
    return text.length > 120 && !loadingVisible;
  });
  await settle(350);
  await page.screenshot({ path: path.join(qa, "02-format.png") });

  await page.evaluate(() => {
    const write = [...document.querySelectorAll<HTMLButtonElement>(".workspace-mode-switch button")]
      .find((button) => button.textContent?.trim() === "Write");
    if (!write) throw new Error("Write mode button missing");
    write.click();
  });
  await page.waitForSelector('.folio-shell[data-workspace-mode="write"][data-split-view="false"][data-write-sidebar="closed"]');
  await page.waitForFunction(() => {
    const previewHidden = getComputedStyle(document.querySelector(".preview-pane")!).display === "none";
    const sidebar = document.querySelector<HTMLElement>(".library-pane")!;
    return previewHidden && getComputedStyle(sidebar).display === "none";
  });

  await page.evaluate(() => {
    const settings = document.querySelector<HTMLButtonElement>('[data-command="settings"]');
    if (!settings) throw new Error("Settings command missing");
    settings.click();
  });
  await page.waitForSelector('[role="dialog"][aria-label="Settings"]');
  const settingsContract = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Settings"]');
    const choose = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((button) => button.textContent?.trim() === "Choose folder…");
    const copy = dialog?.textContent ?? "";
    return { hasChoose: Boolean(choose), hasDefaultExportCopy: copy.includes("Exports folder next to the current .folio project") };
  });
  if (!settingsContract.hasChoose || !settingsContract.hasDefaultExportCopy) {
    throw new Error(`Export location setting missing or unclear: ${JSON.stringify(settingsContract)}`);
  }
  const initialSpellcheck = await page.$eval<HTMLInputElement>('input[aria-label="Enable spellcheck"]', (input) => input.checked);
  if (!initialSpellcheck) throw new Error("Spellcheck should default to enabled");
  await page.click('input[aria-label="Enable spellcheck"]');
  await page.waitForFunction(() => {
    const editor = document.querySelector<HTMLElement>(".manuscript-editor");
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Enable spellcheck"]');
    return input?.checked === false
      && editor?.spellcheck === false
      && window.localStorage.getItem("folio-spellcheck-enabled") === "false";
  });
  await settle(120);
  await page.screenshot({ path: path.join(qa, "03a-settings-spellcheck-off.png") });
  await page.click('[role="dialog"][aria-label="Settings"] footer .native-button.primary');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Settings"]'));

  await settle(300);
  await page.screenshot({ path: path.join(qa, "03-write-single.png") });

  const closedEditorLeft = await page.$eval(".editor-pane", (element) => element.getBoundingClientRect().left);
  await page.evaluate(() => {
    const toggle = document.querySelector<HTMLButtonElement>(".write-sidebar-toggle");
    if (!toggle) throw new Error("Write sidebar toggle missing");
    toggle.click();
  });
  await page.waitForSelector('.folio-shell[data-workspace-mode="write"][data-write-sidebar="open"]');
  const openSidebarGeometry = await page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>(".library-pane");
    const editor = document.querySelector<HTMLElement>(".editor-pane");
    const close = document.querySelector<HTMLButtonElement>(".library-collapse-button");
    if (!sidebar || !editor || !close) throw new Error("Open Write sidebar is missing its layout or close control");
    const sidebarRect = sidebar.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    return {
      sidebarDisplay: getComputedStyle(sidebar).display,
      sidebarLeft: sidebarRect.left,
      sidebarRight: sidebarRect.right,
      editorLeft: editorRect.left,
      closeLabel: close.getAttribute("aria-label"),
    };
  });
  if (openSidebarGeometry.sidebarDisplay === "none"
    || openSidebarGeometry.editorLeft <= closedEditorLeft + 100
    || openSidebarGeometry.editorLeft < openSidebarGeometry.sidebarRight - 1
    || openSidebarGeometry.closeLabel !== "Hide manuscript sidebar") {
    throw new Error(`Write sidebar must push the editor and remain closable: ${JSON.stringify({ closedEditorLeft, ...openSidebarGeometry })}`);
  }
  await settle(220);
  await page.screenshot({ path: path.join(qa, "03b-write-sidebar-open.png") });

  await page.click(".library-collapse-button");
  await page.waitForSelector('.folio-shell[data-workspace-mode="write"][data-write-sidebar="closed"]');
  await page.waitForFunction(() => getComputedStyle(document.querySelector<HTMLElement>(".library-pane")!).display === "none");

  // The editor-side button must also remain a two-way toggle after the sidebar
  // has been closed from inside the manuscript panel.
  await page.click(".write-sidebar-toggle");
  await page.waitForSelector('.folio-shell[data-workspace-mode="write"][data-write-sidebar="open"]');
  await page.click(".write-sidebar-toggle");
  await page.waitForSelector('.folio-shell[data-workspace-mode="write"][data-write-sidebar="closed"]');

  await page.evaluate(() => {
    const toggle = document.querySelector<HTMLButtonElement>(".editor-typewriter-toggle");
    if (!toggle) throw new Error("Typewriter mode control missing");
    if (toggle.getAttribute("aria-pressed") !== "false") throw new Error("Typewriter mode should start disabled");
    toggle.click();

    const editor = document.querySelector<HTMLElement>(".manuscript-editor");
    if (!editor) throw new Error("Primary manuscript editor missing for typewriter QA");
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let target: Text | null = null;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.data.trim().length > 4) target = node;
    }
    if (!target) throw new Error("Typewriter QA could not find manuscript text");
    editor.focus();
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(target, target.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    editor.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "ArrowDown" }));
  });
  await page.waitForSelector('.folio-shell[data-typewriter-mode="true"] .manuscript-editor.typewriter-active');
  await settle(180);
  const primaryTypewriter = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".manuscript-editor")!;
    const selection = window.getSelection()!;
    if (!selection.focusNode || selection.focusNode.nodeType !== Node.TEXT_NODE) throw new Error("Primary typewriter selection lost");
    const text = selection.focusNode as Text;
    const offset = Math.min(selection.focusOffset, text.length);
    const probe = document.createRange();
    if (offset > 0) {
      probe.setStart(text, offset - 1);
      probe.setEnd(text, offset);
    } else {
      probe.setStart(text, 0);
      probe.setEnd(text, Math.min(1, text.length));
    }
    const rects = Array.from(probe.getClientRects());
    const caretRect = rects.at(-1) ?? probe.getBoundingClientRect();
    const viewport = editor.getBoundingClientRect();
    return {
      delta: (caretRect.top + caretRect.height / 2) - (viewport.top + editor.clientHeight / 2),
      scrollTop: editor.scrollTop,
      spacer: editor.style.getPropertyValue("--folio-typewriter-spacer"),
      pressed: document.querySelector<HTMLButtonElement>(".editor-typewriter-toggle")?.getAttribute("aria-pressed"),
    };
  });
  if (Math.abs(primaryTypewriter.delta) > 38 || primaryTypewriter.scrollTop <= 0 || !primaryTypewriter.spacer || primaryTypewriter.pressed !== "true") {
    throw new Error(`Primary typewriter caret is not centered: ${JSON.stringify(primaryTypewriter)}`);
  }
  await page.screenshot({ path: path.join(qa, "03c-write-typewriter.png") });

  await page.evaluate(() => {
    if (document.querySelector(".folio-commandbar .workspace-split-button")) {
      throw new Error("Split is still exposed as a workspace-level mode control");
    }
    const split = document.querySelector<HTMLButtonElement>(".format-toolbar .editor-split-toggle");
    if (!split) throw new Error("Editor split layout control missing");
    if (split.getAttribute("aria-label") !== "Split editor") throw new Error("Split editor control label drifted");
    split.click();
  });
  await page.waitForSelector('.folio-shell[data-workspace-mode="write"][data-split-view="true"] .writing-split-pane');
  await page.waitForSelector(".writing-split-editor[contenteditable='true'].typewriter-active");
  await page.waitForFunction(() => {
    const editor = document.querySelector<HTMLElement>(".writing-split-editor");
    return (editor?.textContent?.trim().length ?? 0) > 80 && editor?.spellcheck === false;
  });

  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".writing-split-editor");
    if (!editor) throw new Error("Split editor missing for typewriter QA");
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let target: Text | null = null;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.data.trim().length > 4) target = node;
    }
    if (!target) throw new Error("Split typewriter QA could not find text");
    editor.focus();
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(target, target.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    editor.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "ArrowDown" }));
  });
  await settle(180);
  const splitTypewriterState = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".writing-split-editor")!;
    const selection = window.getSelection()!;
    if (!selection.focusNode || selection.focusNode.nodeType !== Node.TEXT_NODE) throw new Error("Split typewriter selection lost");
    const text = selection.focusNode as Text;
    const offset = Math.min(selection.focusOffset, text.length);
    const probe = document.createRange();
    if (offset > 0) {
      probe.setStart(text, offset - 1);
      probe.setEnd(text, offset);
    } else {
      probe.setStart(text, 0);
      probe.setEnd(text, Math.min(1, text.length));
    }
    const rects = Array.from(probe.getClientRects());
    const caretRect = rects.at(-1) ?? probe.getBoundingClientRect();
    const viewport = editor.getBoundingClientRect();
    return {
      delta: (caretRect.top + caretRect.height / 2) - (viewport.top + editor.clientHeight / 2),
      scrollTop: editor.scrollTop,
      spacer: editor.style.getPropertyValue("--folio-typewriter-spacer"),
    };
  });
  if (Math.abs(splitTypewriterState.delta) > 38 || splitTypewriterState.scrollTop <= 0 || !splitTypewriterState.spacer) {
    throw new Error(`Split typewriter caret is not centered: ${JSON.stringify(splitTypewriterState)}`);
  }

  // Exercise the real rich formatting controls before the screenshot. This is
  // not decorative QA: the resulting HTML must survive the editor conversion.
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".writing-split-editor");
    if (!editor) throw new Error("Split editor missing");
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.data.trim().length > 18) nodes.push(node);
      if (nodes.length >= 2) break;
    }
    if (nodes.length < 2) throw new Error("Split editor has insufficient text to format");

    const highlightRange = document.createRange();
    const highlightStart = Math.min(1, Math.max(0, nodes[0].length - 2));
    const highlightEnd = Math.min(nodes[0].length, highlightStart + Math.min(48, nodes[0].length - 1));
    highlightRange.setStart(nodes[0], highlightStart);
    highlightRange.setEnd(nodes[0], highlightEnd);
    const highlightSelection = window.getSelection()!;
    highlightSelection.removeAllRanges();
    highlightSelection.addRange(highlightRange);

    const highlight = document.querySelector<HTMLInputElement>(".writing-split-toolbar .writing-highlight-control input");
    if (!highlight || highlight.disabled) throw new Error("Highlight control missing or disabled");
    editor.focus();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand("hiliteColor", false, "#d8f2d0");
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "formatBackColor" }));

    const colorRange = document.createRange();
    const colorStart = Math.min(1, Math.max(0, nodes[1].length - 2));
    const colorEnd = Math.min(nodes[1].length, colorStart + Math.min(44, nodes[1].length - 1));
    colorRange.setStart(nodes[1], colorStart);
    colorRange.setEnd(nodes[1], colorEnd);
    const colorSelection = window.getSelection()!;
    colorSelection.removeAllRanges();
    colorSelection.addRange(colorRange);

    const color = document.querySelector<HTMLInputElement>(".writing-split-toolbar .writing-color-control:not(.writing-highlight-control) input");
    if (!color || color.disabled) throw new Error("Text color control missing or disabled");
    editor.focus();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand("foreColor", false, "#b42318");
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "formatForeColor" }));
  });

  await settle(900);
  const richState = await page.evaluate(() => {
    const editor = document.querySelector(".writing-split-editor");
    return {
      colored: Boolean(editor?.querySelector('[style*="color"]')),
      highlighted: Boolean(editor?.querySelector('[style*="background-color"]')),
      previewHidden: getComputedStyle(document.querySelector(".preview-pane")!).display === "none",
      panes: document.querySelectorAll(".manuscript-editor, .writing-split-editor").length,
    };
  });
  if (!richState.colored || !richState.highlighted || !richState.previewHidden || richState.panes < 2) {
    throw new Error(`Write split QA failed: ${JSON.stringify(richState)}`);
  }

  await page.screenshot({ path: path.join(qa, "04-write-split.png") });

  await page.evaluate(() => {
    const focus = document.querySelector<HTMLButtonElement>(".format-toolbar .editor-focus-toggle");
    if (!focus) throw new Error("Focus mode control missing");
    focus.click();
  });
  await page.waitForSelector('.folio-shell[data-workspace-mode="write"][data-focus-mode="true"][data-split-view="true"]');
  await page.waitForFunction(() => {
    const hidden = [".folio-commandbar", ".library-pane", ".folio-statusbar", ".editor-topbar", ".section-titlebar", ".format-toolbar", ".writing-split-header", ".writing-split-toolbar"]
      .every((selector) => getComputedStyle(document.querySelector<HTMLElement>(selector)!).display === "none");
    const controls = document.querySelector<HTMLElement>(".focus-layout-controls");
    const splitClose = document.querySelector<HTMLButtonElement>(".focus-split-close");
    const typewriter = document.querySelector<HTMLButtonElement>(".focus-typewriter");
    const exit = document.querySelector<HTMLButtonElement>(".focus-exit");
    return hidden
      && Boolean(controls && getComputedStyle(controls).display !== "none")
      && splitClose?.getAttribute("aria-label") === "Close split editor"
      && typewriter?.getAttribute("aria-pressed") === "true"
      && exit?.getAttribute("aria-label") === "Exit focus mode"
      && document.querySelectorAll(".manuscript-editor.typewriter-active, .writing-split-editor.typewriter-active").length >= 2;
  });
  await settle(250);
  await page.screenshot({ path: path.join(qa, "05-focus-split.png") });

  await page.click(".focus-typewriter");
  await page.waitForSelector('.folio-shell[data-focus-mode="true"][data-typewriter-mode="false"]');
  await page.waitForFunction(() => document.querySelectorAll(".typewriter-active").length === 0);
  await page.click(".focus-typewriter");
  await page.waitForSelector('.folio-shell[data-focus-mode="true"][data-typewriter-mode="true"]');
  await page.waitForFunction(() => document.querySelectorAll(".manuscript-editor.typewriter-active, .writing-split-editor.typewriter-active").length >= 2);

  await page.click(".focus-split-close");
  await page.waitForSelector('.folio-shell[data-workspace-mode="write"][data-focus-mode="true"][data-split-view="false"][data-typewriter-mode="true"]');
  await page.waitForFunction(() => !document.querySelector(".writing-split-pane") && Boolean(document.querySelector(".manuscript-editor.typewriter-active")));
  await settle(220);
  await page.screenshot({ path: path.join(qa, "06-focus-single.png") });

  await page.click(".focus-exit");
  await page.waitForSelector('.folio-shell[data-workspace-mode="write"][data-focus-mode="false"][data-split-view="false"]');
  await page.waitForFunction(() => getComputedStyle(document.querySelector<HTMLElement>(".folio-commandbar")!).display !== "none");

  // Escape remains the fast exit path too.
  await page.click(".editor-focus-toggle");
  await page.waitForSelector('.folio-shell[data-focus-mode="true"]');
  await page.keyboard.press("Escape");
  await page.waitForSelector('.folio-shell[data-workspace-mode="write"][data-focus-mode="false"]');
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

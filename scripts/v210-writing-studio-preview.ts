import express from "express";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { registerWriteStudioApi } from "../server/write-studio-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

const qa = path.join(ROOT, "build", "qa-v210-writing-studio");
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

async function settle(ms = 250) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(40_000);
  await page.setViewport({ width: 1536, height: 1024, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle0" });

  await page.waitForSelector(".start-shell .start-hero-logo");
  const dashboardActions = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLButtonElement>(".start-actions button")].map((button) => button.textContent?.trim() ?? ""),
  );
  for (const expected of ["New Book", "Open Book…", "Import Folder…", "Open Sample"]) {
    if (!dashboardActions.includes(expected)) throw new Error(`Dashboard project-file action missing: ${expected} — ${dashboardActions.join(" | ")}`);
  }
  const dashboardVersion = await page.evaluate(async () => {
    const response = await fetch("/api/health");
    const health = await response.json() as { version?: string };
    return {
      label: document.querySelector(".start-version")?.textContent?.trim() ?? "",
      server: health.version ?? "",
    };
  });
  if (!dashboardVersion.label || dashboardVersion.label !== dashboardVersion.server) {
    throw new Error(`Dashboard version must come from the running Folio build: ${JSON.stringify(dashboardVersion)}`);
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
  if (geometry.commandHeight !== 46) throw new Error(`Expected 46px masthead, got ${geometry.commandHeight}`);
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

  await page.click('[data-command="design"]');
  await page.waitForSelector('[role="dialog"][aria-label="Book style library"]');
  await settle(220);
  await page.screenshot({ path: path.join(qa, "02a-design-library.png") });
  const hoverTheme = await page.$(".theme-sample:not(.selected)") ?? await page.$(".theme-sample");
  if (!hoverTheme) throw new Error("Theme card missing for live hover preview QA");
  await hoverTheme.hover();
  await page.waitForSelector(".theme-hover-preview");
  await page.waitForFunction(() => {
    const frame = document.querySelector<HTMLIFrameElement>(".theme-hover-preview iframe");
    return Boolean(frame?.contentDocument?.body?.innerText?.trim().length);
  });
  await settle(250);
  const lightHoverGeometry = await page.$eval(".theme-hover-preview", (node) => {
    const rect = (node as HTMLElement).getBoundingClientRect();
    return { top: rect.top, right: innerWidth - rect.right, width: rect.width, height: rect.height };
  });
  await page.screenshot({ path: path.join(qa, "02a-design-library-hover-preview.png") });
  await page.mouse.move(20, 20);
  await page.click('.style-library-header button[aria-label="Close"]');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Book style library"]'));

  await page.click('[data-command="book"]');
  await page.waitForSelector('[role="dialog"][aria-label="Book Details"]');
  await settle(220);
  await page.screenshot({ path: path.join(qa, "02b-book-details.png") });
  await page.click('[role="dialog"][aria-label="Book Details"] header button[aria-label="Close"]');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Book Details"]'));

  await page.click('.tone-toggle');
  await page.waitForFunction(() => document.querySelector(".folio-shell")?.getAttribute("data-ui-tone") === "midnight");
  await settle(260);
  await page.screenshot({ path: path.join(qa, "02d-format-midnight.png") });

  await page.click('[data-command="design"]');
  await page.waitForSelector('[role="dialog"][aria-label="Book style library"]');
  await settle(220);
  await page.screenshot({ path: path.join(qa, "02e-design-library-midnight.png") });

  const midnightHoverTheme = await page.$(".theme-sample:not(.selected)") ?? await page.$(".theme-sample");
  if (!midnightHoverTheme) throw new Error("Midnight theme card missing for live hover preview QA");
  await midnightHoverTheme.hover();
  await page.waitForSelector(".theme-hover-preview");
  await page.waitForFunction(() => {
    const frame = document.querySelector<HTMLIFrameElement>(".theme-hover-preview iframe");
    return Boolean(frame?.contentDocument?.body?.innerText?.trim().length);
  });
  await settle(250);
  const midnightHoverGeometry = await page.$eval(".theme-hover-preview", (node) => {
    const rect = (node as HTMLElement).getBoundingClientRect();
    return { top: rect.top, right: innerWidth - rect.right, width: rect.width, height: rect.height };
  });
  const hoverGeometryDelta = Math.max(
    Math.abs(midnightHoverGeometry.top - lightHoverGeometry.top),
    Math.abs(midnightHoverGeometry.right - lightHoverGeometry.right),
    Math.abs(midnightHoverGeometry.width - lightHoverGeometry.width),
    Math.abs(midnightHoverGeometry.height - lightHoverGeometry.height),
  );
  if (hoverGeometryDelta > 1) {
    throw new Error(`Midnight theme hover preview must match Light geometry: ${JSON.stringify({ lightHoverGeometry, midnightHoverGeometry })}`);
  }
  await page.screenshot({ path: path.join(qa, "02f-design-library-midnight-hover-preview.png") });
  await page.mouse.move(20, 20);
  await page.click('.style-library-header button[aria-label="Close"]');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Book style library"]'));
  await page.click('.tone-toggle');
  await page.waitForFunction(() => document.querySelector(".folio-shell")?.getAttribute("data-ui-tone") === "ivory");
  await settle(180);

  await page.click(".generate-button");
  await page.waitForSelector(".generate-menu");
  await settle(160);
  await page.screenshot({ path: path.join(qa, "02c-export-menu.png") });
  await page.click(".generate-button");
  await page.waitForFunction(() => !document.querySelector(".generate-menu"));

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
  const soundContract = await page.evaluate(() => {
    const toggle = document.querySelector<HTMLInputElement>('input[aria-label="Enable typewriter sound"]');
    const volume = document.querySelector<HTMLInputElement>('input[aria-label="Typewriter sound volume"]');
    const halo = document.querySelector<HTMLInputElement>('input[aria-label="Show writing progress halo"]');
    const options = [...document.querySelectorAll<HTMLButtonElement>(".typewriter-sound-options button")].map((button) => button.textContent?.trim() ?? "");
    return { enabled: toggle?.checked ?? null, volume: Number(volume?.value ?? -1), halo: halo?.checked ?? null, options };
  });
  if (soundContract.enabled !== false || soundContract.volume !== 90 || soundContract.halo !== true || soundContract.options.length !== 3
    || !["Classic", "Soft", "Mechanical"].every((label) => soundContract.options.some((copy) => copy.startsWith(label)))) {
    throw new Error(`Typewriter/progress settings contract failed: ${JSON.stringify(soundContract)}`);
  }
  await page.click('input[aria-label="Enable typewriter sound"]');
  await page.evaluate(() => {
    const mechanical = [...document.querySelectorAll<HTMLButtonElement>(".typewriter-sound-options button")]
      .find((button) => button.textContent?.trim().startsWith("Mechanical"));
    if (!mechanical) throw new Error("Mechanical typewriter sound option missing");
    mechanical.click();
  });
  await page.$eval<HTMLInputElement>('input[aria-label="Typewriter sound volume"]', (input) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "100");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(() =>
    window.localStorage.getItem("folio-typewriter-sound-enabled") === "true"
    && window.localStorage.getItem("folio-typewriter-sound-style") === "mechanical"
    && window.localStorage.getItem("folio-typewriter-sound-volume") === "100"
    && document.querySelector<HTMLButtonElement>(".typewriter-sound-options button.active")?.textContent?.trim().startsWith("Mechanical"),
  );

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

  await page.waitForSelector(".writing-progress-halo .progress-halo-orb");
  const haloRingGeometry = await page.evaluate(() => {
    const orb = document.querySelector<HTMLElement>(".progress-halo-orb");
    const book = document.querySelector<SVGCircleElement>(".progress-halo-ring-book");
    const chapter = document.querySelector<SVGCircleElement>(".progress-halo-ring-chapter");
    const today = document.querySelector<SVGCircleElement>(".progress-halo-ring-today");
    if (!orb || !book || !chapter || !today) return null;
    const bounds = orb.getBoundingClientRect();
    const radii = [book, chapter, today].map((ring) => Number(ring.getAttribute("r")));
    const circlesInside = [book, chapter, today].every((ring) => {
      const rect = ring.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0
        && rect.left >= bounds.left - 3
        && rect.top >= bounds.top - 3
        && rect.right <= bounds.right + 3
        && rect.bottom <= bounds.bottom + 3;
    });
    return { radii, circlesInside };
  });
  if (!haloRingGeometry || haloRingGeometry.radii.join(",") !== "47,40,34" || !haloRingGeometry.circlesInside) {
    throw new Error(`Folio Halo three-ring geometry failed: ${JSON.stringify(haloRingGeometry)}`);
  }

  const haloBox = await page.$eval(".writing-progress-halo", (node) => {
    const rect = (node as HTMLElement).getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
  await page.mouse.move(haloBox.x + haloBox.width / 2, haloBox.y + haloBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(haloBox.x + haloBox.width / 2, 1022, { steps: 8 });
  await page.mouse.up();
  await settle(80);
  const haloStatusGap = await page.evaluate(() => {
    const halo = document.querySelector<HTMLElement>(".writing-progress-halo")!.getBoundingClientRect();
    const status = document.querySelector<HTMLElement>(".folio-statusbar")!.getBoundingClientRect();
    return status.top - halo.bottom;
  });
  if (haloStatusGap < 7) throw new Error(`Folio Halo can overlap the status bar: gap=${haloStatusGap}`);

  await page.click(".writing-progress-halo .progress-halo-orb");
  await page.waitForSelector(".progress-halo-popover");
  const progressSetup = await page.evaluate(() => {
    const current = Number((document.querySelector(".progress-halo-stat > span:first-child strong")?.textContent ?? "0").replace(/[^0-9]/g, ""));
    const target = Math.max(1000, Math.ceil((current / .72) / 1000) * 1000);
    const input = document.querySelector<HTMLInputElement>(".progress-goal-field input");
    if (!input) throw new Error("Progress goal input missing");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, String(target));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { current, target };
  });
  await page.click(".progress-goal-field button");
  await page.waitForFunction((target) => {
    const copy = document.querySelector(".progress-halo-orb")?.textContent ?? "";
    return copy.includes("of " + Number(target).toLocaleString());
  }, {}, progressSetup.target);
  await settle(180);
  await page.screenshot({ path: path.join(qa, "03ac-progress-halo-popover-light.png") });
  await page.click('.progress-halo-popover button[aria-label="Close progress"]');
  await page.waitForFunction(() => !document.querySelector(".progress-halo-popover"));
  await settle(160);
  await page.screenshot({ path: path.join(qa, "03ad-progress-halo-light.png") });

  await settle(300);
  const writeControlAlignment = await page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>(".format-toolbar")!.getBoundingClientRect();
    const find = document.querySelector<HTMLElement>(".search-pill")!.getBoundingClientRect();
    const header = document.querySelector<HTMLElement>(".section-titlebar")!.getBoundingClientRect();
    const sidebar = document.querySelector<HTMLElement>(".write-sidebar-toggle")!.getBoundingClientRect();
    return {
      findDelta: (find.top + find.height / 2) - (toolbar.top + toolbar.height / 2),
      sidebarDelta: (sidebar.top + sidebar.height / 2) - (header.top + header.height / 2),
      savedVisible: [...document.querySelectorAll<HTMLElement>(".write-title-status .save-indicator")]
        .some((node) => node.textContent?.trim() === "Saved"),
    };
  });
  if (Math.abs(writeControlAlignment.findDelta) > 1.5 || Math.abs(writeControlAlignment.sidebarDelta) > 1.5 || writeControlAlignment.savedVisible) {
    throw new Error(`Write control alignment/status failed: ${JSON.stringify(writeControlAlignment)}`);
  }

  await page.screenshot({ path: path.join(qa, "03-write-single.png") });

  await page.click(".write-title-status .word-count-button");
  await page.waitForSelector(".write-title-status .word-count-menu");
  const wordCountMenu = await page.evaluate(() => ({
    labels: [...document.querySelectorAll<HTMLElement>(".write-title-status .word-count-menu button > span")].map((node) => node.textContent?.trim()),
    bookActive: document.querySelector(".write-title-status .word-count-menu button.active")?.textContent?.includes("Book") ?? false,
  }));
  if (wordCountMenu.labels.join("|") !== "Book|Chapter" || !wordCountMenu.bookActive) {
    throw new Error(`Word count scope menu failed: ${JSON.stringify(wordCountMenu)}`);
  }
  await page.screenshot({ path: path.join(qa, "03ab-word-count-menu.png") });
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(".write-title-status .word-count-menu button")];
    const chapter = buttons.find((button) => button.textContent?.includes("Chapter"));
    if (!chapter) throw new Error("Chapter word count option missing");
    chapter.click();
  });
  await page.waitForFunction(() =>
    window.localStorage.getItem("folio-word-count-scope") === "chapter"
    && document.querySelector(".write-title-status .word-count-button small")?.textContent?.trim() === "Chapter",
  );

  const manuscriptBeforeNote = await page.$eval(".manuscript-editor", (editor) => editor.textContent ?? "");
  await page.click(".editor-tools-toggle");
  await page.waitForSelector('.write-studio-drawer[aria-label="Writing tools"]');
  await page.evaluate(() => {
    const notes = [...document.querySelectorAll<HTMLButtonElement>(".write-studio-tabs button")]
      .find((button) => button.textContent?.trim() === "Notes");
    if (!notes) throw new Error("Notes tab missing");
    notes.click();
  });
  await page.waitForSelector(".notes-compose textarea");
  await page.type(".notes-compose input", "QA private note");
  await page.type(".notes-compose textarea", "This note belongs to the project notebook, not to the manuscript.");
  await page.click(".notes-compose .write-small-button.primary");
  await page.waitForFunction(() =>
    [...document.querySelectorAll<HTMLElement>(".note-list-card")].some((card) => card.textContent?.includes("QA private note")),
  );
  const manuscriptAfterNote = await page.$eval(".manuscript-editor", (editor) => editor.textContent ?? "");
  if (manuscriptAfterNote !== manuscriptBeforeNote) throw new Error("Saving a project note changed manuscript content");
  await settle(160);
  await page.screenshot({ path: path.join(qa, "03aa-project-notes.png") });
  await page.click('.write-studio-header button[aria-label="Close writing tools"]');
  await page.waitForFunction(() => !document.querySelector('.write-studio-drawer[aria-label="Writing tools"]'));

  await page.click('.tone-toggle');
  await page.waitForFunction(() => document.querySelector(".folio-shell")?.getAttribute("data-ui-tone") === "midnight");
  await page.waitForFunction(() => document.querySelector(".folio-shell")?.getAttribute("data-editor-surface") === "dark");
  await settle(240);
  await page.screenshot({ path: path.join(qa, "03d-write-midnight.png") });
  await page.click(".writing-progress-halo .progress-halo-orb");
  await page.waitForSelector(".progress-halo-popover");
  await settle(140);
  await page.screenshot({ path: path.join(qa, "03de-progress-halo-midnight.png") });
  await page.click('.progress-halo-popover button[aria-label="Close progress"]');

  await page.click('.editor-surface-toggle');
  await page.waitForFunction(() => document.querySelector(".folio-shell")?.getAttribute("data-editor-surface") === "light"
    && window.localStorage.getItem("folio-editor-surface") === "light");
  await settle(220);
  await page.screenshot({ path: path.join(qa, "03e-write-midnight-light-paper.png") });
  await page.click('.editor-surface-toggle');
  await page.waitForFunction(() => document.querySelector(".folio-shell")?.getAttribute("data-editor-surface") === "dark"
    && window.localStorage.getItem("folio-editor-surface") === "dark");

  await page.click('.tone-toggle');
  await page.waitForFunction(() => document.querySelector(".folio-shell")?.getAttribute("data-ui-tone") === "ivory");
  await settle(160);

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

  const sidebarToolbarGeometry = await page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>(".format-toolbar");
    const controls = [
      document.querySelector<HTMLElement>(".search-pill"),
      document.querySelector<HTMLElement>(".editor-split-toggle"),
      document.querySelector<HTMLElement>(".editor-typewriter-toggle"),
      document.querySelector<HTMLElement>(".editor-focus-toggle"),
    ];
    if (!toolbar || controls.some((control) => !control)) throw new Error("Write layout controls missing with sidebar open");
    const toolbarRect = toolbar.getBoundingClientRect();
    return {
      toolbarLeft: toolbarRect.left,
      toolbarRight: toolbarRect.right,
      controls: controls.map((control) => {
        const element = control!;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          className: element.className,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          display: style.display,
          visibility: style.visibility,
        };
      }),
    };
  });
  const clippedLayoutControl = sidebarToolbarGeometry.controls.find((control) =>
    control.display === "none"
    || control.visibility === "hidden"
    || control.width < 20
    || control.left < sidebarToolbarGeometry.toolbarLeft - 1
    || control.right > sidebarToolbarGeometry.toolbarRight + 1
  );
  if (clippedLayoutControl) {
    throw new Error(`Write toolbar clipped a layout control with sidebar open: ${JSON.stringify(sidebarToolbarGeometry)}`);
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
  const splitAlignment = await page.evaluate(() => {
    const pairs = [
      ["top strip", ".editor-topbar", ".writing-split-top-strip"],
      ["section header", ".section-titlebar", ".writing-split-header"],
      ["format toolbar", ".format-toolbar", ".writing-split-toolbar"],
      ["writing surface", ".editor-paper", ".writing-split-paper"],
      ["manuscript text", ".manuscript-editor", ".writing-split-editor"],
    ] as const;
    return pairs.map(([label, leftSelector, rightSelector]) => {
      const left = document.querySelector<HTMLElement>(leftSelector);
      const right = document.querySelector<HTMLElement>(rightSelector);
      if (!left || !right) throw new Error(`Split alignment QA missing ${label}: ${leftSelector} / ${rightSelector}`);
      const a = left.getBoundingClientRect();
      const b = right.getBoundingClientRect();
      return { label, leftTop: a.top, rightTop: b.top, topDelta: Math.abs(a.top - b.top), leftHeight: a.height, rightHeight: b.height, heightDelta: Math.abs(a.height - b.height) };
    });
  });
  const misaligned = splitAlignment.filter((row) => row.topDelta > 1.5 || row.heightDelta > 1.5);
  if (misaligned.length) throw new Error(`Split editor geometry does not match the primary editor: ${JSON.stringify(misaligned)}`);
  console.log(`Split editor alignment passed: ${JSON.stringify(splitAlignment)}`);
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

  const haloContextBefore = await page.evaluate(() => ({
    primary: document.querySelector<HTMLElement>(".manuscript-editor")?.dataset.sectionId ?? "",
    split: document.querySelector<HTMLElement>(".writing-split-editor")?.dataset.sectionId ?? "",
    halo: document.querySelector<HTMLElement>(".writing-progress-halo")?.dataset.progressSectionId ?? "",
  }));
  if (!haloContextBefore.primary || !haloContextBefore.split || haloContextBefore.primary === haloContextBefore.split) {
    throw new Error(`Split Halo QA missing distinct editor sections: ${JSON.stringify(haloContextBefore)}`);
  }

  await page.click(".writing-split-editor");
  await page.waitForFunction(() => {
    const split = document.querySelector<HTMLElement>(".writing-split-editor")?.dataset.sectionId;
    return Boolean(split) && document.querySelector<HTMLElement>(".writing-progress-halo")?.dataset.progressSectionId === split;
  });
  const splitHaloContext = await page.$eval<HTMLElement, string>(".writing-progress-halo", (halo) => halo.dataset.progressSectionId ?? "");

  await page.click(".manuscript-editor");
  await page.waitForFunction(() => {
    const primary = document.querySelector<HTMLElement>(".manuscript-editor")?.dataset.sectionId;
    return Boolean(primary) && document.querySelector<HTMLElement>(".writing-progress-halo")?.dataset.progressSectionId === primary;
  });
  const primaryHaloContext = await page.$eval<HTMLElement, string>(".writing-progress-halo", (halo) => halo.dataset.progressSectionId ?? "");

  if (splitHaloContext !== haloContextBefore.split || primaryHaloContext !== haloContextBefore.primary) {
    throw new Error(`Halo did not follow active Split pane: ${JSON.stringify({ haloContextBefore, splitHaloContext, primaryHaloContext })}`);
  }

  const wordCountPrimaryContext = await page.$eval<HTMLElement, string>(".write-title-status", (node) => node.dataset.wordCountSectionId ?? "");
  if (wordCountPrimaryContext !== haloContextBefore.primary) {
    throw new Error(`Word count did not follow primary Split pane: ${JSON.stringify({ wordCountPrimaryContext, haloContextBefore })}`);
  }
  await page.click(".writing-split-editor");
  await page.waitForFunction(() => {
    const split = document.querySelector<HTMLElement>(".writing-split-editor")?.dataset.sectionId;
    return Boolean(split) && document.querySelector<HTMLElement>(".write-title-status")?.dataset.wordCountSectionId === split;
  });
  const wordCountSplitContext = await page.$eval<HTMLElement, string>(".write-title-status", (node) => node.dataset.wordCountSectionId ?? "");
  if (wordCountSplitContext !== haloContextBefore.split) {
    throw new Error(`Word count did not follow secondary Split pane: ${JSON.stringify({ wordCountSplitContext, haloContextBefore })}`);
  }

  const findProbe = await page.evaluate(() => {
    const editors = [...document.querySelectorAll<HTMLElement>(".manuscript-editor, .writing-split-editor")];
    const editor = editors.find((candidate) => /\S{4,}/.test(candidate.innerText));
    if (!editor) throw new Error("Find QA could not locate a searchable word");
    editor.click();
    editor.focus();
    const text = editor.innerText;
    const query = text.match(/\S{4,}/)?.[0] ?? "";
    if (!query) throw new Error("Find QA could not extract a searchable word");
    return {
      selector: editor.classList.contains("writing-split-editor") ? ".writing-split-editor" : ".manuscript-editor",
      query,
      html: editor.innerHTML,
      text,
    };
  });
  await page.click(".search-pill");
  await page.waitForSelector(".editor-search input");
  const findGeometry = await page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>(".format-toolbar")!.getBoundingClientRect();
    const search = document.querySelector<HTMLElement>(".editor-search")!.getBoundingClientRect();
    return { toolbarBottom: toolbar.bottom, searchTop: search.top };
  });
  if (findGeometry.searchTop < findGeometry.toolbarBottom - 1) {
    throw new Error(`Find panel overlaps toolbar controls: ${JSON.stringify(findGeometry)}`);
  }
  await page.type(".editor-search input", findProbe.query);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => {
    const count = document.querySelector(".editor-search-count")?.textContent?.trim() ?? "";
    return Boolean(count && count !== "0 / 0");
  });
  await page.keyboard.press("Enter");
  const findAfter = await page.$eval<HTMLElement, { html: string; text: string }>(findProbe.selector, (editor) => ({
    html: editor.innerHTML,
    text: editor.innerText,
  }));
  if (findAfter.html !== findProbe.html || findAfter.text !== findProbe.text) {
    throw new Error("Find mutated manuscript content while navigating matches");
  }
  await page.screenshot({ path: path.join(qa, "04a-find-safe.png") });
  const closeHit = await page.$eval<HTMLButtonElement, { x: number; y: number; hit: boolean }>('.editor-search button[aria-label="Close search"]', (button) => {
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y)?.closest('button[aria-label="Close search"]') === button;
    return { x, y, hit };
  });
  if (!closeHit.hit) throw new Error(`Find close button is obstructed: ${JSON.stringify(closeHit)}`);
  await page.$eval<HTMLButtonElement>('.editor-search button[aria-label="Close search"]', (button) => button.click());
  await page.waitForFunction(() => !document.querySelector(".editor-search"));

  await settle(900);
  const richState = await page.evaluate(() => {
    const editor = document.querySelector(".writing-split-editor");
    const splitHeader = document.querySelector<HTMLElement>(".writing-split-header")!.getBoundingClientRect();
    const splitTitle = document.querySelector<HTMLElement>(".writing-split-title")!.getBoundingClientRect();
    const splitLabel = document.querySelector<HTMLElement>(".writing-split-title > span")!.getBoundingClientRect();
    const splitSelect = document.querySelector<HTMLSelectElement>(".writing-split-title select")!.getBoundingClientRect();
    return {
      colored: Boolean(editor?.querySelector('[style*="color"]')),
      highlighted: Boolean(editor?.querySelector('[style*="background-color"]')),
      previewHidden: getComputedStyle(document.querySelector(".preview-pane")!).display === "none",
      panes: document.querySelectorAll(".manuscript-editor, .writing-split-editor").length,
      splitTitleDelta: (splitTitle.top + splitTitle.height / 2) - (splitHeader.top + splitHeader.height / 2),
      splitLabelDelta: (splitLabel.top + splitLabel.height / 2) - (splitHeader.top + splitHeader.height / 2),
      splitSelectDelta: (splitSelect.top + splitSelect.height / 2) - (splitHeader.top + splitHeader.height / 2),
    };
  });
  if (!richState.colored || !richState.highlighted || !richState.previewHidden || richState.panes < 2
    || Math.abs(richState.splitTitleDelta) > 1.5 || Math.abs(richState.splitLabelDelta) > 1.5 || Math.abs(richState.splitSelectDelta) > 1.5) {
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

  await page.click('.tone-toggle');
  await page.waitForFunction(() => document.querySelector(".folio-shell")?.getAttribute("data-ui-tone") === "midnight");
  await page.click('.command-wordmark');
  await page.waitForSelector('.start-shell[data-ui-tone="midnight"]');
  await settle(260);
  await page.screenshot({ path: path.join(qa, "07-dashboard-midnight.png") });
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

import express from "express";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { registerWriteStudioApi } from "../server/write-studio-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

type Tone = "ivory" | "midnight";

type ContractNode = {
  tag: string;
  className: string;
  role: string;
  aria: string;
  rect: { x: number; y: number; width: number; height: number };
  style: Record<string, string>;
};

type Contract = {
  nodes: ContractNode[];
  controls: Array<{ tag: string; className: string; aria: string; type: string; text: string }>;
};

const qa = path.join(ROOT, "build", "qa-tone-parity");
await fs.rm(qa, { recursive: true, force: true });
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

async function settle(ms = 220) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const report: Array<{
  state: string;
  nodes: number;
  controls: number;
  maxRectDelta: number;
}> = [];
const parityFailures: string[] = [];

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(40_000);
  await page.setViewport({ width: 1536, height: 1024, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument("globalThis.__name = function(target){ return target; }");
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate("globalThis.__name = function(target){ return target; }");

  async function readContract(rootSelector: string): Promise<Contract> {
    return page.evaluate((rootSelector) => {
      const root = document.querySelector<HTMLElement>(rootSelector);
      if (!root) throw new Error(`Parity root missing: ${rootSelector}`);

      const styleKeys = [
        "display", "position", "boxSizing",
        "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight",
        "marginTop", "marginRight", "marginBottom", "marginLeft",
        "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
        "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
        "borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle",
        "borderRadius",
        "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "textAlign", "whiteSpace",
        "overflow", "overflowX", "overflowY",
        "gridTemplateColumns", "gridTemplateRows", "rowGap", "columnGap",
        "flexDirection", "flexGrow", "flexShrink", "justifyContent", "alignItems", "alignSelf",
        "transform",
      ] as const;

      const all = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))].filter((node) => {
        const el = node as HTMLElement;
        const surfaceToggle = el.closest(".editor-surface-toggle");
        if (surfaceToggle && surfaceToggle !== el) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity || "1") > 0
          && rect.width > 0
          && rect.height > 0;
      });
      const nodes = all.map((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const styleContract: Record<string, string> = {};
        for (const key of styleKeys) styleContract[key] = style[key];
        const isTone = el.classList.contains("tone-toggle");
        const isSurfaceToggle = el.classList.contains("editor-surface-toggle");
        return {
          tag: el.tagName.toLowerCase(),
          className: el.getAttribute("class") ?? "",
          role: el.getAttribute("role") ?? "",
          aria: isTone ? "__TONE__" : isSurfaceToggle ? "__SURFACE__" : (el.getAttribute("aria-label") ?? ""),
          rect: {
            x: Math.round(rect.x * 2) / 2,
            y: Math.round(rect.y * 2) / 2,
            width: Math.round(rect.width * 2) / 2,
            height: Math.round(rect.height * 2) / 2,
          },
          style: styleContract,
        };
      });

      const controls = all
        .filter((el) => ["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(el.tagName))
        .map((el) => {
          const isTone = el.classList.contains("tone-toggle");
          const isSurfaceToggle = el.classList.contains("editor-surface-toggle");
          return {
            tag: el.tagName.toLowerCase(),
            className: el.getAttribute("class") ?? "",
            aria: isTone ? "__TONE__" : isSurfaceToggle ? "__SURFACE__" : (el.getAttribute("aria-label") ?? ""),
            type: el.getAttribute("type") ?? "",
            text: isTone ? "__TONE__" : isSurfaceToggle ? "__SURFACE__" : (el.textContent?.replace(/\s+/g, " ").trim() ?? ""),
          };
        });
      return { nodes, controls };
    }, rootSelector);
  }

  function assertParity(state: string, light: Contract, midnight: Contract) {
    const errors: string[] = [];
    let maxRectDelta = 0;
    if (light.nodes.length !== midnight.nodes.length) {
      errors.push(`visible node count ${light.nodes.length} != ${midnight.nodes.length}`);
    }
    const count = Math.min(light.nodes.length, midnight.nodes.length);
    for (let i = 0; i < count; i++) {
      const a = light.nodes[i];
      const b = midnight.nodes[i];
      if (a.tag !== b.tag || a.className !== b.className || a.role !== b.role || a.aria !== b.aria) {
        errors.push(`node ${i} structure differs: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
        if (errors.length >= 12) break;
        continue;
      }
      for (const key of ["x", "y", "width", "height"] as const) {
        const delta = Math.abs(a.rect[key] - b.rect[key]);
        maxRectDelta = Math.max(maxRectDelta, delta);
        if (delta > 1) {
          errors.push(`node ${i} .${a.className} rect ${key} differs by ${delta}px: ${a.rect[key]} vs ${b.rect[key]}`);
          if (errors.length >= 12) break;
        }
      }
      if (errors.length >= 12) break;
      for (const [key, value] of Object.entries(a.style)) {
        if (value !== b.style[key]) {
          errors.push(`node ${i} .${a.className} style ${key}: ${value} != ${b.style[key]}`);
          if (errors.length >= 12) break;
        }
      }
      if (errors.length >= 12) break;
    }
    if (JSON.stringify(light.controls) !== JSON.stringify(midnight.controls)) {
      errors.push(`interactive controls differ\nLIGHT ${JSON.stringify(light.controls)}\nMIDNIGHT ${JSON.stringify(midnight.controls)}`);
    }
    if (errors.length) parityFailures.push(`Tone parity failed for ${state}:\n${errors.join("\n")}`);
    report.push({ state, nodes: light.nodes.length, controls: light.controls.length, maxRectDelta });
  }

  async function setWorkspaceTone(tone: Tone) {
    const current = await page.$eval(".folio-shell", (node) => node.getAttribute("data-ui-tone"));
    if (current === tone) return;
    await page.$eval(".tone-toggle", (button) => (button as HTMLButtonElement).click());
    await page.waitForFunction((tone) => document.querySelector(".folio-shell")?.getAttribute("data-ui-tone") === tone, {}, tone);
    await settle(180);
  }

  let shot = 1;
  async function captureWorkspacePair(label: string) {
    await setWorkspaceTone("ivory");
    await settle();
    const light = await readContract(".folio-shell");
    const prefix = String(shot++).padStart(2, "0");
    await page.screenshot({ path: path.join(qa, `${prefix}-${label}-light.png`) });

    await setWorkspaceTone("midnight");
    await settle();
    const midnight = await readContract(".folio-shell");
    await page.screenshot({ path: path.join(qa, `${prefix}-${label}-midnight.png`) });

    assertParity(label, light, midnight);
    await setWorkspaceTone("ivory");
  }

  async function setDashboardTone(tone: Tone) {
    await page.evaluate((tone) => {
      window.localStorage.setItem("folio-ui-tone", tone);
      window.localStorage.setItem("folio-editor-surface", "auto");
      window.localStorage.removeItem("folio-midnight-editor-surface");
    }, tone);
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector(`.start-shell[data-ui-tone="${tone}"]`);
    await settle();
  }

  await setDashboardTone("ivory");
  const dashboardLight = await readContract(".start-shell");
  const dashboardPrefix = String(shot++).padStart(2, "0");
  await page.screenshot({ path: path.join(qa, `${dashboardPrefix}-dashboard-light.png`) });
  await setDashboardTone("midnight");
  const dashboardMidnight = await readContract(".start-shell");
  await page.screenshot({ path: path.join(qa, `${dashboardPrefix}-dashboard-midnight.png`) });
  assertParity("dashboard", dashboardLight, dashboardMidnight);

  await setDashboardTone("ivory");
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((node) => node.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample missing");
    button.click();
  });
  await page.waitForSelector('.folio-shell[data-workspace-mode="format"]');
  await page.waitForSelector(".preview-frame");
  await page.waitForFunction(() => {
    const frame = document.querySelector<HTMLIFrameElement>(".preview-frame");
    return Boolean(frame?.contentDocument?.body?.innerText?.trim().length);
  });
  await captureWorkspacePair("format-main");

  await page.click('[data-command="design"]');
  await page.waitForSelector('[role="dialog"][aria-label="Book style library"]');
  await captureWorkspacePair("design-book-style");

  const hoverTheme = await page.$(".theme-sample:not(.selected)") ?? await page.$(".theme-sample");
  if (!hoverTheme) throw new Error("Theme card missing for hover parity");
  await hoverTheme.hover();
  await page.waitForSelector(".theme-hover-preview");
  await page.waitForFunction(() => Boolean(document.querySelector<HTMLIFrameElement>(".theme-hover-preview iframe")?.contentDocument?.body?.innerText?.trim().length));
  await captureWorkspacePair("design-hover-preview");
  await page.mouse.move(20, 20);

  for (const category of ["Chapter Heading", "First Paragraph", "Paragraph After Break", "Body", "Scene Break", "Header & Footer", "Title Page"]) {
    await page.evaluate((category) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>(".style-category-list button")]
        .find((node) => node.textContent?.trim() === category);
      if (!button) throw new Error(`Style category missing: ${category}`);
      button.click();
    }, category);
    await settle(120);
    await captureWorkspacePair(`design-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`);
  }

  await page.click('.style-library-header button[aria-label="Close"]');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Book style library"]'));

  await page.click('[data-command="book"]');
  await page.waitForSelector('[role="dialog"][aria-label="Book Details"]');
  await captureWorkspacePair("book-details");
  await page.click('[role="dialog"][aria-label="Book Details"] header button[aria-label="Close"]');

  await page.click('[data-command="settings"]');
  await page.waitForSelector('[role="dialog"][aria-label="Settings"]');
  await captureWorkspacePair("settings");
  await page.click('[role="dialog"][aria-label="Settings"] footer .native-button.primary');

  await page.click(".generate-button");
  await page.waitForSelector(".generate-menu");
  await captureWorkspacePair("export-menu");
  await page.click(".generate-button");

  await page.click(".cover-row");
  await page.waitForSelector(".cover-editor-panel");
  await captureWorkspacePair("cover-workspace");

  await page.click(".library-add-section");
  await page.waitForSelector('[role="dialog"][aria-label="Add Content"]');
  await captureWorkspacePair("add-content");
  await page.click('[role="dialog"][aria-label="Add Content"] header button[aria-label="Close"]');

  await page.click(".chapter-row");
  await page.waitForSelector(".manuscript-editor");

  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".workspace-mode-switch button")]
      .find((node) => node.textContent?.trim() === "Write");
    if (!button) throw new Error("Write mode missing");
    button.click();
  });
  await page.waitForSelector('.folio-shell[data-workspace-mode="write"][data-write-sidebar="closed"]');
  await captureWorkspacePair("write-single");

  await page.click(".write-sidebar-toggle");
  await page.waitForSelector('.folio-shell[data-write-sidebar="open"]');
  await captureWorkspacePair("write-sidebar-open");

  await page.click(".search-pill");
  await page.waitForSelector(".editor-search");
  await captureWorkspacePair("write-search-open");
  await page.click('.editor-search button[aria-label="Close search"]');

  await page.click(".editor-tools-toggle");
  await page.waitForSelector('.write-studio-drawer[aria-label="Writing tools"]');
  await page.waitForFunction(() => Boolean(document.querySelector(".write-studio-section") || document.querySelector(".write-studio-empty")));
  for (const tab of ["Session", "Research", "Comments", "History", "Find", "Analysis"]) {
    await page.evaluate((tab) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>(".write-studio-tabs button")]
        .find((node) => node.textContent?.trim() === tab);
      if (!button) throw new Error(`Writing Studio tab missing: ${tab}`);
      button.click();
    }, tab);
    await settle(180);
    await captureWorkspacePair(`writing-studio-${tab.toLowerCase()}`);
  }
  await page.click('.write-studio-header button[aria-label="Close writing tools"]');

  await page.click(".library-collapse-button");
  await page.waitForSelector('.folio-shell[data-write-sidebar="closed"]');

  await page.click(".editor-split-toggle");
  await page.waitForSelector('.folio-shell[data-split-view="true"] .writing-split-pane');
  await captureWorkspacePair("write-split");

  await page.click(".editor-focus-toggle");
  await page.waitForSelector('.folio-shell[data-focus-mode="true"][data-split-view="true"]');
  await captureWorkspacePair("focus-split");

  await page.click(".focus-split-close");
  await page.waitForSelector('.folio-shell[data-focus-mode="true"][data-split-view="false"]');
  await captureWorkspacePair("focus-single");

  await page.click(".focus-exit");
  await page.waitForSelector('.folio-shell[data-focus-mode="false"]');

  await fs.writeFile(path.join(qa, "parity-report.json"), JSON.stringify({
    passed: parityFailures.length === 0,
    failures: parityFailures,
    states: report,
    comparedProperties: [
      "DOM structure", "visible interactive controls", "bounding boxes",
      "display/position/box sizing", "dimensions", "margins/padding",
      "border widths/styles/radius", "typography metrics", "overflow",
      "grid/flex geometry", "transforms",
    ],
  }, null, 2), "utf8");

  if (parityFailures.length) throw new Error(`Tone parity failures:\n\n${parityFailures.join("\n\n")}`);
  console.log(`Tone parity passed for ${report.length} UI states.`);
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

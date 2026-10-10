import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const app = fs.readFileSync(path.join(root, "web/src/App.tsx"), "utf8");
const themeLab = fs.readFileSync(path.join(root, "web/src/ThemeLab.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "web/src/v320-design-preview.css"), "utf8");
const main = fs.readFileSync(path.join(root, "web/src/main.tsx"), "utf8");
const print = fs.readFileSync(path.join(root, "server/pipeline/render-print.ts"), "utf8");

test("Theme Lab can save reusable styles without carrying a 3.1 badge", () => {
  assert.match(themeLab, /onSaveToLibrary/);
  assert.match(themeLab, /Save to Library/);
  assert.match(themeLab, /Saved ✓/);
  assert.doesNotMatch(themeLab, />Folio 3\.1</);
});

test("saved Theme Lab styles are first-class Book Style cards with live previews", () => {
  assert.match(app, /data-custom-theme=/);
  assert.match(app, /previewSavedTheme/);
  assert.match(app, /onSelectSavedTheme/);
  assert.match(app, /themeLabTypography/);
  assert.match(app, /indexedDB\.open\(THEME_LIBRARY_DB/);
});

test("built-in themes can escape Theme Lab ownership and Design remains editable", () => {
  assert.match(app, /stripThemeLabOwnedTypography/);
  assert.match(app, /function selectBuiltInTheme/);
  assert.match(app, /if \(!ty\.themeLab\?\.enabled\)/);
  assert.match(app, /const lab: ThemeLabConfig = \{ \.\.\.ty\.themeLab, enabled: true \}/);
});

test("every preview mode exposes whole-shell zoom rather than text-only zoom", () => {
  assert.match(app, /aria-label="Preview zoom"/);
  assert.match(app, /--folio-preview-zoom/);
  assert.match(app, /changePreviewZoom/);
  assert.match(css, /\.preview-stage \.reader-device\{transform:scale\(var\(--folio-preview-zoom,1\)\)/);
  assert.match(css, /\.preview-stage\.print-stage/);
});

test("Print preview never throws export diagnostics at the user while export stays strict", () => {
  assert.match(print, /qualityMode: "strict" \| "preview" = "strict"/);
  assert.match(print, /if \(qualityMode === "strict"\)/);
  assert.match(print, /}, "preview"\);/);
  assert.match(print, /folioPrintPreviewQuality = "recoverable"/);
  assert.doesNotMatch(app, /<small>\{previewError\}<\/small>/);
});

test("3.2 polish removes masthead seams and loads after 3.1 design fixes", () => {
  assert.match(css, /command-wordmark\{border-right-color:transparent!important\}/);
  assert.match(css, /tone-toggle\{border-left-color:transparent!important\}/);
  assert.match(css, /data-workspace-mode="format"\] \.section-titlebar/);
  assert.match(css, /section-title-input\\\{font-size:15px!important/);
  assert.ok(main.indexOf('import "./v320-design-preview.css"') > main.indexOf('import "./v311-design-fixes.css"'));
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const app = fs.readFileSync(path.join(root, "web/src/App.tsx"), "utf8");
const themeLab = fs.readFileSync(path.join(root, "web/src/ThemeLab.tsx"), "utf8");
const fontPicker = fs.readFileSync(path.join(root, "web/src/components/FontPicker.tsx"), "utf8");
const fontCss = fs.readFileSync(path.join(root, "web/src/theme-fonts.css"), "utf8");
const fontFetcher = fs.readFileSync(path.join(root, "scripts/fetch-theme-fonts.mjs"), "utf8");
const runtimeFonts = fs.readFileSync(path.join(root, "server/pipeline/theme-fonts.ts"), "utf8");
const globalLibrary = fs.readFileSync(path.join(root, "server/global-library.ts"), "utf8");
const api = fs.readFileSync(path.join(root, "server/api.ts"), "utf8");
const css = fs.readFileSync(path.join(root, "web/src/v320-design-preview.css"), "utf8");
const main = fs.readFileSync(path.join(root, "web/src/main.tsx"), "utf8");
const print = fs.readFileSync(path.join(root, "server/pipeline/render-print.ts"), "utf8");

test("Theme Lab can save reusable styles without carrying a 3.1 badge", () => {
  assert.match(themeLab, /onSaveToLibrary/);
  assert.match(themeLab, /Save to Library/);
  assert.match(themeLab, /Saved ✓/);
  assert.doesNotMatch(themeLab, />Folio 3\.1</);
});

test("saved Theme Lab styles are first-class Book Style cards with persistent disk storage", () => {
  assert.match(app, /data-custom-theme=/);
  assert.match(app, /previewSavedTheme/);
  assert.match(app, /onSelectSavedTheme/);
  assert.match(app, /themeLabTypography/);
  assert.match(app, /api\.themeLibrary\(\)/);
  assert.match(app, /api\.saveThemeLibrary/);
  assert.doesNotMatch(app, /indexedDB|THEME_LIBRARY_DB/);
  assert.match(globalLibrary, /FOLIO_WRITABLE_ROOT/);
  assert.match(globalLibrary, /themes\.json/);
  assert.match(api, /\/api\/library\/themes/);
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
  assert.match(css, /section-title-input\{\s*grid-column:2!important;[\s\S]{0,420}font-size:15px!important/);
  assert.ok(main.indexOf('import "./v320-design-preview.css"') > main.indexOf('import "./v311-design-fixes.css"'));
});

test("3.2.3 centers the Theme Lab label directly and gives Format subtitle its own row", () => {
  assert.match(app, /className="style-open-theme-lab"[^>]*>Theme Lab<\/button>/);
  assert.doesNotMatch(app, /style-open-theme-lab"[^>]*><span>Theme Lab<\/span>/);
  assert.match(css, /style-open-theme-lab\{[\s\S]*display:inline-flex!important;[\s\S]*align-items:center!important;[\s\S]*justify-content:center!important/);
  assert.match(css, /section-title-wrap\{[\s\S]*grid-template-rows:21px 14px!important/);
  assert.match(css, /section-subtitle-button,[\s\S]*section-subtitle-input\{[\s\S]*grid-row:2!important/);
  assert.match(css, /device-toolbar\{grid-template-columns:minmax\(0,1fr\) auto auto!important/);
  assert.match(css, /device-nav\{grid-column:3!important;grid-row:1!important/);
});

test("3.2.2 font library is grouped, Polish-capable and wired through preview/export", () => {
  assert.match(fontPicker, /FONT_TEST_SENTENCE = "Write\. Format\. Publish\."/);
  assert.match(fontPicker, /Blackletter \/ Gothic/);
  assert.match(fontPicker, /Medieval \/ Historical/);
  assert.doesNotMatch(fontPicker, /Zażółć|Jena Gotisch|CAT Altenglisch|Slavkappen|Germania One|Metal Mania|Almendra Display|"Rye"/);

  const gothicFamilies = [
    "Grenze Gotisch", "Fruktur", "Pirata One", "New Rocker", "Jacquarda Bastarda 9",
    "Jaini Purva", "Jaini", "Jim Nightshade", "Texturina", "Manufacturing Consent",
    "Newspaper Text", "KJV1611", "GL-StellaMystica", "GL-StarTaker", "Gothic GumDrop",
    "Blaka", "Blaka Hollow", "Blaka Ink", "GL-GermanCursive", "GL-Morris",
  ];
  const externalFamilies = [
    ["Newspaper Text", "newspaper-text.ttf"],
    ["KJV1611", "kjv1611.otf"],
    ["GL-StellaMystica", "gl-stella-mystica.ttf"],
    ["GL-StarTaker", "gl-startaker.ttf"],
    ["Gothic GumDrop", "gothic-gumdrop.ttf"],
    ["Blaka", "blaka.ttf"],
    ["Blaka Hollow", "blaka-hollow.ttf"],
    ["Blaka Ink", "blaka-ink.ttf"],
    ["GL-GermanCursive", "gl-german-cursive.ttf"],
    ["GL-Morris", "gl-morris.ttf"],
  ];
  for (const family of gothicFamilies) assert.ok(fontPicker.includes(`"${family}"`), family + " picker");
  for (const [family, file] of externalFamilies) {
    assert.ok(fontCss.includes(`font-family:"${family}"`), family + " web face");
    assert.ok(runtimeFonts.includes(`family: "${family}"`), family + " runtime face");
    assert.ok(runtimeFonts.includes(`file: "${file}"`), family + " runtime file");
  }
  assert.match(fontFetcher, /POLISH_GLYPHS = \[\.\.\."ĄĆĘŁŃÓŚŹŻąćęłńóśźż"\]/);
  assert.match(fontFetcher, /assertPolishDisplayCoverage/);
  assert.match(fontFetcher, /raw\.githubusercontent\.com\/Gutenberg-Labo\/GL-StellaMystica/);
  assert.match(fontFetcher, /raw\.githubusercontent\.com\/ctrlcctrlv\/kjv1611/);
  assert.match(fontFetcher, /raw\.githubusercontent\.com\/Gutenberg-Labo\/GL-Morris/);
  assert.doesNotMatch(fontFetcher, /PACK_PARTS|folio-v10-font-pack/);
  assert.match(api, /\(\?:ttf\|otf\)/);
  assert.doesNotMatch(runtimeFonts, /Jena Gotisch|CAT Altenglisch|Slavkappen|Germania One|Metal Mania|Almendra Display|family: "Rye"/);
});

test("saved custom theme cards keep their names clear and preview embedded ornaments", () => {
  assert.doesNotMatch(app, /theme-custom-badge/);
  assert.match(app, /theme\.config\.chapterOrnament/);
  assert.match(app, /theme\.config\.sceneImage/);
  assert.match(app, /sample-chapter-art/);
  assert.match(app, /sample-scene-art/);
  assert.match(css, /theme-sample\.theme-custom \.theme-name\{right:34px!important/);
});

test("3.2.3 uses Folio preview copy as one block everywhere", () => {
  assert.match(fontPicker, /FONT_TEST_SENTENCE = "Write\. Format\. Publish\."/);
  assert.ok((app.match(/<span className="sample-copy">Write\. Format\. Publish\.<\/span>/g) ?? []).length >= 2);
  assert.doesNotMatch(app, /room had fallen quiet/);
  assert.doesNotMatch(fontPicker, /Sphinx of black quartz/);
});

test("3.2.3 custom Chapter fonts persist and travel with exported theme packages", () => {
  assert.match(themeLab, /onInstallCustomFont/);
  assert.match(themeLab, /Add custom font/);
  assert.match(themeLab, /accept="\.ttf,\.otf/);
  assert.match(themeLab, /version: 2/);
  assert.match(themeLab, /customFonts: customFonts\.length \? customFonts : undefined/);
  assert.match(themeLab, /api\.customFontUrl/);
  assert.match(app, /api\.customFonts\(\)/);
  assert.match(app, /folio-custom-font-faces/);
  assert.match(api, /\/api\/library\/fonts/);
  assert.match(globalLibrary, /fonts\.json/);
  assert.match(globalLibrary, /installCustomFont/);
  assert.match(runtimeFonts, /customFontByFamily/);
  assert.match(runtimeFonts, /customFontFaceCss/);
  assert.match(runtimeFonts, /customFonts\.map\(\(font\) => customFontPath\(font\)\)/);
});


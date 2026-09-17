import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const main = fs.readFileSync(path.join(root, "web/src/main.tsx"), "utf8");
const v205 = fs.readFileSync(path.join(root, "web/src/v205-coherence.css"), "utf8");
const v206 = fs.readFileSync(path.join(root, "web/src/v206-correction.css"), "utf8");
const imagePageCss = fs.readFileSync(path.join(root, "themes/image-page.css"), "utf8");

test("the 2.0.6 correction layer is loaded after all older branding and polish layers", () => {
  const branding = main.indexOf('import "./pelagiad-branding.css"');
  const coherence = main.indexOf('import "./v205-coherence.css"');
  const correction = main.indexOf('import "./v206-correction.css"');
  assert.ok(branding >= 0, "Pelagiad branding stylesheet should remain loaded");
  assert.ok(coherence > branding, "v205 coherence should remain after old branding");
  assert.ok(correction > coherence, "v206 correction must be the final visual override layer");
});

test("exact Pelagiad asset is reserved for Folio wordmarks", () => {
  assert.match(v205, /@font-face\s*\{[\s\S]*font-family:\s*"Folio Pelagiad Exact"[\s\S]*src:\s*url\("\.\/assets\/Pelagiad\.ttf"\)/);
  assert.match(v206, /--folio-logo-font:\s*"Folio Pelagiad Exact"/);
  assert.match(v206, /\.start-brand,[\s\S]*\.command-wordmark,[\s\S]*\.folio-wordmark/);
  assert.match(v206, /\.start-brand,[\s\S]*?font-family:\s*var\(--folio-logo-font\)\s*!important/);
  assert.match(v206, /--folio-ui-font:\s*"Folio Source Sans 3"/);
});

test("Manuscript and Page Preview use exactly the same UI typography metrics", () => {
  const peerBlock = v206.match(/\.pane-label,\s*\n\.folio-shell\[data-ui-tone\] \.preview-pane-title\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  assert.match(peerBlock, /font-family:\s*var\(--folio-ui-font\)\s*!important/);
  assert.match(peerBlock, /font-size:\s*10\.5px\s*!important/);
  assert.match(peerBlock, /font-weight:\s*650\s*!important/);
  assert.match(peerBlock, /letter-spacing:\s*\.115em\s*!important/);
  assert.match(peerBlock, /text-transform:\s*uppercase\s*!important/);
});

test("Replace Cover and Export use one UI family and desktop control sizing", () => {
  const coverBlock = v206.match(/\.native-button\.primary\.cover-upload-button,[\s\S]*?\.cover-button\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  const exportBlock = v206.match(/\.folio-shell\[data-ui-tone\] \.generate-button\s*\{([\s\S]*?)\}/)?.[1] ?? "";

  assert.match(coverBlock, /font-family:\s*var\(--folio-ui-font\)\s*!important/);
  assert.doesNotMatch(coverBlock, /Georgia|Times New Roman|folio-ui-display/);
  assert.match(exportBlock, /font-family:\s*var\(--folio-ui-font\)\s*!important/);
  assert.doesNotMatch(exportBlock, /Georgia|Times New Roman|folio-ui-display/);
  assert.match(coverBlock, /min-height:\s*36px\s*!important/);
  assert.match(exportBlock, /height:\s*36px\s*!important/);
});

test("cover artwork maximises inside the reader but is never cropped", () => {
  assert.match(v206, /\.reader-screen\s*>\s*\.cover-preview-surface\s*\{[\s\S]*?inset:\s*0\s*!important/);
  assert.match(v206, /\.cover-preview-surface\s*>\s*img\s*\{[\s\S]*?width:\s*100%\s*!important[\s\S]*?height:\s*100%\s*!important[\s\S]*?object-fit:\s*contain\s*!important/);
  assert.doesNotMatch(v206, /\.cover-preview-surface\s*>\s*img\s*\{[\s\S]*?object-fit:\s*cover\s*!important/);
  assert.match(v206, /\.reader-screen,[\s\S]*?\.preview-frame\s*\{[\s\S]*?overflow:\s*hidden\s*!important/);
});

test("full-page artwork is white, fills the viewport, and legacy cover-fit can no longer crop", () => {
  assert.match(imagePageCss, /body\.book-formatter:has\(main\.book\s*>\s*section\.image-page:only-child\)/);
  assert.match(imagePageCss, /body\.book-formatter:has\(main\.book\s*>\s*section\.image-page:only-child\)\s*>\s*main\.book\s*\{[\s\S]*?width:\s*100vw\s*!important[\s\S]*?height:\s*100vh\s*!important[\s\S]*?max-width:\s*none\s*!important[\s\S]*?padding:\s*0\s*!important[\s\S]*?background:\s*#fff\s*!important/);
  assert.match(imagePageCss, /main\.book\s*>\s*section\.image-page:only-child\s*\{[\s\S]*?width:\s*100%\s*!important[\s\S]*?height:\s*100%\s*!important/);
  assert.match(imagePageCss, /img\.full-page-image\.fit-contain,[\s\S]*img\.full-page-image\.fit-cover\s*\{\s*object-fit:\s*contain\s*!important/);
  assert.doesNotMatch(imagePageCss, /img\.full-page-image\.fit-cover\s*\{\s*object-fit:\s*cover/);
});

test("dedicated image-page editor removes prose chrome and beige illustration cards", () => {
  assert.match(v206, /\.editor-pane\.folio-image-page-mode \.format-toolbar\s*\{\s*display:\s*none\s*!important/);
  assert.match(v206, /\.editor-pane\.folio-image-page-mode \.editor-paper\s*\{\s*background:\s*#fff\s*!important/);
  assert.match(v206, /\.manuscript-editor\.folio-image-page-editor\s*\{[\s\S]*?background:\s*#fff\s*!important[\s\S]*?overflow:\s*hidden\s*!important/);
  assert.match(v206, /\.editor-full-page-art\s*\{[\s\S]*?width:\s*100%\s*!important[\s\S]*?height:\s*100%\s*!important[\s\S]*?background:\s*#fff\s*!important/);
  assert.match(v206, /\.editor-illustration:not\(\.editor-full-page-art\)\s*\{\s*background:\s*#fff\s*!important/);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const main = fs.readFileSync(path.join(root, "web/src/main.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "web/src/v205-coherence.css"), "utf8");
const imagePageCss = fs.readFileSync(path.join(root, "themes/image-page.css"), "utf8");

test("the coherence layer is loaded after the older branding and polish layers", () => {
  const branding = main.indexOf('import "./pelagiad-branding.css"');
  const coherence = main.indexOf('import "./v205-coherence.css"');
  assert.ok(branding >= 0, "Pelagiad branding stylesheet should remain loaded");
  assert.ok(coherence > branding, "v205 coherence overrides must load last");
});

test("Pelagiad is reserved for Folio wordmarks", () => {
  assert.match(css, /--folio-logo-font:\s*"Pelagiad"/);
  assert.match(css, /\.start-brand,[\s\S]*\.command-wordmark,[\s\S]*\.folio-wordmark/);
  assert.match(css, /\.start-brand,[\s\S]*?font-family:\s*var\(--folio-logo-font\)\s*!important/);

  const uiBlocks = css.match(/font-family:\s*var\(--folio-ui-font\)\s*!important/g) ?? [];
  assert.ok(uiBlocks.length >= 8, "application chrome should consistently use the UI family");
});

test("Manuscript and Page Preview use the same UI typography metrics", () => {
  const peerBlock = css.match(/\.pane-label,\s*\n\.folio-shell\[data-ui-tone\] \.preview-pane-title\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  assert.match(peerBlock, /font-family:\s*var\(--folio-ui-font\)\s*!important/);
  assert.match(peerBlock, /font-size:\s*10px\s*!important/);
  assert.match(peerBlock, /font-weight:\s*650\s*!important/);
  assert.match(peerBlock, /letter-spacing:\s*\.12em\s*!important/);
  assert.match(peerBlock, /text-transform:\s*uppercase\s*!important/);
});

test("Replace Book Cover and Export share the UI family instead of legacy serif/display faces", () => {
  const coverBlock = css.match(/\.native-button\.primary\.cover-upload-button,[\s\S]*?\.native-button\.cover-button\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  const exportBlock = css.match(/\.folio-shell\[data-ui-tone\] \.generate-button\s*\{([\s\S]*?)\}/)?.[1] ?? "";

  assert.match(coverBlock, /font-family:\s*var\(--folio-ui-font\)\s*!important/);
  assert.doesNotMatch(coverBlock, /Georgia|Times New Roman|folio-ui-display/);
  assert.match(exportBlock, /font-family:\s*var\(--folio-ui-font\)\s*!important/);
  assert.doesNotMatch(exportBlock, /Georgia|Times New Roman|folio-ui-display/);
  assert.match(coverBlock, /min-height:\s*32px/);
  assert.match(exportBlock, /height:\s*32px/);
});

test("cover artwork owns the full reader surface without nested scrolling", () => {
  assert.match(css, /\.reader-screen\s*>\s*\.cover-preview-surface\s*\{[\s\S]*?inset:\s*0\s*!important/);
  assert.match(css, /\.cover-preview-surface\s*>\s*img\s*\{[\s\S]*?width:\s*100%\s*!important[\s\S]*?height:\s*100%\s*!important[\s\S]*?object-fit:\s*cover\s*!important/);
  assert.match(css, /\.reader-screen,[\s\S]*?\.preview-frame\s*\{[\s\S]*?overflow:\s*hidden\s*!important/);
});

test("selected full-page image escapes the prose measure in Reader", () => {
  assert.match(imagePageCss, /body\.book-formatter:has\(main\.book\s*>\s*section\.image-page:only-child\)/);
  assert.match(imagePageCss, /body\.book-formatter:has\(main\.book\s*>\s*section\.image-page:only-child\)\s*>\s*main\.book\s*\{[\s\S]*?width:\s*100vw\s*!important[\s\S]*?height:\s*100vh\s*!important[\s\S]*?max-width:\s*none\s*!important[\s\S]*?padding:\s*0\s*!important/);
  assert.match(imagePageCss, /main\.book\s*>\s*section\.image-page:only-child\s*\{[\s\S]*?width:\s*100%\s*!important[\s\S]*?height:\s*100%\s*!important/);
  assert.match(imagePageCss, /img\.full-page-image\.fit-contain\s*\{\s*object-fit:\s*contain/);
  assert.match(imagePageCss, /img\.full-page-image\.fit-cover\s*\{\s*object-fit:\s*cover/);
});

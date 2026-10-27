import assert from "node:assert/strict";
import { markdownToEditorHtml } from "../web/src/rich-text.ts";
import { prepareFullPageImageMarkdown } from "../server/pipeline/build-doc.ts";

const legacy = "BEFORE_PARAGRAPH\n\n![Map](assets/map.png){.full-page-image .fit-contain}\n\nAFTER_PARAGRAPH";
const editor = markdownToEditorHtml(legacy);
assert.ok(editor.includes("BEFORE_PARAGRAPH") && editor.includes("AFTER_PARAGRAPH"), "legacy prose survives editor hydration");
assert.ok(editor.includes('data-folio-asset="assets/map.png"'), "legacy image asset survives hydration");
assert.ok(!editor.includes("editor-full-page-image") && !editor.includes("data-folio-full-page"), "legacy image must be an ordinary editable illustration");
const published = prepareFullPageImageMarkdown(legacy);
assert.ok(published.includes("BEFORE_PARAGRAPH") && published.includes("AFTER_PARAGRAPH") && published.includes("assets/map.png"), "publishing preserves prose and asset");
assert.ok(!published.includes("folio-inline-image-page") && !published.includes(".full-page-image"), "legacy chapter image must not force page breaks");
assert.ok(prepareFullPageImageMarkdown(legacy, true).includes(".full-page-image"), "dedicated legacy image section remains readable");
assert.match(published, /\.folio-illustration/, "legacy chapter artwork must use ordinary image sizing guards");
console.log("7 passed, 0 failed");

from pathlib import Path

root = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    path.write_text(text.replace(old, new), encoding="utf-8")

# ---------------------------------------------------------------------------
# Print/PDF geometry: compose against the final page measure, not the browser
# viewport. Folio 1.0.10 composed nowrap line boxes at the unpaginated screen
# width and only afterwards let Paged.js put them into a narrower trim area.
# That can visibly crop the right side of lines in the exported PDF.
# ---------------------------------------------------------------------------
print_ts = root / "server/print.ts"
replace_once(
    print_ts,
    '''function margins(gutter: number, trim: Trim): Margins {\n  const measureAtMinOuter = trim.w - gutter - MIN_OUTER;\n  const outer = measureAtMinOuter > MAX_MEASURE ? trim.w - gutter - MAX_MEASURE : MIN_OUTER;\n  // Vertical margins grow gently with page height so tall pages aren't cramped.\n  const vert = Math.min(1.0, Math.max(0.7, trim.h * 0.09));\n  return {\n    top: Math.round(vert * 1000) / 1000,\n    bottom: Math.round(vert * 1000) / 1000,\n    outer: Math.round(outer * 1000) / 1000,\n    inner: gutter,\n  };\n}\n''',
    '''function margins(gutter: number, trim: Trim): Margins {\n  const measureAtMinOuter = trim.w - gutter - MIN_OUTER;\n  const outer = measureAtMinOuter > MAX_MEASURE ? trim.w - gutter - MAX_MEASURE : MIN_OUTER;\n  // Vertical margins grow gently with page height so tall pages aren't cramped.\n  const vert = Math.min(1.0, Math.max(0.7, trim.h * 0.09));\n  return {\n    top: Math.round(vert * 1000) / 1000,\n    bottom: Math.round(vert * 1000) / 1000,\n    outer: Math.round(outer * 1000) / 1000,\n    inner: gutter,\n  };\n}\n\n/** Exact horizontal text measure used by the paged print interior. */\nexport function printContentWidthIn(opts: PrintOptions, gutter: number): number {\n  const trim = getTrim(opts.trim);\n  const m = margins(gutter, trim);\n  return Math.max(1, trim.w - m.inner - m.outer);\n}\n''',
    "print content width helper",
)

render_print = root / "server/pipeline/render-print.ts"
replace_once(
    render_print,
    'import { autoGutter, buildPageCss, estimatePages, getTrim, type PrintOptions } from "../print.ts";\n',
    'import { autoGutter, buildPageCss, estimatePages, getTrim, printContentWidthIn, type PrintOptions } from "../print.ts";\n',
    "render-print import",
)
replace_once(
    render_print,
    '''  const browser = await getBrowser();\n  const page = await browser.newPage();\n  try {\n    await page.setContent(html, { waitUntil: "load" });\n    await applyProfessionalHyphenation(page, book);\n''',
    '''  const browser = await getBrowser();\n  const page = await browser.newPage();\n  try {\n    // page.pdf() ultimately uses print media. Compose under the same media from\n    // the beginning so @media print font/spacing rules cannot invalidate the\n    // line geometry after Folio has already frozen lines into nowrap spans.\n    await page.emulateMediaType("print");\n    await page.setContent(html, { waitUntil: "load" });\n\n    // Paged.js applies @page margins only during pagination. The professional\n    // compositor runs before that, so explicitly give the source book the exact\n    // final text measure. Without this, it measures the browser viewport and the\n    // resulting nowrap lines can be wider than the physical page and get cropped.\n    const contentWidthIn = printContentWidthIn(opts, gutter);\n    await page.evaluate((measure) => {\n      const sourceMeasure = document.createElement("style");\n      sourceMeasure.id = "folio-print-source-measure";\n      sourceMeasure.textContent = `main.book{width:${measure}in!important;max-width:${measure}in!important;margin-left:0!important;margin-right:0!important;}`;\n      document.head.appendChild(sourceMeasure);\n    }, contentWidthIn);\n\n    await applyProfessionalHyphenation(page, book);\n''',
    "compose at final print measure",
)
replace_once(
    render_print,
    '''    const pages = await page.evaluate(() => document.querySelectorAll(".pagedjs_page").length);\n    const result = await fn(page);\n''',
    '''    // Fail closed instead of emitting a PDF whose composed prose is visibly\n    // outside the printable area. Optical punctuation may hang a few pixels, so\n    // each line gets its declared protrusion plus the normal residual tolerance.\n    const overflow = await page.evaluate(() => {\n      let checked = 0;\n      let violations = 0;\n      let worstPx = 0;\n      let sample = "";\n      for (const line of document.querySelectorAll<HTMLElement>(".folio-composed-line")) {\n        const pageNode = line.closest<HTMLElement>(".pagedjs_page");\n        const area = pageNode?.querySelector<HTMLElement>(".pagedjs_area")\n          ?? pageNode?.querySelector<HTMLElement>(".pagedjs_page_content");\n        const content = line.querySelector<HTMLElement>(":scope > .folio-line-content");\n        if (!area || !content) continue;\n        checked++;\n        const areaRect = area.getBoundingClientRect();\n        const contentRect = content.getBoundingClientRect();\n        const protrusion = Math.max(0, Number(line.dataset.folioRightProtrusion ?? 0));\n        const allowedRight = protrusion + 1.9;\n        const leftOverflow = Math.max(0, areaRect.left - contentRect.left);\n        const rightOverflow = Math.max(0, contentRect.right - areaRect.right - allowedRight);\n        const excess = Math.max(leftOverflow, rightOverflow);\n        if (excess > 0.35) {\n          violations++;\n          if (excess > worstPx) {\n            worstPx = excess;\n            sample = (line.textContent ?? "").replace(/\\u00ad/g, "").trim().slice(0, 180);\n          }\n        }\n      }\n      return { checked, violations, worstPx, sample };\n    });\n    if (overflow.violations > 0) {\n      throw new Error(`Print layout overflow: ${overflow.violations}/${overflow.checked} composed lines exceed the page area; worst ${overflow.worstPx.toFixed(2)}px (${overflow.sample})`);\n    }\n\n    const pages = await page.evaluate(() => document.querySelectorAll(".pagedjs_page").length);\n    const result = await fn(page);\n''',
    "print overflow release gate",
)

render_pdf = root / "server/pipeline/render-pdf.ts"
replace_once(
    render_pdf,
    '''  const page = await browser.newPage();\n  try {\n    await page.setContent(html, { waitUntil: "load" });\n    await applyProfessionalHyphenation(page, book);\n''',
    '''  const page = await browser.newPage();\n  try {\n    await page.emulateMediaType("print");\n    await page.setContent(html, { waitUntil: "load" });\n    // The reading PDF is 6×9 with 0.7in side margins. Compose against its\n    // 4.6in text measure before freezing lines into nowrap compositor spans.\n    await page.addStyleTag({\n      content: "main.book{width:4.6in!important;max-width:4.6in!important;margin-left:0!important;margin-right:0!important;}",\n    });\n    await applyProfessionalHyphenation(page, book);\n''',
    "reading PDF source measure",
)

# ---------------------------------------------------------------------------
# Conservative UI polish. Same Folio structure, same panes and actions. This
# only tightens visual hierarchy, surfaces and interaction states.
# ---------------------------------------------------------------------------
ui = root / "web/src/editorial-studio.css"
ui_text = ui.read_text(encoding="utf-8")
marker = "/* v1.0.11 restrained desktop polish */"
if marker not in ui_text:
    ui_text += r'''

/* v1.0.11 restrained desktop polish */
.folio-shell[data-ui-tone="ivory"] {
  --studio-bg: #ebe9e5;
  --studio-chrome: #f8f7f4;
  --studio-sidebar: #f2f0ec;
  --studio-surface: #fcfbf8;
  --studio-paper: #fffefb;
  --studio-editor-canvas: #e7e4df;
  --studio-preview: #dfddd8;
  --studio-preview-chrome: #f5f4f1;
  --studio-preview-control: #eeece7;
  --studio-preview-hover: #e7e3dc;
  --studio-ink: #242320;
  --studio-muted: #6c6861;
  --studio-faint: #9b958c;
  --studio-rule: #d8d3cb;
  --studio-rule-strong: #c7c1b8;
  --studio-accent: #8c664d;
  --studio-accent-soft: #e8ded4;
  --studio-control: #f4f2ed;
}

.folio-shell[data-ui-tone="midnight"] {
  --studio-bg: #17181a;
  --studio-chrome: #1d1e20;
  --studio-sidebar: #202124;
  --studio-surface: #252629;
  --studio-paper: #292a2d;
  --studio-editor-canvas: #1a1b1d;
  --studio-preview: #121315;
  --studio-preview-chrome: #1b1c1f;
  --studio-preview-control: #25262a;
  --studio-preview-hover: #303136;
  --studio-rule: #36383c;
  --studio-rule-strong: #484a4f;
  --studio-accent: #c7a077;
  --studio-accent-soft: #3d342d;
  --studio-control: #292a2e;
}

.folio-shell[data-ui-tone] .folio-commandbar,
.folio-shell[data-ui-tone] .editor-topbar,
.folio-shell[data-ui-tone] .format-toolbar,
.folio-shell[data-ui-tone] .preview-topbar,
.folio-shell[data-ui-tone] .device-toolbar,
.folio-shell[data-ui-tone] .folio-statusbar {
  -webkit-font-smoothing: antialiased;
}

.folio-shell[data-ui-tone] .command-wordmark {
  font-size: 14px;
  font-weight: 670;
  letter-spacing: -.02em;
}

.folio-shell[data-ui-tone] .folio-commandbar nav button,
.folio-shell[data-ui-tone] .folio-commandbar .tone-toggle {
  transition: color 120ms ease, background-color 120ms ease, box-shadow 120ms ease;
}

.folio-shell[data-ui-tone] .folio-commandbar nav button:hover,
.folio-shell[data-ui-tone] .folio-commandbar .tone-toggle:hover {
  background: color-mix(in srgb, var(--studio-accent-soft) 28%, transparent);
}

.folio-shell[data-ui-tone] .contents-list,
.folio-shell[data-ui-tone] .manuscript-editor,
.folio-shell[data-ui-tone] .preview-stage {
  scrollbar-width: thin;
}

.folio-shell[data-ui-tone] .contents-row {
  height: 32px;
  line-height: 32px;
  transition: background-color 100ms ease, color 100ms ease;
}

.folio-shell[data-ui-tone] .contents-row:hover {
  background: color-mix(in srgb, var(--studio-accent-soft) 42%, transparent);
}

.folio-shell[data-ui-tone] .contents-row.selected {
  background: color-mix(in srgb, var(--studio-accent-soft) 72%, var(--studio-sidebar));
  box-shadow: inset 2px 0 0 var(--studio-accent);
}

.folio-shell[data-ui-tone] .contents-row.selected::after {
  width: 3px;
  height: 3px;
  opacity: .6;
}

.folio-shell[data-ui-tone] .section-titlebar {
  background: color-mix(in srgb, var(--studio-surface) 96%, var(--studio-bg));
}

.folio-shell[data-ui-tone] .section-title,
.folio-shell[data-ui-tone] .section-title-button {
  font-size: 20.5px;
  font-weight: 650;
}

.folio-shell[data-ui-tone] .format-toolbar button,
.folio-shell[data-ui-tone] .search-pill,
.folio-shell[data-ui-tone] .section-move,
.folio-shell[data-ui-tone] .section-design,
.folio-shell[data-ui-tone] .section-delete,
.folio-shell[data-ui-tone] .toolbar-text-button,
.folio-shell[data-ui-tone] .icon-button {
  border-radius: 4px;
  transition: background-color 100ms ease, color 100ms ease, border-color 100ms ease;
}

.folio-shell[data-ui-tone] .editor-paper {
  background: color-mix(in srgb, var(--studio-editor-canvas) 94%, var(--studio-surface));
}

.folio-shell[data-ui-tone] .manuscript-editor {
  border-color: color-mix(in srgb, var(--studio-rule-strong) 78%, transparent);
  background: var(--studio-paper);
}

.folio-shell[data-ui-tone="ivory"] .manuscript-editor {
  box-shadow: 0 1px 0 rgba(49, 43, 36, .035);
}

.folio-shell[data-ui-tone] .preview-topbar,
.folio-shell[data-ui-tone] .device-toolbar {
  background: color-mix(in srgb, var(--studio-preview-chrome) 96%, var(--studio-preview));
}

.folio-shell[data-ui-tone] .device-label select,
.folio-shell[data-ui-tone] .trim-select,
.folio-shell[data-ui-tone] .editor-search {
  border-radius: 4px;
}

.folio-shell[data-ui-tone] .generate-button {
  text-decoration: none;
}

.folio-shell[data-ui-tone] .generate-button:hover {
  text-decoration: none;
  box-shadow: inset 0 -1px 0 currentColor;
}

.folio-shell[data-ui-tone] .folio-dialog,
.folio-shell[data-ui-tone] .style-library {
  border-radius: 5px;
  box-shadow: 0 20px 52px rgba(0,0,0,.24);
}

.folio-shell[data-ui-tone] .native-button,
.folio-shell[data-ui-tone] .dialog-field input,
.folio-shell[data-ui-tone] .dialog-field textarea,
.folio-shell[data-ui-tone] .dialog-field select,
.folio-shell[data-ui-tone] .setting-control input,
.folio-shell[data-ui-tone] .setting-control select {
  border-radius: 4px;
}
'''
    ui.write_text(ui_text, encoding="utf-8")

# Strengthen acceptance: print export must now reject/avoid composed text that
# lies outside the Paged.js content area. Exercise both a narrow and normal trim.
acceptance = root / "tests/acceptance.test.ts"
replace_once(
    acceptance,
    '''const print = await renderPrintPdf(sample, DEFAULT_PRINT);\nconst reading = await renderPdf(sample);\n''',
    '''const print = await renderPrintPdf(sample, DEFAULT_PRINT);\nconst narrowPrint = await renderPrintPdf(sample, { ...DEFAULT_PRINT, trim: "5x8" });\nconst reading = await renderPdf(sample);\n''',
    "acceptance narrow print render",
)
replace_once(
    acceptance,
    '''check(\n  "   print output is a non-trivial PDF",\n  print.buffer.subarray(0, 5).toString() === "%PDF-" && print.buffer.length > 50_000,\n  `${print.buffer.length} bytes`,\n);\n''',
    '''check(\n  "   print output is a non-trivial PDF",\n  print.buffer.subarray(0, 5).toString() === "%PDF-" && print.buffer.length > 50_000,\n  `${print.buffer.length} bytes`,\n);\ncheck(\n  "   narrow 5x8 print PDF composes without clipped text",\n  narrowPrint.buffer.subarray(0, 5).toString() === "%PDF-" && narrowPrint.buffer.length > 50_000 && narrowPrint.meta.pages >= print.meta.pages,\n  `${narrowPrint.meta.pages} pages; ${narrowPrint.buffer.length} bytes`,\n);\n''',
    "acceptance narrow print assertion",
)

print("Applied Folio 1.0.11 print-geometry and restrained UI polish patch.")

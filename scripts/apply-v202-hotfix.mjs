import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFile(path.join(ROOT, file), "utf8");
const write = (file, text) => fs.writeFile(path.join(ROOT, file), text, "utf8");

async function replaceExact(file, before, after, label = file) {
  const text = await read(file);
  if (!text.includes(before)) throw new Error(`Patch anchor missing: ${label}`);
  await write(file, text.replace(before, after));
}

async function replaceRegex(file, pattern, replacement, label = file) {
  const text = await read(file);
  if (!pattern.test(text)) throw new Error(`Patch pattern missing: ${label}`);
  await write(file, text.replace(pattern, replacement));
}

// 2.0.2 is a corrective release. Keep package and lockfile versions atomic.
for (const file of ["package.json", "package-lock.json"]) {
  const json = JSON.parse(await read(file));
  json.version = "2.0.2";
  if (json.packages?.[""]) json.packages[""].version = "2.0.2";
  await write(file, JSON.stringify(json, null, 2) + "\n");
}
await replaceExact("web/src/StartScreen.tsx", '<div className="start-version">2.0.1</div>', '<div className="start-version">2.0.2</div>', "start-screen version");

// Print preview must render the selected section, not paginate a 150-page book
// every time the user switches to Print or pauses while typing.
await replaceExact(
  "server/api.ts",
  `      const { book } = await loadProject(req.params.id, bodyMeta(req));\n      applyTypography(book, req);\n      applyPreviewDraft(book, req);\n      const print: PrintOptions = { ...DEFAULT_PRINT, ...(req.body?.print ?? {}) };\n      const { html, meta } = await renderPrintPreviewHtml(book, print);`,
  `      const { book } = await loadProject(req.params.id, bodyMeta(req));\n      applyTypography(book, req);\n      const sectionId = applyPreviewDraft(book, req);\n      // Print preview follows the same selected-section contract as Reader.\n      // Paginating the entire manuscript made realistic 100+ page projects look\n      // broken and kept Chromium busy long after the client had moved on.\n      if (sectionId) book.sections = book.sections.filter((section) => section.id === sectionId);\n      const print: PrintOptions = { ...DEFAULT_PRINT, ...(req.body?.print ?? {}) };\n      const { html, meta } = await renderPrintPreviewHtml(book, print);`,
  "selected-section print preview",
);

// The image control used to be an invisible file input stretched over a bespoke
// card. Use a real button matching the other Add Content rows, then trigger a
// visually-hidden input explicitly. It behaves consistently in Electron and in
// the browser tests and no longer looks like a foreign component.
await replaceRegex(
  "web/src/App.tsx",
  /function ContentDialog\(props: \{ matterTypes: MatterType\[\]; title: string; setTitle: \(title: string\) => void; busy: boolean; onAddChapter: \(\) => void; onAddMatter: \(type: MatterType\) => void; onAddImagePage: \(file: File\) => void; onClose: \(\) => void \}\) \{[\s\S]*?\n\}\n\nfunction StyleLibrary/,
  `function ContentDialog(props: { matterTypes: MatterType[]; title: string; setTitle: (title: string) => void; busy: boolean; onAddChapter: () => void; onAddMatter: (type: MatterType) => void; onAddImagePage: (file: File) => void; onClose: () => void }) {\n  const front = props.matterTypes.filter((type) => type.placement === "frontmatter");\n  const back = props.matterTypes.filter((type) => type.placement === "backmatter");\n  const imageInputRef = useRef<HTMLInputElement>(null);\n  const group = (label: string, items: MatterType[], imagePage = false) => <div className="content-kind-group"><h3>{label}</h3>{imagePage && <><button type="button" className="content-image-kind" disabled={props.busy} onClick={() => imageInputRef.current?.click()}><span>Full-page Image</span><small>Map, family tree or illustration</small></button><input ref={imageInputRef} className="content-image-input" type="file" accept="image/png,image/jpeg" disabled={props.busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onAddImagePage(file); event.currentTarget.value = ""; }}/></>}{items.map((type) => <button key={type.key} disabled={props.busy} onClick={() => props.onAddMatter(type)}><span>{type.label}</span><small>Add editable page</small></button>)}</div>;\n  return <DialogShell title="Add Content" onClose={props.onClose} footer={<button className="native-button" onClick={props.onClose}>Close</button>}><div className="add-chapter-box"><h3>Chapter</h3><div><input autoFocus value={props.title} onChange={(e) => props.setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && props.title.trim()) props.onAddChapter(); }}/><button className="native-button primary" disabled={props.busy || !props.title.trim()} onClick={props.onAddChapter}>Add Chapter</button></div></div><div className="content-kind-columns">{group("Front Matter", front, true)}{group("Back Matter", back)}</div></DialogShell>;\n}\n\nfunction StyleLibrary`,
  "full-page image control",
);

await write("web/src/image-page-workspace.css", `.content-image-kind {\n  position: relative;\n}\n\n/* The Full-page Image action is deliberately the same row component as the\n * other front-matter actions. No one needs a mystery card inside a plain list. */\n.content-kind-group .content-image-kind {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  width: 100%;\n  height: 31px;\n  min-height: 31px;\n  padding: 0 9px;\n  border: 0;\n  border-radius: 4px;\n  background: transparent;\n  color: inherit;\n  text-align: left;\n  font-size: 10px;\n  cursor: pointer;\n}\n\n.content-kind-group .content-image-kind:hover:not(:disabled) {\n  background: #e5e4df;\n}\n\n.content-image-input {\n  position: absolute !important;\n  width: 1px !important;\n  height: 1px !important;\n  margin: -1px !important;\n  padding: 0 !important;\n  border: 0 !important;\n  overflow: hidden !important;\n  clip: rect(0 0 0 0) !important;\n  clip-path: inset(50%) !important;\n  white-space: nowrap !important;\n}\n`);

// One place for the UI typography contract and the repaired Export control.
await write("web/src/ui-polish.css", `:root {\n  --folio-ui-display: Georgia, "Times New Roman", serif;\n}\n\n/* Product rule: every intentionally bold UI label uses the Folio wordmark face.\n * Body copy, manuscript text and book-preview typography remain untouched. */\n.start-shell :is(strong, b, h1, h2, h3, h4, h5, h6),\n.start-shell :is(.start-brand, .start-mark, .start-kicker, .recent-eyebrow, .start-modal-head p, .start-button, .recent-meta strong, .recent-path b, .start-folder-summary span, .start-field > span),\n.folio-shell :is(strong, b, h1, h2, h3, h4, h5, h6),\n.folio-shell :is(.command-wordmark, .pane-label, .book-title, .contents-heading, .topbar-title, .section-index, .section-title, .section-title-button, .section-title-input, .style-category-list button.active, .native-button.primary, .theme-name, .style-library-footer strong, .ornament-heading span) {\n  font-family: var(--folio-ui-display) !important;\n}\n\n/* Export is a primary publishing action, not a 9px faux-native afterthought. */\n.folio-shell[data-ui-tone] .generate-button {\n  height: 30px;\n  min-width: 82px;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 8px;\n  padding: 0 11px;\n  border: 1px solid var(--studio-rule-strong);\n  border-radius: 3px;\n  background: var(--studio-control);\n  color: var(--studio-ink);\n  box-shadow: none;\n  font-family: var(--folio-ui-display);\n  font-size: 11px;\n  font-weight: 700;\n  line-height: 1;\n  cursor: pointer;\n}\n\n.folio-shell[data-ui-tone] .generate-button::after {\n  content: "⌄";\n  color: var(--studio-muted);\n  font: 600 11px/1 system-ui, sans-serif;\n  transform: translateY(-1px);\n}\n\n.folio-shell[data-ui-tone] .generate-button:hover,\n.folio-shell[data-ui-tone] .generate-wrap:has(.generate-menu) .generate-button {\n  border-color: var(--studio-accent);\n  background: var(--studio-accent-soft);\n}\n\n.folio-shell[data-ui-tone] .generate-menu {\n  top: 35px;\n  width: 210px;\n  padding: 4px;\n  border: 1px solid var(--studio-rule-strong);\n  border-radius: 3px;\n  background: var(--studio-chrome);\n  box-shadow: 0 12px 28px rgba(0, 0, 0, .16);\n  backdrop-filter: none;\n}\n\n.folio-shell[data-ui-tone] .generate-menu button {\n  height: 31px;\n  border-radius: 2px;\n  color: var(--studio-ink);\n  cursor: pointer;\n}\n\n.folio-shell[data-ui-tone] .generate-menu button:hover {\n  background: var(--studio-accent-soft);\n}\n`);
await replaceExact("web/src/main.tsx", 'import "./image-page-workspace.css";\n', 'import "./image-page-workspace.css";\nimport "./ui-polish.css";\n', "UI polish import");

// Revenant is removed from the data model, picker, theme preview CSS and bundle.
await replaceExact("server/pipeline/types.ts", '  | "ironbound"\n  | "revenant";\n', '  | "ironbound";\n', "ThemeName revenant");
await replaceRegex("server/pipeline/themes.ts", /\n  revenant: \{ name: "revenant"[^\n]+\},/, "", "revenant config");
await replaceExact(
  "server/pipeline/themes.ts",
  '  "blackletter", "stanza", "witchlight", "revenant", "solstice", "literary", "nocturne",\n',
  '  "blackletter", "stanza", "witchlight", "solstice", "literary", "nocturne",\n',
  "supported revenant",
);
await replaceRegex("web/src/index.css", /\n\.theme-revenant \.sample-chapter \{[^\n]+\}\n\.theme-revenant \.sample-title \{[^\n]+\}/, "", "revenant gallery CSS");
await fs.rm(path.join(ROOT, "themes", "revenant"), { recursive: true, force: true });

// Update the regression gates to the new curated set and release number.
await replaceExact(
  "tests/ui-runtime.test.ts",
  'check("Folio 2.0 exposes only the 14 curated visual themes", themeCount === 14, String(themeCount));',
  'check("Folio 2.0 exposes only the 13 curated visual themes", themeCount === 13, String(themeCount));',
  "theme-count browser test",
);
await replaceExact(".github/workflows/windows-release.yml", "Verify Folio 2.0.1 version consistency", "Verify Folio 2.0.2 version consistency", "release step name");
await replaceExact(".github/workflows/windows-release.yml", 'if ($version -ne "2.0.1") { throw "Windows release is scoped to Folio 2.0.1, found $version." }', 'if ($version -ne "2.0.2") { throw "Windows release is scoped to Folio 2.0.2, found $version." }', "release version gate");
await replaceExact(".github/workflows/windows-release.yml", 'if ($themes.Count -ne 14) { throw "Folio 2.0 packaged app must expose exactly 14 curated themes, found $($themes.Count)." }', 'if ($themes.Count -ne 13) { throw "Folio 2.0 packaged app must expose exactly 13 curated themes, found $($themes.Count)." }', "packaged theme count");
await replaceRegex(
  ".github/workflows/windows-release.yml",
  /--notes "Folio 2\.0\.1 is a focused reliability patch:[^\n]+"/,
  '--notes "Folio 2.0.2 fixes the visible 2.0.1 regressions: Folio display typography is applied consistently to bold UI labels, Export is a proper publishing control, Full-page Image uses a reliable native-style row control, Print Preview paginates only the selected section instead of the whole manuscript, and Revenant is removed from the curated theme set. The Windows package remains gated by typecheck, formatter/UI tests, visual/typesetting QA, print-matrix QA and packaged executable smoke tests."',
  "release notes",
);

// Strengthen packaged smoke: a selected-section print preview must not silently
// render unrelated sections. The existing endpoint smoke already proves bundled
// Chromium can launch; this checks the contract that matters for real books.
await replaceExact(
  ".github/workflows/windows-release.yml",
  '            if ($printPreview.pages -lt 1 -or $printPreview.html -notmatch "pagedjs_page") { throw "Packaged print preview did not paginate." }',
  '            if ($printPreview.pages -lt 1 -or $printPreview.html -notmatch "pagedjs_page" -or $printPreview.html -notmatch "Packaged preview probe") { throw "Packaged print preview did not paginate the selected live section." }',
  "packaged print preview assertion",
);

// Fail the applicator if a product/theme reference survived. Historical release
// notes/workflows are intentionally ignored; product code must be clean.
const productRoots = ["server", "web", "themes", "templates", "tests"];
const leftovers = [];
async function walk(dir) {
  for (const entry of await fs.readdir(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(rel);
    else if (/\.(?:ts|tsx|css|json|ya?ml|md)$/i.test(entry.name)) {
      const text = await read(rel);
      if (/revenant/i.test(text)) leftovers.push(rel);
    }
  }
}
for (const dir of productRoots) await walk(dir);
if (leftovers.length) throw new Error(`Revenant references remain: ${leftovers.join(", ")}`);

console.log("Applied Folio 2.0.2 UI/print/image hotfix.");

import { useEffect, useMemo, useRef, useState } from "react";
import { api, downloadResult, formatBytes } from "./api";
import type { BookMeta, ExportResult, PrintOptions, ProjectSummary, SectionDocument, Theme, Typography } from "./types";

type PreviewMode = "kindle" | "print";
type SaveState = "idle" | "saving" | "saved" | "error";
type StyleCategory = "Book Style" | "Chapter Heading" | "First Paragraph" | "Paragraph After Break" | "Body" | "Scene Break" | "Header & Footer" | "Title Page";

const styleCategories: StyleCategory[] = [
  "Book Style", "Chapter Heading", "First Paragraph", "Paragraph After Break",
  "Body", "Scene Break", "Header & Footer", "Title Page",
];
const trims = [
  ["5x8", "5 × 8"], ["5.25x8", "5.25 × 8"], ["5.5x8.5", "5.5 × 8.5"],
  ["6x9", "6 × 9"], ["8.5x11", "8.5 × 11"],
] as const;
const defaultPrint: PrintOptions = { trim: "6x9", binding: "paperback", startChaptersRecto: true, layout: "author-title-bottom" };

function wordCount(text: string): number {
  return text.trim().match(/\S+/g)?.length ?? 0;
}

export default function App() {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [meta, setMeta] = useState<BookMeta | null>(null);
  const [typography, setTypography] = useState<Typography>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [document, setDocument] = useState<SectionDocument | null>(null);
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("kindle");
  const [printOptions, setPrintOptions] = useState<PrintOptions>(defaultPrint);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showStyle, setShowStyle] = useState(false);
  const [styleCategory, setStyleCategory] = useState<StyleCategory>("Book Style");
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [exportState, setExportState] = useState<{ busy: string | null; result: ExportResult | null; error: string | null }>({ busy: null, result: null, error: null });
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const draftRef = useRef(draft);
  const selectedRef = useRef(selectedId);
  const undoRef = useRef<string[]>([]);
  const redoRef = useRef<string[]>([]);

  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
  useEffect(() => {
    api.themes().then(setThemes).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    const bookPath = new URLSearchParams(window.location.search).get("book")?.trim();
    if (bookPath) void openFolder(bookPath);
  }, []);

  const chapters = useMemo(() => project?.sections.filter((s) => s.kind === "chapter") ?? [], [project]);
  const frontMatter = useMemo(() => project?.sections.filter((s) => s.kind !== "chapter" && s.kind !== "backmatter") ?? [], [project]);
  const backMatter = useMemo(() => project?.sections.filter((s) => s.kind === "backmatter") ?? [], [project]);
  const selectedSection = project?.sections.find((s) => s.id === selectedId) ?? null;
  const chapterIndex = selectedSection?.kind === "chapter" ? chapters.findIndex((s) => s.id === selectedSection.id) + 1 : null;
  const totalWords = useMemo(() => project ? Math.max(wordCount(draft), Math.round(project.bodyChars / 5.1)) : 0, [project, draft]);

  useEffect(() => {
    if (!project || !selectedId) return;
    let cancelled = false;
    setDocument(null);
    setSaveState("idle");
    api.section(project.projectId, selectedId).then((doc) => {
      if (cancelled) return;
      undoRef.current = []; redoRef.current = []; draftRef.current = doc.markdown;
      setDocument(doc); setDraft(doc.markdown); setDirty(false);
    }).catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => { cancelled = true; };
  }, [project?.projectId, selectedId]);

  useEffect(() => {
    if (!project || !meta || !selectedId || document?.id !== selectedId) return;
    let cancelled = false;
    setPreviewLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = previewMode === "print"
          ? await api.previewPrint(project.projectId, meta, meta.theme, printOptions, typography, selectedId, draft)
          : await api.preview(project.projectId, meta, meta.theme, typography, selectedId, draft);
        if (!cancelled) setPreviewHtml(result.html);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 240);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [project?.projectId, meta, typography, previewMode, printOptions, selectedId, document?.id, draft]);

  useEffect(() => {
    if (!dirty || !document?.editable || !project || !selectedId) return;
    setSaveState("saving");
    const projectId = project.projectId;
    const sectionId = selectedId;
    const value = draft;
    const timer = window.setTimeout(async () => {
      try {
        const saved = await api.saveSection(projectId, sectionId, value);
        if (selectedRef.current === sectionId && draftRef.current === value) {
          setDocument(saved); setDirty(false); setSaveState("saved");
          window.setTimeout(() => setSaveState((state) => state === "saved" ? "idle" : state), 1400);
        }
      } catch (e) {
        if (selectedRef.current === sectionId) {
          setSaveState("error"); setError(e instanceof Error ? e.message : String(e));
        }
      }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, document?.editable, project?.projectId, selectedId]);

  function adopt(summary: ProjectSummary) {
    setProject(summary); setMeta(summary.meta); setTypography(summary.typography ?? {});
    const first = summary.sections.find((s) => s.kind === "chapter") ?? summary.sections[0] ?? null;
    setSelectedId(first?.id ?? null); setError(null);
  }

  async function openFolder(folderPath?: string) {
    setBusy(true); setError(null);
    try {
      const selected = folderPath ?? (await api.pickFolder(project?.folder ?? undefined)).path;
      if (selected) adopt(await api.openFolder(selected));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function loadSample() {
    setBusy(true); setError(null);
    try { adopt(await api.loadSample()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function saveCurrent(): Promise<boolean> {
    if (!dirty || !document?.editable || !project || !selectedId) return true;
    const sectionId = selectedId;
    const value = draft;
    setSaveState("saving");
    try {
      const saved = await api.saveSection(project.projectId, sectionId, value);
      if (selectedRef.current === sectionId && draftRef.current === value) {
        setDocument(saved); setDirty(false); setSaveState("saved");
      }
      return true;
    } catch (e) {
      setSaveState("error"); setError(e instanceof Error ? e.message : String(e)); return false;
    }
  }

  async function selectSection(nextId: string) {
    if (nextId === selectedId) return;
    if (await saveCurrent()) setSelectedId(nextId);
  }

  function onPreviewLoad() {
    const frame = previewRef.current;
    const doc = frame?.contentDocument;
    if (!doc || !frame) return;
    const style = doc.createElement("style");
    if (previewMode === "print") {
      const page = doc.querySelector(".pagedjs_page") as HTMLElement | null;
      const width = page?.getBoundingClientRect().width || 576;
      const scale = Math.min(1, (frame.clientWidth - 14) / width);
      style.textContent = `.pagedjs_pages{transform:scale(${scale});transform-origin:top center;width:${100 / scale}%!important;margin-left:${(100 - 100 / scale) / 2}%!important}.pagedjs_page{margin:10px auto!important}`;
    } else {
      style.textContent = "html,body{min-height:100%!important}body{margin:0!important;padding:0!important}main.book{max-width:none!important;margin:0!important;padding:48px 42px 70px!important;box-sizing:border-box!important}section.level1{display:block!important;margin:0!important;border:0!important;padding:0!important;break-before:auto!important;page-break-before:auto!important}section.chapter>h1,h1.chapter{margin-top:12px!important}";
    }
    doc.head.appendChild(style);
    doc.scrollingElement?.scrollTo(0, 0);
  }

  function replaceSelection(before: string, after = "", placeholder = "") {
    const el = editorRef.current;
    if (!el || !document?.editable) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const current = draftRef.current;
    const selected = current.slice(start, end) || placeholder;
    recordDraft(current.slice(0, start) + before + selected + after + current.slice(end));
    requestAnimationFrame(() => { el.focus(); const at = start + before.length; el.setSelectionRange(at, at + selected.length); });
  }

  function recordDraft(next: string) {
    const current = draftRef.current;
    if (next === current) return;
    undoRef.current.push(current);
    if (undoRef.current.length > 200) undoRef.current.shift();
    redoRef.current = [];
    draftRef.current = next;
    setDraft(next); setDirty(true);
  }

  function history(command: "undo" | "redo") {
    const el = editorRef.current;
    const from = command === "undo" ? undoRef.current : redoRef.current;
    const to = command === "undo" ? redoRef.current : undoRef.current;
    const next = from.pop();
    if (next === undefined) return;
    const caret = el?.selectionStart ?? next.length;
    to.push(draftRef.current);
    draftRef.current = next;
    setDraft(next); setDirty(true);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(Math.min(caret, next.length), Math.min(caret, next.length)); });
  }

  function findNext() {
    const el = editorRef.current;
    if (!el || !searchQuery) return;
    const lower = draft.toLocaleLowerCase();
    let at = lower.indexOf(searchQuery.toLocaleLowerCase(), Math.max(el.selectionEnd, 0));
    if (at < 0) at = lower.indexOf(searchQuery.toLocaleLowerCase());
    if (at >= 0) { el.focus(); el.setSelectionRange(at, at + searchQuery.length); }
  }

  function editorKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === "z" || key === "y") {
      event.preventDefault();
      history(key === "y" || event.shiftKey ? "redo" : "undo");
    } else if (key === "b" || key === "i" || key === "u") {
      event.preventDefault();
      if (key === "b") replaceSelection("**", "**", "bold text");
      if (key === "i") replaceSelection("*", "*", "italic text");
      if (key === "u") replaceSelection("<u>", "</u>", "underlined text");
    } else if (key === "f") { event.preventDefault(); setShowSearch(true); }
    else if (key === "s") { event.preventDefault(); void saveCurrent(); }
  }

  async function saveAppearance() {
    if (!project || !meta) return;
    setSaveState("saving");
    try {
      const withMeta = await api.saveMeta(project.projectId, meta);
      const saved = await api.saveTypography(project.projectId, withMeta.meta, typography);
      setProject(saved); setMeta(saved.meta); setTypography(saved.typography ?? {});
      setSaveState("saved"); setShowStyle(false);
    } catch (e) { setSaveState("error"); setError(e instanceof Error ? e.message : String(e)); }
  }

  async function runExport(label: string, format: string, preset?: string, force = false): Promise<void> {
    if (!project || !meta || !(await saveCurrent())) return;
    setExportState({ busy: label, result: null, error: null });
    try {
      const result = await api.export(project.projectId, format, { preset, meta, theme: meta.theme, typography, print: format === "print" ? printOptions : undefined, force });
      if (result.needsConfirm) {
        if (window.confirm(`${result.message ?? "This export already exists."}\n\nReplace it?`)) return runExport(label, format, preset, true);
        setExportState({ busy: null, result: null, error: null }); return;
      }
      if (!result.written) downloadResult(result);
      setExportState({ busy: null, result, error: null });
    } catch (e) { setExportState({ busy: null, result: null, error: e instanceof Error ? e.message : String(e) }); }
  }

  if (!project || !meta) return (
    <div className="folio-shell folio-empty-shell">
      <div className="folio-windowbar empty-windowbar"><TrafficLights/><div className="windowbar-spacer"/><div className="folio-wordmark">Folio</div><div className="windowbar-spacer"/></div>
      <main className="empty-state"><div className="empty-book-mark">F</div><h1>Folio</h1><p>Beautiful books, without the formatting fight.</p><div className="empty-actions"><button className="native-button primary" disabled={busy} onClick={() => void openFolder()}>{busy ? "Opening…" : "Open Book Folder…"}</button><button className="native-button" disabled={busy} onClick={() => void loadSample()}>Open Sample</button></div>{error && <div className="empty-error">{error}</div>}</main>
    </div>
  );

  return (
    <div className="folio-shell">
      <aside className="library-pane">
        <div className="library-toolbar"><TrafficLights/><div className="library-toolbar-actions"><button className="icon-button" title="Contents">☷</button><button className="icon-button infinity" title="Book styles" onClick={() => setShowStyle(true)}>∞</button></div></div>
        <div className="book-identity"><div className="book-title">{meta.title}</div><div className="book-author">{meta.author}</div></div>
        <nav className="contents-list" aria-label="Book contents">
          {frontMatter.map((section) => <button key={section.id} className={`contents-row ${selectedId === section.id ? "selected" : ""}`} onClick={() => void selectSection(section.id)}><span>{section.title}</span></button>)}
          <div className="contents-heading">Contents</div>
          {chapters.map((section, index) => <button key={section.id} className={`contents-row chapter-row ${selectedId === section.id ? "selected" : ""}`} onClick={() => void selectSection(section.id)} title={section.title}><span className="chapter-number">{index + 1}.</span><span className="chapter-label">{section.title}</span></button>)}
          {backMatter.length > 0 && <div className="contents-heading back-heading">Back Matter</div>}
          {backMatter.map((section) => <button key={section.id} className={`contents-row ${selectedId === section.id ? "selected" : ""}`} onClick={() => void selectSection(section.id)}><span>{section.title}</span></button>)}
        </nav>
        <div className="library-footer"><button className="tiny-footer-button" title="Open another book" onClick={() => void openFolder()}>＋</button><button className="tiny-footer-button" title="Reload" onClick={() => void api.reload(project.projectId).then(adopt)}>↻</button><div className="library-footer-spacer"/><button className="tiny-footer-button" title="Book styles" onClick={() => setShowStyle(true)}>⚙</button></div>
      </aside>

      <section className="editor-pane">
        <div className="editor-topbar"><div className="topbar-title">{meta.title}</div><div className="editor-topbar-right"><span className={`save-indicator ${saveState}`}>{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : ""}</span><span className="word-count">{totalWords.toLocaleString()} Words</span></div></div>
        <div className="section-titlebar"><div className="section-title-wrap">{chapterIndex ? <span className="section-index">{chapterIndex}.</span> : null}<span className="section-title">{selectedSection?.title ?? document?.title ?? ""}</span></div><button className="section-gear" title="Style settings" onClick={() => setShowStyle(true)}>⚙⌄</button></div>
        <div className="format-toolbar">
          <div className="toolbar-group history-tools"><button onMouseDown={(e) => e.preventDefault()} onClick={() => history("undo")} title="Undo (Ctrl+Z)">↶</button><button onMouseDown={(e) => e.preventDefault()} onClick={() => history("redo")} title="Redo (Ctrl+Y)">↷</button></div>
          <div className="toolbar-group"><button onMouseDown={(e) => e.preventDefault()} onClick={() => replaceSelection("**", "**", "bold text")} title="Bold (Ctrl+B)"><strong>B</strong></button><button onMouseDown={(e) => e.preventDefault()} onClick={() => replaceSelection("*", "*", "italic text")} title="Italic (Ctrl+I)"><em>I</em></button><button onMouseDown={(e) => e.preventDefault()} onClick={() => replaceSelection("<u>", "</u>", "underlined text")} title="Underline (Ctrl+U)"><u>U</u></button><button onMouseDown={(e) => e.preventDefault()} onClick={() => replaceSelection("\n\n---\n\n")} title="Scene break">❦</button></div>
          <div className="toolbar-spacer"/>
          {showSearch ? <div className="editor-search"><input autoFocus value={searchQuery} placeholder="Find" onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") findNext(); if (e.key === "Escape") setShowSearch(false); }}/><button onClick={findNext}>Next</button><button onClick={() => setShowSearch(false)}>×</button></div> : <button className="search-pill" title="Find (Ctrl+F)" onClick={() => setShowSearch(true)}>⌕</button>}
        </div>
        <div className="editor-paper">{document ? <textarea ref={editorRef} className="manuscript-editor" value={draft} readOnly={!document.editable} spellCheck onKeyDown={editorKeyDown} onChange={(event) => recordDraft(event.target.value)} aria-label={`Edit ${document.title}`}/> : <div className="editor-loading">Loading section…</div>}{document && !document.editable && <div className="readonly-note">This generated section is controlled by Book Details.</div>}</div>
      </section>

      <section className="preview-pane">
        <div className="preview-topbar"><div className="generate-wrap"><button className="generate-button" onClick={() => setShowGenerate((v) => !v)}>Generate</button>{showGenerate && <div className="generate-menu"><button onClick={() => void runExport("EPUB · Kindle", "epub", "kdp")}>EPUB · Kindle</button><button onClick={() => void runExport("EPUB · Universal", "epub", "universal")}>EPUB · Universal</button><button onClick={() => void runExport("Print PDF", "print")}>Print PDF</button><button onClick={() => void runExport("Reading PDF", "pdf")}>Reading PDF</button><button onClick={() => void runExport("Word", "docx")}>Word (.docx)</button><div className="generate-status">{exportState.busy && `Generating ${exportState.busy}…`}{exportState.error && <span className="error-text">{exportState.error}</span>}{exportState.result && <span>✓ {exportState.result.filename ?? "Done"} · {formatBytes(exportState.result.bytes)}</span>}</div></div>}</div><button className="topbar-icon" title="Book preview">♧</button><button className="topbar-icon" title="Pages">▯</button></div>
        <div className="device-toolbar"><button className="device-small-button" title="Preview device">▣</button><button className="device-small-button aa-button" onClick={() => setShowStyle(true)}>Aa</button><div className="device-label"><select value={previewMode} onChange={(e) => setPreviewMode(e.target.value as PreviewMode)}><option value="kindle">Kindle · Paperwhite</option><option value="print">Print · Pages</option></select>{previewMode === "print" && <select className="trim-select" value={printOptions.trim} onChange={(e) => setPrintOptions({ ...printOptions, trim: e.target.value })}>{trims.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}</div><div className="device-nav"><button disabled>‹</button><button title="Current section">☰</button><button disabled>›</button></div></div>
        <div className="preview-stage"><div className={`reader-device ${previewMode === "print" ? "print-device" : ""}`}><div className="reader-screen">{previewLoading && <div className="preview-loading">Rendering…</div>}<iframe ref={previewRef} className="preview-frame" title="Book preview" srcDoc={previewHtml} onLoad={onPreviewLoad}/></div></div></div>
      </section>

      {showStyle && (
        <StyleLibrary themes={themes} meta={meta} setMeta={setMeta} typography={typography} setTypography={setTypography} category={styleCategory} setCategory={setStyleCategory} printOptions={printOptions} setPrintOptions={setPrintOptions} onClose={() => setShowStyle(false)} onSave={() => void saveAppearance()}/>
      )}
      {error && <button className="global-error" onClick={() => setError(null)} title="Dismiss">{error}</button>}
    </div>
  );
}

function StyleLibrary(props: {
  themes: Theme[]; meta: BookMeta; setMeta: (meta: BookMeta) => void;
  typography: Typography; setTypography: (ty: Typography) => void;
  category: StyleCategory; setCategory: (category: StyleCategory) => void;
  printOptions: PrintOptions; setPrintOptions: (options: PrintOptions) => void;
  onClose: () => void; onSave: () => void;
}) {
  const { themes, meta, setMeta, typography, setTypography, category, setCategory, printOptions, setPrintOptions } = props;
  const selected = themes.find((theme) => theme.name === meta.theme);
  return <div className="style-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
    <section className="style-library" role="dialog" aria-modal="true" aria-label="Book style library">
      <header className="style-library-header"><div><h2>Book Styles</h2><p>Choose by appearance. The preview changes immediately.</p></div><button onClick={props.onClose} aria-label="Close">×</button></header>
      <div className="style-library-body">
        <nav className="style-category-list">{styleCategories.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</nav>
        <div className="style-content">{category === "Book Style" ? <div className="theme-gallery">{themes.map((theme) => <button key={theme.name} className={`theme-sample ${meta.theme === theme.name ? "selected" : ""}`} style={{ background: theme.previewPaper, color: theme.previewAccent, fontFamily: theme.previewFont }} onClick={() => setMeta({ ...meta, theme: theme.name })}><span className="theme-name">{theme.label}</span><span className="sample-chapter" style={{ fontFamily: theme.previewHeadingFont }}>{theme.chapterLabel}</span><span className="sample-title" style={{ fontFamily: theme.previewHeadingFont }}>The Visitor</span><span className="sample-ornament">{theme.sceneOrnament}</span><span className="sample-copy">The room had fallen quiet before anyone noticed the letter beneath the door.</span></button>)}</div> : <CustomizePanel category={category} typography={typography} setTypography={setTypography} printOptions={printOptions} setPrintOptions={setPrintOptions} themeDropcap={selected?.dropcap ?? false}/>}</div>
      </div>
      <footer className="style-library-footer"><div><strong>{selected?.label ?? meta.theme}</strong><span>{selected?.description}</span></div><button className="native-button" onClick={props.onClose}>Done</button><button className="native-button primary" onClick={props.onSave}>Save to Book</button></footer>
    </section>
  </div>;
}

function CustomizePanel(props: { category: StyleCategory; typography: Typography; setTypography: (ty: Typography) => void; printOptions: PrintOptions; setPrintOptions: (opts: PrintOptions) => void; themeDropcap: boolean }) {
  const { category, typography: ty, setTypography: setTy, printOptions, setPrintOptions } = props;
  const row = (label: string, control: React.ReactNode) => <label className="customize-row"><span>{label}</span>{control}</label>;
  const fonts = <><option value="">Theme default</option><option value="Georgia, serif">Georgia</option><option value="Garamond, Georgia, serif">Garamond</option><option value="Baskerville, Georgia, serif">Baskerville</option><option value="Palatino, Georgia, serif">Palatino</option><option value="Cambria, Georgia, serif">Cambria</option><option value="Segoe UI, Arial, sans-serif">Segoe UI</option></>;
  return <div className="customize-panel"><h3>{category}</h3><p>Theme defaults already form a complete design. Override only what the book needs.</p>
    {category === "Body" && <>{row("Typeface", <select value={ty.bodyFont ?? ""} onChange={(e) => setTy({ ...ty, bodyFont: e.target.value || undefined })}>{fonts}</select>)}{row("Size", <select value={ty.fontSize ?? "1em"} onChange={(e) => setTy({ ...ty, fontSize: e.target.value })}><option value="0.92em">Small</option><option value="1em">Standard</option><option value="1.08em">Large</option><option value="1.16em">Extra large</option></select>)}{row("Line spacing", <input type="range" min="1.3" max="1.8" step="0.05" value={Number(ty.lineHeight ?? 1.5)} onChange={(e) => setTy({ ...ty, lineHeight: Number(e.target.value) })}/>)}{row("Alignment", <select value={ty.bodyAlign ?? "justify"} onChange={(e) => setTy({ ...ty, bodyAlign: e.target.value as "left" | "justify" })}><option value="justify">Justified</option><option value="left">Ragged right</option></select>)}{row("Paragraph spacing", <select value={ty.paragraphSpacing ?? ""} onChange={(e) => setTy({ ...ty, paragraphSpacing: e.target.value || undefined })}><option value="">Theme default</option><option value="0">None</option><option value="0.5em">Compact</option><option value="1em">Open</option></select>)}</>}
    {category === "Chapter Heading" && <>{row("Typeface", <select value={ty.headingFont ?? ""} onChange={(e) => setTy({ ...ty, headingFont: e.target.value || undefined })}>{fonts}</select>)}{row("Size", <select value={ty.chapterTitle?.size ?? ""} onChange={(e) => setTy({ ...ty, chapterTitle: { ...ty.chapterTitle, size: e.target.value || undefined } })}><option value="">Theme default</option><option value="1.4em">Compact</option><option value="1.8em">Standard</option><option value="2.2em">Large</option></select>)}{row("Alignment", <select value={ty.chapterTitle?.align ?? ""} onChange={(e) => setTy({ ...ty, chapterTitle: { ...ty.chapterTitle, align: (e.target.value || undefined) as "left" | "center" | "right" | undefined } })}><option value="">Theme default</option><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select>)}{row("Letter case", <select value={ty.chapterTitle?.case ?? ""} onChange={(e) => setTy({ ...ty, chapterTitle: { ...ty.chapterTitle, case: (e.target.value || undefined) as "normal" | "smallcaps" | "uppercase" | undefined } })}><option value="">Theme default</option><option value="normal">Normal</option><option value="smallcaps">Small caps</option><option value="uppercase">Uppercase</option></select>)}{row("Style", <select value={ty.chapterTitle?.style ?? ""} onChange={(e) => setTy({ ...ty, chapterTitle: { ...ty.chapterTitle, style: (e.target.value || undefined) as "normal" | "italic" | undefined } })}><option value="">Theme default</option><option value="normal">Roman</option><option value="italic">Italic</option></select>)}</>}
    {category === "First Paragraph" && row("Drop cap", <input type="checkbox" checked={ty.dropcap ?? props.themeDropcap} onChange={(e) => setTy({ ...ty, dropcap: e.target.checked })}/>)}
    {category === "Paragraph After Break" && row("First-line indent", <select value={ty.paragraphAfterBreakIndent ?? "0"} onChange={(e) => setTy({ ...ty, paragraphAfterBreakIndent: e.target.value })}><option value="0">Flush</option><option value="1em">Compact</option><option value="1.25em">Standard</option><option value="1.6em">Deep</option></select>)}
    {category === "Scene Break" && row("Ornament", <input value={ty.sceneOrnament ?? ""} placeholder="Theme default" onChange={(e) => setTy({ ...ty, sceneOrnament: e.target.value || undefined })}/>)}
    {category === "Header & Footer" && <>{row("Running heads", <select value={printOptions.layout} onChange={(e) => setPrintOptions({ ...printOptions, layout: e.target.value })}><option value="author-title-bottom">Author / title · folio bottom</option><option value="author-title-top">Author / title · folio top</option><option value="title-chapter-bottom">Title / chapter · folio bottom</option><option value="title-chapter-top">Title / chapter · folio top</option><option value="folio-bottom">Page number only · bottom</option></select>)}{row("Recto chapter starts", <input type="checkbox" checked={printOptions.startChaptersRecto} onChange={(e) => setPrintOptions({ ...printOptions, startChaptersRecto: e.target.checked })}/>)}</>}
    {category === "Title Page" && row("Title typeface", <select value={ty.titlePageFont ?? ""} onChange={(e) => setTy({ ...ty, titlePageFont: e.target.value || undefined })}>{fonts}</select>)}
  </div>;
}

function TrafficLights() { return <div className="traffic-lights" aria-hidden="true"><span className="traffic red"/><span className="traffic yellow"/><span className="traffic green"/></div>; }

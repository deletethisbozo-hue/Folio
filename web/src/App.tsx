import { useEffect, useMemo, useRef, useState } from "react";
import { api, downloadResult, formatBytes } from "./api";
import type { BookMeta, ExportResult, MatterType, PrintOptions, ProjectSummary, SectionDocument, Theme, Typography } from "./types";

type PreviewMode = "kindle-paperwhite" | "kindle-oasis" | "ipad" | "iphone" | "android" | "print";
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
const previewProfiles: Array<{ value: PreviewMode; label: string }> = [
  { value: "kindle-paperwhite", label: "Kindle · Paperwhite" },
  { value: "kindle-oasis", label: "Kindle · Oasis" },
  { value: "ipad", label: "Apple · iPad" },
  { value: "iphone", label: "Apple · iPhone" },
  { value: "android", label: "Android · Phone" },
  { value: "print", label: "Print · Pages" },
];

function wordCount(text: string): number {
  return text.trim().match(/\S+/g)?.length ?? 0;
}

export default function App() {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [matterTypes, setMatterTypes] = useState<MatterType[]>([]);
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
  const [previewMode, setPreviewMode] = useState<PreviewMode>("kindle-paperwhite");
  const [printOptions, setPrintOptions] = useState<PrintOptions>(defaultPrint);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showStyle, setShowStyle] = useState(false);
  const [showContent, setShowContent] = useState(false);
  const [showBookDetails, setShowBookDetails] = useState(false);
  const [showNewBook, setShowNewBook] = useState(false);
  const [newBookForm, setNewBookForm] = useState({ path: "", title: "", author: "" });
  const [contentTitle, setContentTitle] = useState("New Chapter");
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
    Promise.all([api.themes(), api.matterTypes()])
      .then(([loadedThemes, loadedMatter]) => { setThemes(loadedThemes); setMatterTypes(loadedMatter); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
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

  function adopt(summary: ProjectSummary, preferredId?: string) {
    setProject(summary); setMeta(summary.meta); setTypography(summary.typography ?? {});
    const preferred = preferredId ? summary.sections.find((s) => s.id === preferredId) : null;
    const first = preferred ?? summary.sections.find((s) => s.kind === "chapter") ?? summary.sections[0] ?? null;
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

  async function beginNewBook() {
    setBusy(true); setError(null);
    try {
      const selected = (await api.pickFolder()).path;
      if (!selected) return;
      const guessed = selected.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "Untitled";
      setNewBookForm({ path: selected, title: guessed, author: "" });
      setShowNewBook(true);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function createNewBook() {
    if (!newBookForm.path.trim()) return;
    setBusy(true); setError(null);
    try {
      adopt(await api.newBook(newBookForm.path, newBookForm.title, newBookForm.author));
      setShowNewBook(false);
      setShowBookDetails(true);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function addChapter() {
    if (!project || !meta) return;
    setBusy(true); setError(null);
    try {
      const before = new Set(project.sections.map((section) => section.id));
      const summary = await api.addChapter(project.projectId, contentTitle, meta);
      const created = summary.sections.find((section) => !before.has(section.id) && section.kind === "chapter");
      adopt(summary, created?.id);
      setContentTitle("New Chapter");
      setShowContent(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function addMatterSection(type: MatterType) {
    if (!project || !meta) return;
    setBusy(true); setError(null);
    try {
      const before = new Set(project.sections.map((section) => section.id));
      const summary = await api.addMatter(project.projectId, type.key, type.placement, meta);
      const created = summary.sections.find((section) => !before.has(section.id));
      adopt(summary, created?.id);
      setShowContent(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function saveBookDetails() {
    if (!project || !meta) return;
    setSaveState("saving");
    try {
      const summary = await api.saveMeta(project.projectId, meta);
      adopt(summary, selectedId ?? undefined);
      setShowBookDetails(false);
      setSaveState("saved");
    } catch (e) { setSaveState("error"); setError(e instanceof Error ? e.message : String(e)); }
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

  const selectedPosition = project?.sections.findIndex((section) => section.id === selectedId) ?? -1;
  const previousSection = selectedPosition > 0 ? project?.sections[selectedPosition - 1] : null;
  const nextSection = project && selectedPosition >= 0 && selectedPosition < project.sections.length - 1
    ? project.sections[selectedPosition + 1]
    : null;

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
      const profileCss: Record<Exclude<PreviewMode, "print">, string> = {
        "kindle-paperwhite": "body{font-size:13px!important}main.book{padding:42px 32px 64px!important}",
        "kindle-oasis": "body{font-size:13.5px!important}main.book{padding:40px 38px 64px!important}",
        ipad: "body{font-size:14px!important}main.book{padding:56px 52px 76px!important}",
        iphone: "body{font-size:12.5px!important;text-align:left!important;hyphens:none!important}p,li{text-align-last:left!important}main.book{padding:36px 24px 58px!important}",
        android: "body{font-size:12.5px!important;text-align:left!important;hyphens:none!important}p,li{text-align-last:left!important}main.book{padding:34px 22px 56px!important}",
      };
      style.textContent = "html,body{min-height:100%!important}body{margin:0!important;padding:0!important}main.book{max-width:none!important;margin:0!important;box-sizing:border-box!important}section.level1{display:block!important;margin:0!important;border:0!important;padding:0!important;break-before:auto!important;page-break-before:auto!important}section.chapter>h1,h1.chapter{margin-top:12px!important}" + profileCss[previewMode];
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

  function insertSceneBreak() {
    const el = editorRef.current;
    if (!el || !document?.editable) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const current = draftRef.current;
    const left = current.slice(0, start).replace(/[ \t]*\n*$/, "");
    const right = current.slice(end).replace(/^\n*[ \t]*/, "");
    const next = (left ? left + "\n\n" : "") + "---" + (right ? "\n\n" + right : "\n\n");
    const caret = (left ? left.length + 2 : 0) + 3 + 2;
    recordDraft(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(caret, caret); });
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
      <div className="folio-windowbar empty-windowbar"><div className="windowbar-spacer"/><div className="folio-wordmark">Folio</div><div className="windowbar-spacer"/></div>
      <main className="empty-state"><div className="empty-book-mark">F</div><h1>Folio</h1><p>Beautiful books, without the formatting fight.</p><div className="empty-actions"><button className="native-button primary" disabled={busy} onClick={() => void beginNewBook()}>{busy ? "Opening…" : "New Book…"}</button><button className="native-button" disabled={busy} onClick={() => void openFolder()}>Open Book…</button><button className="native-button" disabled={busy} onClick={() => void loadSample()}>Open Sample</button></div>{error && <div className="empty-error">{error}</div>}</main>
      {showNewBook && <NewBookDialog value={newBookForm} setValue={setNewBookForm} busy={busy} onCancel={() => setShowNewBook(false)} onCreate={() => void createNewBook()}/>}
    </div>
  );

  return (
    <div className="folio-shell">
      <aside className="library-pane">
        <div className="library-toolbar"><span className="pane-label">Folio</span><div className="library-toolbar-actions"><button className="toolbar-text-button" title="Add content" onClick={() => setShowContent(true)}>＋ Add</button><button className="icon-button infinity" title="Book styles" onClick={() => setShowStyle(true)}>∞</button></div></div>
        <button className="book-identity" title="Edit book details" onClick={() => setShowBookDetails(true)}><div className="book-title">{meta.title}</div><div className="book-author">{meta.author}</div></button>
        <nav className="contents-list" aria-label="Book contents">
          {frontMatter.map((section) => <button key={section.id} className={`contents-row ${selectedId === section.id ? "selected" : ""}`} onClick={() => void selectSection(section.id)}><span>{section.title}</span></button>)}
          <div className="contents-heading">Contents</div>
          {chapters.map((section, index) => <button key={section.id} className={`contents-row chapter-row ${selectedId === section.id ? "selected" : ""}`} onClick={() => void selectSection(section.id)} title={section.title}><span className="chapter-number">{index + 1}.</span><span className="chapter-label">{section.title}</span></button>)}
          {backMatter.length > 0 && <div className="contents-heading back-heading">Back Matter</div>}
          {backMatter.map((section) => <button key={section.id} className={`contents-row ${selectedId === section.id ? "selected" : ""}`} onClick={() => void selectSection(section.id)}><span>{section.title}</span></button>)}
        </nav>
        <div className="library-footer"><button className="tiny-footer-button footer-add" title="Add chapter or book matter" onClick={() => setShowContent(true)}>＋</button><button className="tiny-footer-button" title="Open another book" onClick={() => void openFolder()}>⌁</button><button className="tiny-footer-button" title="Reload files" onClick={() => void api.reload(project.projectId).then((summary) => adopt(summary, selectedId ?? undefined))}>↻</button><div className="library-footer-spacer"/><button className="tiny-footer-button" title="Book details" onClick={() => setShowBookDetails(true)}>i</button></div>
      </aside>

      <section className="editor-pane">
        <div className="editor-topbar"><div className="topbar-title">{meta.title}</div><div className="editor-topbar-right"><span className={`save-indicator ${saveState}`}>{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : ""}</span><span className="word-count">{totalWords.toLocaleString()} Words</span></div></div>
        <div className="section-titlebar"><div className="section-title-wrap">{chapterIndex ? <span className="section-index">{chapterIndex}.</span> : null}<span className="section-title">{selectedSection?.title ?? document?.title ?? ""}</span></div><button className="section-gear" title="Style settings" onClick={() => setShowStyle(true)}>⚙⌄</button></div>
        <div className="format-toolbar">
          <div className="toolbar-group history-tools"><button onMouseDown={(e) => e.preventDefault()} onClick={() => history("undo")} title="Undo (Ctrl+Z)">↶</button><button onMouseDown={(e) => e.preventDefault()} onClick={() => history("redo")} title="Redo (Ctrl+Y)">↷</button></div>
          <div className="toolbar-group"><button disabled={!document?.editable} onMouseDown={(e) => e.preventDefault()} onClick={() => replaceSelection("**", "**", "bold text")} title="Bold (Ctrl+B)"><strong>B</strong></button><button disabled={!document?.editable} onMouseDown={(e) => e.preventDefault()} onClick={() => replaceSelection("*", "*", "italic text")} title="Italic (Ctrl+I)"><em>I</em></button><button disabled={!document?.editable} onMouseDown={(e) => e.preventDefault()} onClick={() => replaceSelection("<u>", "</u>", "underlined text")} title="Underline (Ctrl+U)"><u>U</u></button><button className="scene-break-button" disabled={!document?.editable} onMouseDown={(e) => e.preventDefault()} onClick={insertSceneBreak} title="Insert ornamental scene break">❦ <span>Break</span></button></div>
          <div className="toolbar-spacer"/>
          {showSearch ? <div className="editor-search"><input autoFocus value={searchQuery} placeholder="Find" onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") findNext(); if (e.key === "Escape") setShowSearch(false); }}/><button onClick={findNext}>Next</button><button onClick={() => setShowSearch(false)}>×</button></div> : <button className="search-pill" title="Find (Ctrl+F)" onClick={() => setShowSearch(true)}>⌕</button>}
        </div>
        <div className="editor-paper">{selectedId ? (document ? <textarea ref={editorRef} className="manuscript-editor" value={draft} readOnly={!document.editable} spellCheck placeholder="Start writing…" onKeyDown={editorKeyDown} onChange={(event) => recordDraft(event.target.value)} aria-label={"Edit " + document.title}/> : <div className="editor-loading">Loading section…</div>) : <div className="empty-project-editor"><strong>This book has no chapters.</strong><span>Add the first chapter to start writing.</span><button className="native-button primary" onClick={() => setShowContent(true)}>Add Chapter</button></div>}{document && !document.editable && <div className="readonly-note">This page is generated from Book Details. <button onClick={() => setShowBookDetails(true)}>Edit Book Details</button></div>}</div>
      </section>

      <section className="preview-pane">
        <div className="preview-topbar"><button className="preview-style-button" onClick={() => setShowStyle(true)}>Aa · Styles</button><div className="generate-wrap"><button className="generate-button" onClick={() => setShowGenerate((v) => !v)}>Generate</button>{showGenerate && <div className="generate-menu"><button onClick={() => void runExport("EPUB · Kindle", "epub", "kdp")}>EPUB · Kindle</button><button onClick={() => void runExport("EPUB · Universal", "epub", "universal")}>EPUB · Universal</button><button onClick={() => void runExport("Print PDF", "print")}>Print PDF</button><button onClick={() => void runExport("Reading PDF", "pdf")}>Reading PDF</button><button onClick={() => void runExport("Word", "docx")}>Word (.docx)</button><div className="generate-status">{exportState.busy && "Generating " + exportState.busy + "…"}{exportState.error && <span className="error-text">{exportState.error}</span>}{exportState.result && <span>✓ {exportState.result.filename ?? "Done"} · {formatBytes(exportState.result.bytes)}</span>}</div></div>}</div></div>
        <div className="device-toolbar"><div className="device-label"><select aria-label="Preview device" value={previewMode} onChange={(e) => setPreviewMode(e.target.value as PreviewMode)}>{previewProfiles.map((profile) => <option key={profile.value} value={profile.value}>{profile.label}</option>)}</select>{previewMode === "print" && <select className="trim-select" aria-label="Print trim" value={printOptions.trim} onChange={(e) => setPrintOptions({ ...printOptions, trim: e.target.value })}>{trims.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}</div><div className="device-nav"><button disabled={!previousSection} title="Previous section" onClick={() => previousSection && void selectSection(previousSection.id)}>‹</button><span>{selectedPosition >= 0 ? selectedPosition + 1 : 0} / {project.sections.length}</span><button disabled={!nextSection} title="Next section" onClick={() => nextSection && void selectSection(nextSection.id)}>›</button></div></div>
        <div className="preview-stage"><div className={"reader-device device-" + previewMode}><div className="reader-screen">{previewLoading && <div className="preview-loading">Rendering…</div>}{selectedId ? <iframe ref={previewRef} className="preview-frame" title="Book preview" srcDoc={previewHtml} onLoad={onPreviewLoad}/> : <div className="preview-empty">Add a chapter to see its live preview.</div>}</div></div></div>
      </section>

      {showStyle && (
        <StyleLibrary themes={themes} meta={meta} setMeta={setMeta} typography={typography} setTypography={setTypography} category={styleCategory} setCategory={setStyleCategory} printOptions={printOptions} setPrintOptions={setPrintOptions} onClose={() => setShowStyle(false)} onSave={() => void saveAppearance()}/>
      )}
      {showContent && <ContentDialog matterTypes={matterTypes} title={contentTitle} setTitle={setContentTitle} busy={busy} onAddChapter={() => void addChapter()} onAddMatter={(type) => void addMatterSection(type)} onClose={() => setShowContent(false)}/>}
      {showBookDetails && <BookDetailsDialog meta={meta} setMeta={setMeta} busy={busy} onClose={() => setShowBookDetails(false)} onSave={() => void saveBookDetails()}/>}
      {error && <button className="global-error" onClick={() => setError(null)} title="Dismiss">{error}</button>}
    </div>
  );
}

function DialogShell(props: { title: string; children: React.ReactNode; footer: React.ReactNode; onClose: () => void }) {
  return <div className="dialog-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}><section className="folio-dialog" role="dialog" aria-modal="true" aria-label={props.title}><header><h2>{props.title}</h2><button onClick={props.onClose} aria-label="Close">×</button></header><div className="dialog-body">{props.children}</div><footer>{props.footer}</footer></section></div>;
}

function NewBookDialog(props: { value: { path: string; title: string; author: string }; setValue: (value: { path: string; title: string; author: string }) => void; busy: boolean; onCancel: () => void; onCreate: () => void }) {
  const { value, setValue } = props;
  return <DialogShell title="New Book" onClose={props.onCancel} footer={<><button className="native-button" onClick={props.onCancel}>Cancel</button><button className="native-button primary" disabled={props.busy || !value.title.trim()} onClick={props.onCreate}>Create Book</button></>}><label className="dialog-field"><span>Title</span><input autoFocus value={value.title} onChange={(e) => setValue({ ...value, title: e.target.value })}/></label><label className="dialog-field"><span>Author</span><input value={value.author} placeholder="Author name" onChange={(e) => setValue({ ...value, author: e.target.value })}/></label><label className="dialog-field"><span>Folder</span><input value={value.path} readOnly/></label></DialogShell>;
}

function BookDetailsDialog(props: { meta: BookMeta; setMeta: (meta: BookMeta) => void; busy: boolean; onClose: () => void; onSave: () => void }) {
  const { meta, setMeta } = props;
  const field = (label: string, key: keyof BookMeta, multiline = false) => <label className="dialog-field"><span>{label}</span>{multiline ? <textarea value={String(meta[key] ?? "")} onChange={(e) => setMeta({ ...meta, [key]: e.target.value })}/> : <input value={String(meta[key] ?? "")} onChange={(e) => setMeta({ ...meta, [key]: e.target.value })}/>}</label>;
  return <DialogShell title="Book Details" onClose={props.onClose} footer={<><button className="native-button" onClick={props.onClose}>Cancel</button><button className="native-button primary" disabled={props.busy || !meta.title.trim()} onClick={props.onSave}>Save</button></>}><div className="details-grid">{field("Title", "title")}{field("Subtitle", "subtitle")}{field("Author", "author")}{field("Series", "series")}{field("Book number", "series_index")}{field("Publisher", "publisher")}{field("Language", "language")}{field("ISBN", "isbn")}</div>{field("Copyright text", "copyright", true)}{field("Description", "description", true)}</DialogShell>;
}

function ContentDialog(props: { matterTypes: MatterType[]; title: string; setTitle: (title: string) => void; busy: boolean; onAddChapter: () => void; onAddMatter: (type: MatterType) => void; onClose: () => void }) {
  const front = props.matterTypes.filter((type) => type.placement === "frontmatter");
  const back = props.matterTypes.filter((type) => type.placement === "backmatter");
  const group = (label: string, items: MatterType[]) => <div className="content-kind-group"><h3>{label}</h3>{items.map((type) => <button key={type.key} disabled={props.busy} onClick={() => props.onAddMatter(type)}><span>{type.label}</span><small>Add editable page</small></button>)}</div>;
  return <DialogShell title="Add Content" onClose={props.onClose} footer={<button className="native-button" onClick={props.onClose}>Close</button>}><div className="add-chapter-box"><h3>Chapter</h3><div><input autoFocus value={props.title} onChange={(e) => props.setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && props.title.trim()) props.onAddChapter(); }}/><button className="native-button primary" disabled={props.busy || !props.title.trim()} onClick={props.onAddChapter}>Add Chapter</button></div></div><div className="content-kind-columns">{group("Front Matter", front)}{group("Back Matter", back)}</div></DialogShell>;
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
        <div className="style-content">{category === "Book Style" ? <div className="theme-gallery">{themes.map((theme) => <button key={theme.name} data-theme={theme.name} className={"theme-sample theme-" + theme.name + (meta.theme === theme.name ? " selected" : "")} style={{ background: theme.previewPaper, color: theme.previewAccent, fontFamily: theme.previewFont }} onClick={() => setMeta({ ...meta, theme: theme.name })}><span className="theme-name">{theme.label}</span><span className="sample-chapter" style={{ fontFamily: theme.previewHeadingFont }}>{theme.chapterLabel}</span><span className="sample-title" style={{ fontFamily: theme.previewHeadingFont }}>The Visitor</span><span className="sample-ornament">{theme.sceneOrnament}</span><span className="sample-copy"><b>The</b> room had fallen quiet before anyone noticed the letter beneath the door.</span></button>)}</div> : <CustomizePanel category={category} typography={typography} setTypography={setTypography} printOptions={printOptions} setPrintOptions={setPrintOptions} themeDropcap={selected?.dropcap ?? false}/>}</div>
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

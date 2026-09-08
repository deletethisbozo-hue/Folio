import { useEffect, useMemo, useRef, useState } from "react";
import { api, downloadResult, formatBytes } from "./api";
import type { BookMeta, ExportResult, PrintOptions, ProjectSummary, SectionDocument, Theme, Typography } from "./types";

type PreviewMode = "kindle" | "print";
type SaveState = "idle" | "saving" | "saved" | "error";

const defaultPrint: PrintOptions = {
  trim: "6x9",
  binding: "paperback",
  startChaptersRecto: true,
  layout: "author-title-bottom",
};

function wordCount(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words?.length ?? 0;
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
  const [printOptions] = useState<PrintOptions>(defaultPrint);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showStyle, setShowStyle] = useState(false);
  const [exportState, setExportState] = useState<{ busy: string | null; result: ExportResult | null; error: string | null }>({
    busy: null,
    result: null,
    error: null,
  });
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    api.themes().then(setThemes).catch(() => {});
    const bookPath = new URLSearchParams(window.location.search).get("book")?.trim();
    if (bookPath) void openFolder(bookPath);
  }, []);

  const chapters = useMemo(() => project?.sections.filter((s) => s.kind === "chapter") ?? [], [project]);
  const frontMatter = useMemo(
    () => project?.sections.filter((s) => s.kind !== "chapter" && s.kind !== "backmatter") ?? [],
    [project],
  );
  const backMatter = useMemo(() => project?.sections.filter((s) => s.kind === "backmatter") ?? [], [project]);
  const selectedSection = project?.sections.find((s) => s.id === selectedId) ?? null;
  const chapterIndex = selectedSection?.kind === "chapter" ? chapters.findIndex((s) => s.id === selectedSection.id) + 1 : null;
  const totalWords = useMemo(() => {
    if (!project) return 0;
    if (document && chapters.length <= 1) return wordCount(document.markdown);
    return Math.max(1, Math.round(project.bodyChars / 5.1));
  }, [project, document, chapters.length]);

  useEffect(() => {
    if (!project || !selectedId) return;
    let cancelled = false;
    setSaveState("idle");
    api.section(project.projectId, selectedId)
      .then((doc) => {
        if (cancelled) return;
        setDocument(doc);
        setDraft(doc.markdown);
        setDirty(false);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [project?.projectId, selectedId, revision]);

  useEffect(() => {
    if (!project || !meta) return;
    let cancelled = false;
    setPreviewLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const result =
          previewMode === "print"
            ? await api.previewPrint(project.projectId, meta, meta.theme, printOptions, typography)
            : await api.preview(project.projectId, meta, meta.theme, typography);
        if (!cancelled) setPreviewHtml(result.html);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [project?.projectId, meta, typography, previewMode, printOptions, revision]);

  useEffect(() => {
    if (!dirty || !document?.editable || !project || !selectedId) return;
    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      try {
        const saved = await api.saveSection(project.projectId, selectedId, draft);
        setDocument(saved);
        setDirty(false);
        setSaveState("saved");
        setRevision((v) => v + 1);
        window.setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1200);
      } catch (e) {
        setSaveState("error");
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, document?.editable, project?.projectId, selectedId]);

  function adopt(summary: ProjectSummary) {
    setProject(summary);
    setMeta(summary.meta);
    setTypography(summary.typography ?? {});
    const firstChapter = summary.sections.find((s) => s.kind === "chapter") ?? summary.sections[0] ?? null;
    setSelectedId(firstChapter?.id ?? null);
    setError(null);
    setRevision((v) => v + 1);
  }

  async function openFolder(path?: string) {
    setBusy(true);
    setError(null);
    try {
      const selected = path ?? (await api.pickFolder(project?.folder ?? undefined)).path;
      if (!selected) return;
      adopt(await api.openFolder(selected));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadSample() {
    setBusy(true);
    setError(null);
    try {
      adopt(await api.loadSample());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function onPreviewLoad() {
    const frame = previewRef.current;
    const doc = frame?.contentDocument;
    if (!doc || !selectedId) return;
    const sections = Array.from(doc.querySelectorAll("section.level1")) as HTMLElement[];
    let target = doc.getElementById(selectedId) as HTMLElement | null;
    if (!target && selectedSection?.title) {
      target = sections.find((el) => el.querySelector("h1")?.textContent?.trim() === selectedSection.title) ?? null;
    }
    for (const section of sections) section.style.display = section === target ? "block" : "none";
    const style = doc.createElement("style");
    style.textContent = `
      html,body{background:#f1f0e9!important;min-height:100%!important;}
      body{margin:0!important;padding:0!important;color:#171717!important;}
      main.book{max-width:none!important;margin:0!important;padding:54px 46px 70px!important;box-sizing:border-box!important;}
      section.level1{margin:0!important;border:0!important;padding:0!important;break-before:auto!important;page-break-before:auto!important;}
      section.chapter>h1,h1.chapter{margin-top:18px!important;}
    `;
    doc.head.appendChild(style);
    target?.scrollIntoView({ block: "start" });
  }

  function wrapSelection(before: string, after = before) {
    const el = editorRef.current;
    if (!el || !document?.editable) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = draft.slice(0, start) + before + draft.slice(start, end) + after + draft.slice(end);
    setDraft(next);
    setDirty(true);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, end + before.length);
    });
  }

  async function saveAppearance() {
    if (!project || !meta) return;
    setSaveState("saving");
    try {
      const metaSummary = await api.saveMeta(project.projectId, meta);
      const tySummary = await api.saveTypography(project.projectId, metaSummary.meta, typography);
      setProject(tySummary);
      setSaveState("saved");
      setShowStyle(false);
      setRevision((v) => v + 1);
    } catch (e) {
      setSaveState("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function runExport(label: string, format: string, preset?: string, force = false): Promise<void> {
    if (!project || !meta) return;
    setExportState({ busy: label, result: null, error: null });
    try {
      const result = await api.export(project.projectId, format, {
        preset,
        meta,
        theme: meta.theme,
        typography,
        print: format === "print" ? printOptions : undefined,
        force,
      });
      if (result.needsConfirm) {
        const confirmed = window.confirm(`${result.message ?? "This export already exists."}\n\nReplace it?`);
        if (confirmed) return runExport(label, format, preset, true);
        setExportState({ busy: null, result: null, error: null });
        return;
      }
      if (!result.written) downloadResult(result);
      setExportState({ busy: null, result, error: null });
    } catch (e) {
      setExportState({ busy: null, result: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (!project || !meta) {
    return (
      <div className="folio-shell folio-empty-shell">
        <div className="folio-windowbar empty-windowbar">
          <TrafficLights />
          <div className="windowbar-spacer" />
          <div className="folio-wordmark">Folio</div>
          <div className="windowbar-spacer" />
        </div>
        <main className="empty-state">
          <div className="empty-book-mark">F</div>
          <h1>Folio</h1>
          <p>Format and publish a book without fighting the software first.</p>
          <div className="empty-actions">
            <button className="native-button primary" disabled={busy} onClick={() => void openFolder()}>
              {busy ? "Opening…" : "Open Book Folder…"}
            </button>
            <button className="native-button" disabled={busy} onClick={() => void loadSample()}>
              Open Sample
            </button>
          </div>
          {error && <div className="empty-error">{error}</div>}
        </main>
      </div>
    );
  }

  return (
    <div className="folio-shell">
      <aside className="library-pane">
        <div className="library-toolbar">
          <TrafficLights />
          <div className="library-toolbar-actions">
            <button className="icon-button" title="Contents">☷</button>
            <button className="icon-button infinity" title="Book styles">∞</button>
          </div>
        </div>

        <div className="book-identity">
          <div className="book-title">{meta.title}</div>
          <div className="book-author">{meta.author}</div>
        </div>

        <nav className="contents-list" aria-label="Book contents">
          {frontMatter.map((section) => (
            <button
              key={section.id}
              className={`contents-row ${selectedId === section.id ? "selected" : ""}`}
              onClick={() => setSelectedId(section.id)}
            >
              <span>{section.title}</span>
            </button>
          ))}

          <div className="contents-heading">Contents</div>
          {chapters.map((section, index) => (
            <button
              key={section.id}
              className={`contents-row chapter-row ${selectedId === section.id ? "selected" : ""}`}
              onClick={() => setSelectedId(section.id)}
              title={section.title}
            >
              <span className="chapter-number">{index + 1}.</span>
              <span className="chapter-label">{section.title}</span>
            </button>
          ))}

          {backMatter.length > 0 && <div className="contents-heading back-heading">Back Matter</div>}
          {backMatter.map((section) => (
            <button
              key={section.id}
              className={`contents-row ${selectedId === section.id ? "selected" : ""}`}
              onClick={() => setSelectedId(section.id)}
            >
              <span>{section.title}</span>
            </button>
          ))}
        </nav>

        <div className="library-footer">
          <button className="tiny-footer-button" title="Open another book" onClick={() => void openFolder()}>＋</button>
          <button className="tiny-footer-button" title="Reload" onClick={() => void api.reload(project.projectId).then(adopt)}>↻</button>
          <div className="library-footer-spacer" />
          <button className="tiny-footer-button" title="Settings" onClick={() => setShowStyle((v) => !v)}>⚙</button>
        </div>
      </aside>

      <section className="editor-pane">
        <div className="editor-topbar">
          <div className="topbar-title">{meta.title}</div>
          <div className="editor-topbar-right">
            <span className={`save-indicator ${saveState}`}>{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : ""}</span>
            <span className="word-count">{totalWords.toLocaleString()} Words⌄</span>
          </div>
        </div>

        <div className="section-titlebar">
          <div className="section-title-wrap">
            {chapterIndex ? <span className="section-index">{chapterIndex}.</span> : null}
            <span className="section-title">{selectedSection?.title ?? document?.title ?? ""}</span>
          </div>
          <button className="section-gear" title="Style settings" onClick={() => setShowStyle((v) => !v)}>⚙⌄</button>
        </div>

        <div className="format-toolbar">
          <button className="toolbar-dropdown">⌘⌄</button>
          <div className="toolbar-group">
            <button onClick={() => wrapSelection("**")} title="Bold"><strong>B</strong></button>
            <button onClick={() => wrapSelection("*")} title="Italic"><em>I</em></button>
            <button onClick={() => wrapSelection("<u>", "</u>")} title="Underline"><u>U</u></button>
            <button title="More formatting">⌄</button>
          </div>
          <div className="toolbar-spacer" />
          <div className="search-pill">⌕</div>
        </div>

        <div className="editor-paper">
          {document ? (
            <textarea
              ref={editorRef}
              className="manuscript-editor"
              value={draft}
              readOnly={!document.editable}
              spellCheck
              onChange={(event) => {
                setDraft(event.target.value);
                setDirty(true);
              }}
              aria-label={`Edit ${document.title}`}
            />
          ) : (
            <div className="editor-loading">Loading section…</div>
          )}
          {document && !document.editable && (
            <div className="readonly-note">Generated or combined section. Edit its source file to change the text.</div>
          )}
        </div>
      </section>

      <section className="preview-pane">
        <div className="preview-topbar">
          <div className="generate-wrap">
            <button className="generate-button" onClick={() => setShowGenerate((v) => !v)}>Generate</button>
            {showGenerate && (
              <div className="generate-menu">
                <button onClick={() => void runExport("EPUB · Kindle", "epub", "kdp")}>EPUB · Kindle</button>
                <button onClick={() => void runExport("EPUB · Universal", "epub", "universal")}>EPUB · Universal</button>
                <button onClick={() => void runExport("Print PDF", "print")}>Print PDF</button>
                <button onClick={() => void runExport("Reading PDF", "pdf")}>Reading PDF</button>
                <button onClick={() => void runExport("Word", "docx")}>Word (.docx)</button>
                <div className="generate-status">
                  {exportState.busy && `Generating ${exportState.busy}…`}
                  {exportState.error && <span className="error-text">{exportState.error}</span>}
                  {exportState.result && (
                    <span>
                      ✓ {exportState.result.filename ?? "Done"} · {formatBytes(exportState.result.bytes)}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
          <button className="topbar-icon" title="Book preview">♧</button>
          <button className="topbar-icon" title="Pages">▯</button>
        </div>

        <div className="device-toolbar">
          <button className="device-small-button" title="Device">▣</button>
          <div className="style-wrap">
            <button className="device-small-button aa-button" onClick={() => setShowStyle((v) => !v)}>Aa</button>
            {showStyle && (
              <div className="style-popover">
                <div className="popover-title">Book Style</div>
                <label>
                  <span>Theme</span>
                  <select value={meta.theme} onChange={(e) => setMeta({ ...meta, theme: e.target.value })}>
                    {themes.map((theme) => <option key={theme.name} value={theme.name}>{theme.label}</option>)}
                  </select>
                </label>
                <label>
                  <span>Body size</span>
                  <select value={typography.fontSize ?? "1em"} onChange={(e) => setTypography({ ...typography, fontSize: e.target.value })}>
                    <option value="0.95em">Small</option>
                    <option value="1em">Standard</option>
                    <option value="1.08em">Large</option>
                    <option value="1.15em">Extra Large</option>
                  </select>
                </label>
                <label>
                  <span>Line spacing</span>
                  <select value={String(typography.lineHeight ?? 1.5)} onChange={(e) => setTypography({ ...typography, lineHeight: Number(e.target.value) })}>
                    <option value="1.35">Tight</option>
                    <option value="1.5">Standard</option>
                    <option value="1.65">Relaxed</option>
                  </select>
                </label>
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={typography.dropcap ?? themes.find((t) => t.name === meta.theme)?.dropcap ?? false}
                    onChange={(e) => setTypography({ ...typography, dropcap: e.target.checked })}
                  />
                  <span>Drop cap</span>
                </label>
                <button className="popover-save" onClick={() => void saveAppearance()}>Save Style</button>
              </div>
            )}
          </div>
          <div className="device-label">
            <select value={previewMode} onChange={(e) => setPreviewMode(e.target.value as PreviewMode)}>
              <option value="kindle">Kindle: Paperwhite</option>
              <option value="print">Print: 6 × 9</option>
            </select>
          </div>
          <div className="device-nav">
            <button disabled>l‹</button>
            <button>☰</button>
            <button disabled>›l</button>
          </div>
        </div>

        <div className="preview-stage">
          <div className={`reader-device ${previewMode === "print" ? "print-device" : ""}`}>
            <div className="reader-screen">
              {previewLoading && <div className="preview-loading">Rendering…</div>}
              <iframe
                ref={previewRef}
                className="preview-frame"
                title="Book preview"
                srcDoc={previewHtml}
                onLoad={onPreviewLoad}
              />
            </div>
          </div>
        </div>
      </section>

      {error && (
        <button className="global-error" onClick={() => setError(null)} title="Dismiss">
          {error}
        </button>
      )}
    </div>
  );
}

function TrafficLights() {
  return (
    <div className="traffic-lights" aria-hidden="true">
      <span className="traffic red" />
      <span className="traffic yellow" />
      <span className="traffic green" />
    </div>
  );
}

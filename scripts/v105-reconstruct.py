from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, value: str) -> None:
    (ROOT / path).write_text(value, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    value = read(path)
    if old not in value:
        raise RuntimeError(f"expected text not found in {path}: {old[:100]!r}")
    write(path, value.replace(old, new, 1))


def replace_between(path: str, start: str, end: str, replacement: str) -> None:
    value = read(path)
    a = value.find(start)
    if a < 0:
        raise RuntimeError(f"start marker not found in {path}: {start[:100]!r}")
    b = value.find(end, a + len(start))
    if b < 0:
        raise RuntimeError(f"end marker not found in {path}: {end[:100]!r}")
    write(path, value[:a] + replacement + value[b:])


# Atomic file writes throughout manuscript/config mutations.
replace_once(
    "server/atomic-write.ts",
    'export async function atomicWriteUtf8(target: string, content: string): Promise<void> {',
    'export async function atomicWriteUtf8(target: string, content: string, _encoding: "utf8" = "utf8"): Promise<void> {',
)
replace_once(
    "server/section-editor.ts",
    'import { removeMatter } from "./matter.ts";',
    'import { removeMatter } from "./matter.ts";\nimport { atomicWriteUtf8 } from "./atomic-write.ts";',
)
value = read("server/section-editor.ts")
if "fs.writeFile(" not in value:
    raise RuntimeError("section-editor.ts no longer contains expected writes")
write("server/section-editor.ts", value.replace("fs.writeFile(", "atomicWriteUtf8("))
replace_once(
    "server/matter.ts",
    'import type { BookMeta } from "./pipeline/types.ts";',
    'import type { BookMeta } from "./pipeline/types.ts";\nimport { atomicWriteUtf8 } from "./atomic-write.ts";',
)
value = read("server/matter.ts")
if "fs.writeFile(" not in value:
    raise RuntimeError("matter.ts no longer contains expected writes")
write("server/matter.ts", value.replace("fs.writeFile(", "atomicWriteUtf8("))

# Cooperative rich HTML conversion. DOM parsing itself is browser-native and
# synchronous; recursive rendering is chunked so large multi-paragraph pastes
# repeatedly return control to rendering before Folio mutates the editor DOM.
replace_once(
    "web/src/rich-text.ts",
    'export function plainTextToMarkdown(text: string): string {',
    '''export async function richTextToMarkdownCooperative(html: string): Promise<string> {
  if (html.length < 80_000) return richTextToMarkdown(html);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const doc = new DOMParser().parseFromString(html, "text/html");
  const classStyles = collectClassStyles(doc);
  let out = "";
  let sliceStarted = performance.now();
  for (const child of Array.from(doc.body.childNodes)) {
    out += renderNode(child, classStyles);
    if (performance.now() - sliceStarted > 7) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      sliceStarted = performance.now();
    }
  }
  return out
    .replace(/\\u00a0/g, " ")
    .replace(/[ \\t]+\\n/g, "\\n")
    .replace(/\\n{3,}/g, "\\n\\n")
    .trim();
}

export function plainTextToMarkdown(text: string): string {''',
)

# App imports, Standard device labels, and UI tone state.
replace_once(
    "web/src/App.tsx",
    '  richTextToMarkdown,\n} from "./rich-text";',
    '  richTextToMarkdown,\n  richTextToMarkdownCooperative,\n} from "./rich-text";',
)
replace_once(
    "web/src/App.tsx",
    'import { composePreviewDocument } from "./compositor";',
    'import { composePreviewDocument } from "./compositor";\nimport { calibratePreviewFrame, updatePreviewPageCounts } from "./preview-runtime";\nimport { SerialSaveQueue } from "./save-queue";',
)
replace_once(
    "web/src/App.tsx",
    'type SaveState = "idle" | "saving" | "saved" | "error";',
    'type SaveState = "idle" | "saving" | "saved" | "error";\ntype UiTone = "ivory" | "midnight";',
)
for old, new in [
    ('{ value: "kindle-paperwhite", label: "Kindle · Paperwhite" }', '{ value: "kindle-paperwhite", label: "Paperwhite · Standard" }'),
    ('{ value: "kindle-oasis", label: "Kindle · Oasis" }', '{ value: "kindle-oasis", label: "Oasis · Standard" }'),
    ('{ value: "ipad", label: "Apple · iPad" }', '{ value: "ipad", label: "iPad · Standard" }'),
    ('{ value: "iphone", label: "Apple · iPhone" }', '{ value: "iphone", label: "iPhone · Standard" }'),
    ('{ value: "android", label: "Android · Phone" }', '{ value: "android", label: "Android · Standard" }'),
]:
    replace_once("web/src/App.tsx", old, new)
replace_once(
    "web/src/App.tsx",
    '  const paragraph = section.querySelector(":scope > p:not(.scene-break)");\n  if (!paragraph || paragraph.querySelector(".dropcap")) return;',
    '  const paragraph = Array.from(section.querySelectorAll<HTMLElement>(":scope > p:not(.scene-break)"))\n    .find((candidate) => Boolean(candidate.textContent?.trim()));\n  if (!paragraph || paragraph.querySelector(".dropcap")) return;',
)
replace_once(
    "web/src/App.tsx",
    '  const [previewMode, setPreviewMode] = useState<PreviewMode>("kindle-paperwhite");',
    '  const [previewMode, setPreviewMode] = useState<PreviewMode>("kindle-paperwhite");\n  const [previewDraft, setPreviewDraft] = useState("");\n  const [pastePreparing, setPastePreparing] = useState(false);\n  const [uiTone, setUiTone] = useState<UiTone>(() => window.localStorage.getItem("folio-ui-tone") === "midnight" ? "midnight" : "ivory");',
)
replace_once(
    "web/src/App.tsx",
    '  const pendingPreviewScrollRef = useRef(0);',
    '''  const pendingPreviewScrollRef = useRef(0);
  const editorDomDirtyRef = useRef(false);
  const editorDomGenerationRef = useRef(0);
  const editorSyncTimerRef = useRef<number | null>(null);
  const sectionSaveQueueRef = useRef(new SerialSaveQueue<string>());
  const appearanceSaveQueueRef = useRef(new SerialSaveQueue<string>());''',
)
replace_once(
    "web/src/App.tsx",
    '    setDraft("");\n    setDirty(false);',
    '    setDraft("");\n    setPreviewDraft("");\n    editorDomDirtyRef.current = false;\n    editorDomGenerationRef.current++;\n    if (editorSyncTimerRef.current !== null) { window.clearTimeout(editorSyncTimerRef.current); editorSyncTimerRef.current = null; }\n    setDirty(false);',
)
replace_once(
    "web/src/App.tsx",
    '  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);',
    '''  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
  useEffect(() => { window.localStorage.setItem("folio-ui-tone", uiTone); }, [uiTone]);
  useEffect(() => {
    if (draft.length < 35_000) { setPreviewDraft(draft); return; }
    const delay = draft.length > 250_000 ? 460 : draft.length > 100_000 ? 300 : 150;
    const timer = window.setTimeout(() => setPreviewDraft(draft), delay);
    return () => window.clearTimeout(timer);
  }, [draft]);''',
)
replace_once(
    "web/src/App.tsx",
    '        const withMeta = await api.saveMeta(projectId, appearanceMeta);\n        await api.saveTypography(projectId, withMeta.meta, typography);',
    '        await persistAppearance(projectId, appearanceMeta, typography);',
)
replace_once(
    "web/src/App.tsx",
    '      setDocument(doc); setDraft(doc.markdown); setDirty(false);',
    '      editorDomDirtyRef.current = false; editorDomGenerationRef.current++;\n      setDocument(doc); setDraft(doc.markdown); setPreviewDraft(doc.markdown); setDirty(false);',
)

# Separate authoritative backend renders. Reflow is requested when project/style
# identity changes; typing is local. Print remains backend/Paged.js but consumes
# the debounced preview draft.
replace_between(
    "web/src/App.tsx",
    '  useEffect(() => {\n    if (!project || !meta || !selectedId || document?.id !== selectedId) return;\n    let cancelled = false;\n    const controller = new AbortController();\n    setPreviewLoading(true);',
    '\n\n  function commitPreviewHtml',
    '''  useEffect(() => {
    if (!project || !meta || !selectedId || document?.id !== selectedId || previewMode === "print") return;
    let cancelled = false;
    const controller = new AbortController();
    setPreviewLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.preview(project.projectId, meta, meta.theme, typography, selectedId, draftRef.current, controller.signal);
        if (!cancelled) { commitPreviewHtml(result.html); setPreviewError(null); }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (!cancelled) {
          const message = e instanceof Error ? e.message : String(e);
          setPreviewError(message); setError(message);
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 40);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [project?.projectId, meta, typography, previewMode, selectedId, document?.id, document?.subtitle]);

  useEffect(() => {
    if (!project || !meta || !selectedId || document?.id !== selectedId || previewMode !== "print") return;
    let cancelled = false;
    const controller = new AbortController();
    setPreviewLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.previewPrint(project.projectId, meta, meta.theme, printOptions, typography, selectedId, previewDraft, controller.signal);
        if (!cancelled) { commitPreviewHtml(result.html); setPreviewError(null); }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (!cancelled) {
          const message = e instanceof Error ? e.message : String(e);
          setPreviewError(message); setError(message);
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, previewDraft.length > 250_000 ? 650 : 220);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [project?.projectId, meta, typography, previewMode, printOptions, selectedId, document?.id, document?.subtitle, previewDraft]);''',
)
replace_once("web/src/App.tsx", 'template.innerHTML = markdownToPreviewHtml(draft, ornament);', 'template.innerHTML = markdownToPreviewHtml(previewDraft, ornament);')
replace_once(
    "web/src/App.tsx",
    '  }, [draft, document?.id, document?.subtitle, selectedId, previewMode, typography.sceneOrnament, typography.dropcap, typography.bodyAlign, typography.chapterTitle?.showLabel, typography.chapterTitle?.labelText, meta?.theme, meta?.language, themes]);',
    '  }, [previewDraft, document?.id, document?.subtitle, selectedId, previewMode, typography.sceneOrnament, typography.dropcap, typography.bodyAlign, typography.chapterTitle?.showLabel, typography.chapterTitle?.labelText, meta?.theme, meta?.language, themes]);',
)

# Autosave writes are serialised by project+section. Older requests physically
# finish before a newer snapshot begins, so response timing cannot roll content
# backwards.
replace_between(
    "web/src/App.tsx",
    '  useEffect(() => {\n    if (!dirty || !document?.editable || !project || !selectedId) return;\n    setSaveState("saving");',
    '\n\n  // Device chrome is a client-side view',
    '''  useEffect(() => {
    if (!dirty || !document?.editable || !project || !selectedId) return;
    setSaveState("saving");
    const projectId = project.projectId;
    const sectionId = selectedId;
    const value = draft;
    const timer = window.setTimeout(async () => {
      try {
        const saved = await persistSection(projectId, sectionId, value);
        if (selectedRef.current === sectionId && draftRef.current === value && !editorDomDirtyRef.current) {
          setDocument(saved); setDirty(false); setSaveState("saved");
        }
      } catch (e) {
        if (selectedRef.current === sectionId) {
          setSaveState("error"); setError(e instanceof Error ? e.message : String(e));
        }
      }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, document?.editable, project?.projectId, selectedId]);''',
)
replace_once("web/src/App.tsx", '  useEffect(() => { previewStageRef.current?.scrollTo(0, 0); }, [previewMode, selectedId]);', '  useEffect(() => { previewStageRef.current?.scrollTo(0, 0); }, [selectedId]);')

# Header rename starts from a flushed DOM snapshot, then checks once more after
# the slower source rewrite so characters typed during the request survive.
replace_once(
    "web/src/App.tsx",
    '    const previousDocument = document;\n    const draftAtStart = draftRef.current;',
    '    const previousDocument = document;',
)
replace_once(
    "web/src/App.tsx",
    '    if (!(await saveCurrent())) return;\n    // Subtitle rendering',
    '    if (!(await saveCurrent())) return;\n    const draftAtStart = draftRef.current;\n    // Subtitle rendering',
)
replace_once(
    "web/src/App.tsx",
    '      const updated = await api.updateSectionHeading(project.projectId, selectedId, {',
    '      const updated = await api.updateSectionHeading(project.projectId, selectedId, {',
)
replace_once(
    "web/src/App.tsx",
    '      });\n      const summary = await api.reload(project.projectId);\n      const liveDraft = draftRef.current;',
    '      });\n      await flushEditorDom();\n      const summary = await api.reload(project.projectId);\n      const liveDraft = draftRef.current;',
)

# Shared queues + an explicit DOM flush form the data-loss boundary used by
# section changes, heading edits, exports and Electron close.
replace_once(
    "web/src/App.tsx",
    '  async function saveBookDetails() {',
    '''  async function persistSection(projectId: string, sectionId: string, value: string): Promise<SectionDocument> {
    return sectionSaveQueueRef.current.run(`${projectId}::${sectionId}`, () => api.saveSection(projectId, sectionId, value));
  }

  async function persistAppearance(projectId: string, nextMeta: BookMeta, nextTypography: Typography): Promise<ProjectSummary> {
    return appearanceSaveQueueRef.current.run(projectId, async () => {
      const withMeta = await api.saveMeta(projectId, nextMeta);
      return api.saveTypography(projectId, withMeta.meta, nextTypography);
    });
  }

  function scheduleEditorDomSync() {
    if (editorSyncTimerRef.current !== null) window.clearTimeout(editorSyncTimerRef.current);
    const length = draftRef.current.length;
    const delay = length > 250_000 ? 420 : length > 100_000 ? 300 : 170;
    editorSyncTimerRef.current = window.setTimeout(() => {
      editorSyncTimerRef.current = null;
      void flushEditorDom();
    }, delay);
  }

  async function flushEditorDom(): Promise<void> {
    if (editorSyncTimerRef.current !== null) {
      window.clearTimeout(editorSyncTimerRef.current);
      editorSyncTimerRef.current = null;
    }
    const editor = editorRef.current;
    if (!editor || !editorDomDirtyRef.current) return;

    for (let attempt = 0; attempt < 3; attempt++) {
      const generation = editorDomGenerationRef.current;
      const html = editor.innerHTML;
      const markdown = html.length >= 80_000
        ? await richTextToMarkdownCooperative(html)
        : richTextToMarkdown(html);
      if (generation !== editorDomGenerationRef.current) continue;
      editor.dataset.markdown = markdown;
      editorDomDirtyRef.current = false;
      recordDraft(markdown);
      return;
    }

    // A user can technically keep typing while a cooperative conversion yields.
    // The final synchronous snapshot is only this explicit save boundary; it is
    // preferable to losing the last characters after section switch/close.
    const markdown = richTextToMarkdown(editor.innerHTML);
    editor.dataset.markdown = markdown;
    editorDomDirtyRef.current = false;
    recordDraft(markdown);
  }

  async function saveBookDetails() {''',
)
replace_between(
    "web/src/App.tsx",
    '  async function saveBookDetails() {',
    '\n\n  async function saveCurrent(): Promise<boolean> {',
    '''  async function saveBookDetails() {
    if (!project || !meta || !(await saveCurrent())) return;
    setSaveState("saving");
    try {
      const summary = await persistAppearance(project.projectId, meta, typography);
      adopt(summary, selectedId ?? undefined);
      setShowBookDetails(false);
      setSaveState("saved");
    } catch (e) { setSaveState("error"); setError(e instanceof Error ? e.message : String(e)); }
  }''',
)
replace_between(
    "web/src/App.tsx",
    '  async function saveCurrent(): Promise<boolean> {',
    '\n\n  async function reloadFiles() {',
    '''  async function saveCurrent(): Promise<boolean> {
    if (!document?.editable || !project || !selectedId) return true;
    await flushEditorDom();
    const sectionId = selectedId;
    const value = draftRef.current;
    setSaveState("saving");
    try {
      const saved = await persistSection(project.projectId, sectionId, value);
      if (selectedRef.current === sectionId && draftRef.current === value && !editorDomDirtyRef.current) {
        setDocument(saved); setDirty(false); setSaveState("saved");
      }
      return true;
    } catch (e) {
      setSaveState("error"); setError(e instanceof Error ? e.message : String(e)); return false;
    }
  }

  useEffect(() => {
    const host = window as Window & { __folioPrepareClose?: () => Promise<boolean> };
    host.__folioPrepareClose = async () => {
      if (!(await saveCurrent())) return false;
      try {
        if (project && meta) await persistAppearance(project.projectId, meta, typography);
        await sectionSaveQueueRef.current.flush();
        await appearanceSaveQueueRef.current.flush();
        return true;
      } catch (e) {
        setSaveState("error"); setError(e instanceof Error ? e.message : String(e));
        return false;
      }
    };
    return () => { delete host.__folioPrepareClose; };
  }, [project?.projectId, selectedId, document?.id, document?.editable, meta, typography]);''',
)

# Preview profile CSS no longer hardcodes a second font size/padding set. Runtime
# calibration runs first, then exactly one initial composition happens here.
replace_between(
    "web/src/App.tsx",
    '  function onPreviewLoad(restoreScroll?: number) {',
    '\n\n  function applyInlineFormat',
    '''  function onPreviewLoad(restoreScroll?: number) {
    const frame = previewRef.current;
    const doc = frame?.contentDocument;
    if (!doc?.head || !frame) return;
    doc.getElementById("folio-device-profile")?.remove();
    const style = doc.createElement("style");
    style.id = "folio-device-profile";
    if (previewMode === "print") {
      doc.getElementById("folio-device-calibration")?.remove();
      const page = doc.querySelector(".pagedjs_page") as HTMLElement | null;
      const width = page?.getBoundingClientRect().width || 576;
      const scale = Math.min(1, (frame.clientWidth - 14) / width);
      style.textContent = `.pagedjs_pages{transform:scale(${scale});transform-origin:top center;width:${100 / scale}%!important;margin-left:${(100 - 100 / scale) / 2}%!important}.pagedjs_page{margin:10px auto!important}`;
    } else {
      const proseSelector = "body.book-formatter main.book section.chapter>p:not(.scene-break),body.book-formatter main.book section.chapter>blockquote p,body.book-formatter main.book section.chapter li,body.book-formatter main.book section.backmatter>p:not(.scene-break),body.book-formatter main.book section.backmatter li";
      const proseComposition = typography.bodyAlign === "left"
        ? `${proseSelector}{margin-right:0!important;text-align:left!important;text-align-last:left!important;-webkit-hyphens:none!important;hyphens:none!important;text-wrap:pretty!important}`
        : `${proseSelector}{margin-right:0!important;text-align:left!important;text-align-last:left!important;-webkit-hyphens:manual!important;hyphens:manual!important;overflow-wrap:normal!important;word-break:normal!important;word-spacing:normal!important;letter-spacing:normal!important}`;
      style.textContent = "html,body{min-height:100%!important}body{margin:0!important;padding:0!important}main.book{max-width:none!important;margin:0!important;box-sizing:border-box!important}section.level1{display:block!important;margin:0!important;border:0!important;padding:0!important;break-before:auto!important;page-break-before:auto!important}section.chapter>h1,h1.chapter{margin-top:12px!important}.folio-composed{text-indent:0!important}.folio-composed-line{display:block;white-space:nowrap;text-indent:0}.folio-line-justified,.folio-line-natural{text-align:left!important;text-align-last:left!important}.scene-break{text-align:center!important;text-align-last:center!important;word-spacing:normal!important;letter-spacing:normal!important}" + proseComposition;
    }
    doc.head.appendChild(style);
    if (previewMode !== "print") calibratePreviewFrame(frame);
    syncLiveChapterLabel(doc);
    const liveApplied = applyLiveDraftToPreview();
    if (previewMode !== "print" && !liveApplied) {
      if (typography.bodyAlign !== "left") hyphenatePreviewDocument(doc, meta?.language || "en");
      void composePreviewDocument(doc, typography.bodyAlign !== "left");
    }
    if (pendingPreviewIdentityRef.current) {
      previewIdentityRef.current = pendingPreviewIdentityRef.current;
      pendingPreviewIdentityRef.current = "";
    }
    const targetScroll = typeof restoreScroll === "number"
      ? restoreScroll
      : pendingPreviewScrollRef.current || doc.scrollingElement?.scrollTop || 0;
    pendingPreviewScrollRef.current = 0;
    requestAnimationFrame(() => {
      doc.scrollingElement?.scrollTo(0, targetScroll);
      updatePreviewPageCounts(frame);
    });
  }''',
)

# Large paste: paint progress first, convert in cooperative slices, and never use
# a capture listener that swallows trusted input events.
replace_between(
    "web/src/App.tsx",
    '  function editorPaste(event: React.ClipboardEvent<HTMLDivElement>) {',
    '\n\n  function recordEditorDom() {',
    '''  async function editorPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    if (!document?.editable) return;
    const html = event.clipboardData.getData("text/html");
    const plain = event.clipboardData.getData("text/plain");
    if (!(html.trim() || plain.trim())) return;
    event.preventDefault();

    const editor = editorRef.current;
    const large = html.length + plain.length >= 80_000;
    if (large) {
      setPastePreparing(true);
      if (editor) editor.contentEditable = "false";
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }

    try {
      const markdown = html.trim() ? await richTextToMarkdownCooperative(html) : plainTextToMarkdown(plain);
      if (!markdown) return;
      const ornament = typography.sceneOrnament ?? themes.find((theme) => theme.name === meta?.theme)?.sceneOrnament ?? "❦";
      const selection = window.getSelection();
      const editorText = editor?.innerText.trim() ?? "";
      const selectedText = selection?.toString().trim() ?? "";
      const replacesDocument = !editorText || (selectedText.length > 0 && selectedText.length >= editorText.length * 0.9);

      if (editor && replacesDocument) {
        editor.innerHTML = markdownToEditorHtml(markdown, ornament);
        editor.dataset.markdown = markdown;
        editor.dataset.ornament = ornament;
        editorDomDirtyRef.current = false;
        editorDomGenerationRef.current++;
        const range = window.document.createRange();
        range.selectNodeContents(editor); range.collapse(false);
        selection?.removeAllRanges(); selection?.addRange(range);
        recordDraft(markdown);
      } else {
        insertEditorHtml(markdownToEditorHtml(markdown, ornament));
        recordEditorDom();
      }

      const detected = detectPastedLanguage(markdown);
      if (detected && meta && project && /^en(?:-|$)/i.test(meta.language || "en")) {
        const nextMeta = { ...meta, language: detected };
        setMeta(nextMeta);
        void persistAppearance(project.projectId, nextMeta, typography)
          .then((summary) => { setProject(summary); setMeta(summary.meta); })
          .catch((e) => setError(e instanceof Error ? e.message : String(e)));
      }
    } finally {
      if (editor && document?.editable) editor.contentEditable = "true";
      if (large) setPastePreparing(false);
    }
  }''',
)
replace_between(
    "web/src/App.tsx",
    '  function recordEditorDom() {',
    '\n\n  function recordDraft(next: string) {',
    '''  function recordEditorDom() {
    const editor = editorRef.current;
    if (!editor) return;
    editorDomDirtyRef.current = true;
    editorDomGenerationRef.current++;
    if (draftRef.current.length < 35_000) void flushEditorDom();
    else scheduleEditorDomSync();
  }''',
)
replace_once(
    "web/src/App.tsx",
    '      const withMeta = await api.saveMeta(project.projectId, meta);\n      const saved = await api.saveTypography(project.projectId, withMeta.meta, typography);',
    '      const saved = await persistAppearance(project.projectId, meta, typography);',
)

# Two restrained editorial UI tones. Every command maps to an existing action.
replace_once("web/src/App.tsx", '<div className="folio-shell folio-empty-shell">', '<div className="folio-shell folio-empty-shell" data-ui-tone={uiTone}>')
replace_once(
    "web/src/App.tsx",
    '    <div className="folio-shell">\n      <aside className="library-pane">',
    '''    <div className="folio-shell" data-ui-tone={uiTone}>
      <header className="folio-commandbar">
        <div className="command-wordmark">Folio</div>
        <nav aria-label="Application commands">
          <button onClick={() => setShowBookDetails(true)}>Document</button>
          <button onClick={() => setShowContent(true)}>Insert</button>
          <button onClick={() => setShowStyle(true)}>Format</button>
          <button onClick={() => setUiTone((tone) => tone === "ivory" ? "midnight" : "ivory")}>View</button>
          <button onClick={() => setShowGenerate(true)}>Share</button>
        </nav>
        <button className="tone-toggle" onClick={() => setUiTone((tone) => tone === "ivory" ? "midnight" : "ivory")} aria-label={uiTone === "ivory" ? "Use Midnight Editorial" : "Use Ivory and Ink"}>{uiTone === "ivory" ? "Midnight" : "Ivory"}</button>
      </header>
      <aside className="library-pane">''',
)
replace_once(
    "web/src/App.tsx",
    '<div className="editor-paper">{selectedId ?',
    '<div className="editor-paper">{pastePreparing && <div className="paste-progress" role="status">Preparing pasted manuscript…</div>}{selectedId ?',
)
replace_once(
    "web/src/App.tsx",
    'key={`${project.projectId}:${selectedId}`}',
    'key={`${project.projectId}:${selectedId}:${previewMode}`}',
)
replace_once(
    "web/src/App.tsx",
    '      </section>\n\n      {showStyle && (',
    '''      </section>

      <footer className="folio-statusbar"><span>{saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed" : "Autosave on"}</span><span>{meta.language || "en"}</span><span>{themes.find((theme) => theme.name === meta.theme)?.label ?? meta.theme}</span><span>{previewProfiles.find((profile) => profile.value === previewMode)?.label}</span></footer>

      {showStyle && (''',
)

# Safer generated CSS defaults and scene-break isolation.
replace_once("server/pipeline/doc-css.ts", '  -webkit-hyphens: auto;\n  hyphens: auto;', '  -webkit-hyphens: manual;\n  hyphens: manual;')
replace_once(
    "server/pipeline/doc-css.ts",
    '  if (ty.paragraphIndent !== undefined) out.push(`p { text-indent: ${ty.paragraphIndent} !important; }`);',
    '  out.push(`.scene-break { text-align: center !important; text-align-last: center !important; word-spacing: normal !important; letter-spacing: normal !important; }`);\n  if (ty.paragraphIndent !== undefined) out.push(`p { text-indent: ${ty.paragraphIndent} !important; }`);',
)

# Keep the physical preview shell dimensions. Only status text is made readable.
replace_once("web/src/preview-calibration.css", 'font-size: 8.5px;', 'font-size: 10px;')
replace_once("web/src/preview-calibration.css", '.page-counts { font-size: 8px; }', '.page-counts { font-size: 9.5px; }')

# Editorial UI overrides. Device-shell gradients are intentionally untouched;
# those depict physical hardware rather than dashboard decoration.
css = read("web/src/index.css")
marker = "/* Folio 1.0.5 editorial UI tones */"
if marker not in css:
    css += r'''

/* Folio 1.0.5 editorial UI tones */
.folio-shell[data-ui-tone="ivory"] {
  --folio-bg:#FAF8F3; --folio-panel:#F1E6D7; --folio-surface:#fffdf9;
  --folio-text:#1F1F1F; --folio-muted:#8B6F56; --folio-accent:#A47148;
  --folio-border:#d8cabb; --folio-hover:#eadccd; --folio-selected:#dfcdbb;
}
.folio-shell[data-ui-tone="midnight"] {
  --folio-bg:#1A1A1D; --folio-panel:#262629; --folio-surface:#333339;
  --folio-text:#EAE3D7; --folio-muted:#b9aa96; --folio-accent:#D4AF7C;
  --folio-border:#46464b; --folio-hover:#3d3d43; --folio-selected:#4a443c;
}
.folio-shell:not(.folio-empty-shell)[data-ui-tone] {
  grid-template-rows:34px minmax(0,1fr) 24px;
  background:var(--folio-bg); color:var(--folio-text);
}
.folio-commandbar { grid-column:1/-1; display:flex; align-items:center; min-width:0; padding:0 12px; border-bottom:1px solid var(--folio-border); background:var(--folio-bg); }
.command-wordmark { width:152px; font:600 17px/1 Georgia,"Times New Roman",serif; letter-spacing:-.025em; color:var(--folio-text); }
.folio-commandbar nav { display:flex; align-items:center; gap:2px; }
.folio-commandbar button { height:26px; padding:0 9px; border:0; border-radius:3px; background:transparent; color:var(--folio-text); font-size:11px; }
.folio-commandbar button:hover { background:var(--folio-hover); }
.folio-commandbar .tone-toggle { margin-left:auto; color:var(--folio-accent); font-weight:600; }
.folio-statusbar { grid-column:1/-1; display:flex; align-items:center; gap:18px; padding:0 12px; border-top:1px solid var(--folio-border); background:var(--folio-bg); color:var(--folio-muted); font-size:10px; }
.folio-statusbar span:first-child { margin-right:auto; }
.folio-shell[data-ui-tone] .library-pane,
.folio-shell[data-ui-tone] .library-toolbar,
.folio-shell[data-ui-tone] .library-footer { background:var(--folio-panel); border-color:var(--folio-border); color:var(--folio-text); }
.folio-shell[data-ui-tone] .editor-pane,
.folio-shell[data-ui-tone] .editor-topbar,
.folio-shell[data-ui-tone] .section-titlebar,
.folio-shell[data-ui-tone] .format-toolbar { background:var(--folio-surface); border-color:var(--folio-border); color:var(--folio-text); }
.folio-shell[data-ui-tone] .preview-pane { background:color-mix(in srgb,var(--folio-bg) 88%,#777 12%); }
.folio-shell[data-ui-tone] .preview-topbar,
.folio-shell[data-ui-tone] .device-toolbar { background:var(--folio-panel); border-color:var(--folio-border); color:var(--folio-text); }
.folio-shell[data-ui-tone] .book-title,
.folio-shell[data-ui-tone] .pane-label,
.folio-shell[data-ui-tone] .topbar-title,
.folio-shell[data-ui-tone] .section-title,
.folio-shell[data-ui-tone] .section-index,
.folio-shell[data-ui-tone] .format-toolbar button,
.folio-shell[data-ui-tone] .contents-row,
.folio-shell[data-ui-tone] .preview-style-button,
.folio-shell[data-ui-tone] .device-label select { color:var(--folio-text); }
.folio-shell[data-ui-tone] .book-author,
.folio-shell[data-ui-tone] .contents-heading,
.folio-shell[data-ui-tone] .section-subtitle-button,
.folio-shell[data-ui-tone] .word-count,
.folio-shell[data-ui-tone] .save-indicator { color:var(--folio-muted); }
.folio-shell[data-ui-tone] .contents-row:hover,
.folio-shell[data-ui-tone] .format-toolbar button:hover,
.folio-shell[data-ui-tone] .toolbar-text-button:hover,
.folio-shell[data-ui-tone] .preview-style-button:hover { background:var(--folio-hover); }
.folio-shell[data-ui-tone] .contents-row.selected { background:var(--folio-selected); color:var(--folio-text); }
.folio-shell[data-ui-tone] .generate-button,
.folio-shell[data-ui-tone] .toolbar-dropdown,
.folio-shell[data-ui-tone] .native-button { background:var(--folio-surface)!important; background-image:none!important; color:var(--folio-text); border-color:var(--folio-border); box-shadow:none; }
.folio-shell[data-ui-tone] .native-button.primary { background:var(--folio-accent)!important; color:#fff; border-color:transparent; }
.folio-shell[data-ui-tone="midnight"] .native-button.primary { color:#1A1A1D; }
.folio-shell[data-ui-tone] .generate-menu,
.folio-shell[data-ui-tone] .folio-dialog,
.folio-shell[data-ui-tone] .style-library { background:var(--folio-surface); color:var(--folio-text); border-color:var(--folio-border); box-shadow:0 12px 28px rgba(0,0,0,.18); }
.folio-shell[data-ui-tone] .style-library-header,
.folio-shell[data-ui-tone] .style-library-footer,
.folio-shell[data-ui-tone] .style-category-list { background:var(--folio-panel); border-color:var(--folio-border); }
.folio-shell[data-ui-tone] .search-pill { border-radius:3px; color:var(--folio-muted); border-color:var(--folio-border); }
.folio-shell[data-ui-tone] button:focus-visible,
.folio-shell[data-ui-tone] input:focus-visible,
.folio-shell[data-ui-tone] select:focus-visible,
.folio-shell[data-ui-tone] textarea:focus-visible { outline:2px solid var(--folio-accent); outline-offset:2px; }
.folio-shell[data-ui-tone] button:disabled { opacity:.42; cursor:default; }
.folio-shell[data-ui-tone] .word-count,
.folio-shell[data-ui-tone] .save-indicator { font-size:10px; }
.folio-shell[data-ui-tone] .reader-screen { background:#fff; color:#1f1f1f; }
.folio-shell[data-ui-tone="midnight"] .manuscript-editor { background:#232326; color:#EAE3D7; scrollbar-color:#55545a transparent; }
.folio-shell[data-ui-tone="midnight"] .editor-paper { background:#232326; }
.paste-progress { position:absolute; z-index:12; inset:12px 18px auto; min-height:34px; display:flex; align-items:center; justify-content:center; border:1px solid var(--folio-border,#ccc); border-radius:4px; background:var(--folio-surface,#fff); color:var(--folio-text,#222); font-size:11px; box-shadow:0 6px 18px rgba(0,0,0,.12); }
'''
    write("web/src/index.css", css)

# Version consistency without touching dependency versions.
replace_once("package.json", '"version": "1.0.4"', '"version": "1.0.5"')
lock = read("package-lock.json")
if lock.count('"version": "1.0.3"') < 2:
    raise RuntimeError("package-lock root versions are not in the expected 1.0.3 state")
lock = lock.replace('"version": "1.0.3"', '"version": "1.0.5"', 2)
write("package-lock.json", lock)

# Ensure new focused suites are part of the stable run order.
replace_once(
    "tests/run-all.ts",
    '  "atomic-write.test.ts",\n  "ingestion.test.ts",',
    '  "atomic-write.test.ts",\n  "save-queue.test.ts",\n  "ingestion.test.ts",',
)

print("Folio 1.0.5 reconstruction patch applied successfully")

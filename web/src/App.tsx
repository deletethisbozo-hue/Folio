import { useEffect, useMemo, useRef, useState } from "react";
import { api, downloadResult, formatBytes } from "./api";
import {
  detectPastedLanguage,
  generatedMatterToEditorHtml,
  markdownToEditorHtml,
  markdownToPreviewHtml,
  plainTextToMarkdown,
  richTextToMarkdown,
  richTextToMarkdownCooperative,
} from "./rich-text";
import { hyphenatePreviewDocument } from "./hyphenation";
import { composePreviewDocument } from "./compositor";
import { calibratePreviewFrame, updatePreviewPageCounts } from "./preview-runtime";
import { getPreviewProfile, previewProfileGroups, previewProfiles, type PreviewMode } from "./device-profiles";
import { SerialSaveQueue } from "./save-queue";
import { centerTypewriterCaret, scheduleTypewriterCaret } from "./typewriter";
import WritingSplitPane from "./WritingSplitPane";
import type { BookMeta, ExportResult, MatterType, PrintOptions, ProjectSummary, SectionDocument, Theme, Typography } from "./types";

type SaveState = "idle" | "saving" | "saved" | "error";
type UiTone = "ivory" | "midnight";
type WorkspaceMode = "write" | "format";
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
const COVER_ID = "__folio_cover__";
const sceneOrnaments = [
  "⁂", "❦", "❧", "✦", "◆", "◇", "◈", "❖", "※", "⁕",
  "✺", "✠", "☾", "☼", "§", "∞", "• • •", "· · ·", "* * *",
  "— ✦ —", "— ◆ —", "~ ✦ ~", "☙ ❦ ❧", "◆ ◆ ◆",
  "⚔", "♜", "♱", "†", "‡", "☠", "☽ ◇ ☾", "༺ ✦ ༻",
  "𓆩 ◆ 𓆪", "— ☾ —", "❖ ❖ ❖", "⸻ ✠ ⸻",
];

type UiIconName = "drag" | "open" | "reload" | "up" | "down" | "undo" | "redo" | "search" | "split" | "focus" | "typewriter" | "sidebar" | "previous" | "next";

function UiIcon({ name }: { name: UiIconName }) {
  const paths: Record<UiIconName, React.ReactNode> = {
    drag: <><circle cx="8" cy="7" r="1"/><circle cx="16" cy="7" r="1"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/><circle cx="8" cy="17" r="1"/><circle cx="16" cy="17" r="1"/></>,
    open: <><path d="M3.5 8.5h7l2-2h8v11.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="m7 15 5-5 5 5M12 10v8"/></>,
    reload: <><path d="M20 7v5h-5"/><path d="M18.2 17a8 8 0 1 1 .6-9.8L20 12"/></>,
    up: <path d="m6 14 6-6 6 6"/>,
    down: <path d="m6 10 6 6 6-6"/>,
    undo: <><path d="M9 7 4 12l5 5"/><path d="M5 12h8a6 6 0 0 1 6 6"/></>,
    redo: <><path d="m15 7 5 5-5 5"/><path d="M19 12h-8a6 6 0 0 0-6 6"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4 4"/></>,
    split: <><rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M12 5v14"/></>,
    focus: <><path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4"/></>,
    typewriter: <><path d="M5 6h14M12 6v11M8 17h8"/><path d="M4 12h3M17 12h3"/></>,
    sidebar: <><rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M8.5 5v14"/></>,
    previous: <path d="m15 18-6-6 6-6"/>,
    next: <path d="m9 18 6-6-6-6"/>,
  };
  return <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

function wordCount(text: string): number {
  return text.trim().match(/\S+/g)?.length ?? 0;
}

function lastPreviewProse(section: Element | null): HTMLElement | null {
  if (!section) return null;
  // Fast typing in a huge manuscript calls this once per keystroke. Walking
  // backward from the tail is O(distance-to-last-paragraph), unlike building
  // a 5,200-element NodeList/Array every time a character is typed.
  for (let node = section.lastElementChild; node; node = node.previousElementSibling) {
    if (node.tagName === "P" && !node.classList.contains("scene-break")) return node as HTMLElement;
  }
  const nested = Array.from(section.querySelectorAll<HTMLElement>("p:not(.scene-break)"));
  return nested.at(-1) ?? null;
}

function applyDraftDropcap(section: Element, enabled: boolean): void {
  if (!enabled || !section.classList.contains("chapter")) return;
  const paragraph = Array.from(section.querySelectorAll<HTMLElement>(":scope > p:not(.scene-break)"))
    .find((candidate) => Boolean(candidate.textContent?.trim()));
  if (!paragraph || paragraph.querySelector(".dropcap")) return;
  const walker = paragraph.ownerDocument.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const match = node.data.match(/^\s*(["'“”‘’«]*)(\p{L})/u);
    if (!match) {
      if (node.data.trim()) return;
      continue;
    }
    const span = paragraph.ownerDocument.createElement("span");
    span.className = "dropcap";
    span.textContent = match[1] + match[2];
    node.data = node.data.slice(match[0].length);
    // Keep the float as a direct child of the paragraph. Nesting it inside an
    // opening <em>/<strong> creates a separate inline formatting context and
    // can destabilize the first justified lines in Chromium and EPUB readers.
    paragraph.insertBefore(span, paragraph.firstChild);
    return;
  }
}

export default function App({ initialProject = null, onDashboard }: { initialProject?: ProjectSummary | null; onDashboard?: () => void } = {}) {
  const initialSection = initialProject?.sections.find((section) => section.kind === "chapter") ?? initialProject?.sections[0] ?? null;
  const [themes, setThemes] = useState<Theme[]>([]);
  const [matterTypes, setMatterTypes] = useState<MatterType[]>([]);
  const [project, setProject] = useState<ProjectSummary | null>(initialProject);
  const [meta, setMeta] = useState<BookMeta | null>(initialProject?.meta ?? null);
  const [typography, setTypography] = useState<Typography>(initialProject?.typography ?? {});
  const [selectedId, setSelectedId] = useState<string | null>(initialSection?.id ?? null);
  const [sectionRevision, setSectionRevision] = useState(0);
  const [document, setDocument] = useState<SectionDocument | null>(null);
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("kindle-6-8");
  const [previewDraft, setPreviewDraft] = useState("");
  const [pastePreparing, setPastePreparing] = useState(false);
  const [uiTone, setUiTone] = useState<UiTone>(() => window.localStorage.getItem("folio-ui-tone") === "midnight" ? "midnight" : "ivory");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(() => window.localStorage.getItem("folio-workspace-mode") === "write" ? "write" : "format");
  const [splitView, setSplitView] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [typewriterMode, setTypewriterMode] = useState(false);
  const [writeSidebarOpen, setWriteSidebarOpen] = useState(false);
  const [spellcheckEnabled, setSpellcheckEnabled] = useState(() => window.localStorage.getItem("folio-spellcheck-enabled") !== "false");
  const [exportDirectory, setExportDirectory] = useState(() => window.localStorage.getItem("folio-export-directory") ?? "");
  const [printOptions, setPrintOptions] = useState<PrintOptions>(defaultPrint);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showStyle, setShowStyle] = useState(false);
  const [showContent, setShowContent] = useState(false);
  const [showBookDetails, setShowBookDetails] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewBook, setShowNewBook] = useState(false);
  const [newBookForm, setNewBookForm] = useState({ path: "", title: "", author: "" });
  const [contentTitle, setContentTitle] = useState("New Chapter");
  const [styleCategory, setStyleCategory] = useState<StyleCategory>("Book Style");
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [coverVersion, setCoverVersion] = useState(0);
  const [draggedChapterId, setDraggedChapterId] = useState<string | null>(null);
  const [exportState, setExportState] = useState<{ busy: string | null; result: ExportResult | null; error: string | null }>({ busy: null, result: null, error: null });
  const editorRef = useRef<HTMLDivElement>(null);
  const illustrationInputRef = useRef<HTMLInputElement>(null);
  const illustrationRangeRef = useRef<Range | null>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const previewStageRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  const selectedRef = useRef(selectedId);
  const undoRef = useRef<string[]>([]);
  const redoRef = useRef<string[]>([]);
  const previewIdentityRef = useRef("");
  const pendingPreviewIdentityRef = useRef("");
  const pendingPreviewDraftRef = useRef("");
  const pendingPreviewScrollRef = useRef(0);
  const editorDomDirtyRef = useRef(false);
  const editorDomGenerationRef = useRef(0);
  const editorSyncTimerRef = useRef<number | null>(null);
  const sectionSaveQueueRef = useRef(new SerialSaveQueue<string>());
  const appearanceSaveQueueRef = useRef(new SerialSaveQueue<string>());
  const splitFlushRef = useRef<(() => Promise<boolean>) | null>(null);
  const fastInputBurstRef = useRef(false);
  const fastInputBurstTimerRef = useRef<number | null>(null);
  const draftWordCountCacheRef = useRef<{ text: string; count: number }>({ text: "", count: 0 });
  // Tracks the exact Markdown already represented by the live iframe section.
  // Large append-only typing can then patch the tail paragraph instead of
  // reparsing and replacing thousands of unchanged paragraphs.
  const livePreviewDraftRef = useRef("");
  const fastPreviewComposeTimerRef = useRef<number | null>(null);
  const pendingPreviewWordRef = useRef<{ ordinal: number } | null>(null);
  const previewHighlightTimerRef = useRef<number | null>(null);

  const resetDocumentView = () => {
    draftRef.current = "";
    selectedRef.current = null;
    undoRef.current = [];
    redoRef.current = [];
    setDocument(null);
    setDraft("");
    setPreviewDraft("");
    livePreviewDraftRef.current = "";
    pendingPreviewDraftRef.current = "";
    editorDomDirtyRef.current = false;
    editorDomGenerationRef.current++;
    if (editorSyncTimerRef.current !== null) { window.clearTimeout(editorSyncTimerRef.current); editorSyncTimerRef.current = null; }
    setDirty(false);
    setSaveState("idle");
    // Tear down the lazy compositor before the iframe is discarded. Otherwise
    // an observer from a 100k-word manuscript can keep scheduling composition
    // work after another project is opened and starve the first new preview.
    const livePreviewDocument = previewRef.current?.contentDocument;
    if (livePreviewDocument) void composePreviewDocument(livePreviewDocument, false);
    setPreviewHtml("");
    livePreviewDraftRef.current = "";
    if (fastPreviewComposeTimerRef.current !== null) {
      window.clearTimeout(fastPreviewComposeTimerRef.current);
      fastPreviewComposeTimerRef.current = null;
    }
    previewIdentityRef.current = "";
    pendingPreviewIdentityRef.current = "";
    pendingPreviewScrollRef.current = 0;
    pendingPreviewWordRef.current = null;
    if (previewHighlightTimerRef.current !== null) {
      window.clearTimeout(previewHighlightTimerRef.current);
      previewHighlightTimerRef.current = null;
    }
    setPreviewError(null);
    setPreviewLoading(false);
  };

  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
  useEffect(() => {
    fastInputBurstRef.current = false;
    if (fastInputBurstTimerRef.current !== null) {
      window.clearTimeout(fastInputBurstTimerRef.current);
      fastInputBurstTimerRef.current = null;
    }
  }, [selectedId]);
  useEffect(() => { window.localStorage.setItem("folio-ui-tone", uiTone); }, [uiTone]);
  useEffect(() => { window.localStorage.setItem("folio-workspace-mode", workspaceMode); }, [workspaceMode]);
  useEffect(() => { window.localStorage.setItem("folio-spellcheck-enabled", spellcheckEnabled ? "true" : "false"); }, [spellcheckEnabled]);
  useEffect(() => { window.localStorage.setItem("folio-export-directory", exportDirectory); }, [exportDirectory]);
  useEffect(() => {
    if (!focusMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowSearch(false);
      setFocusMode(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusMode]);
  useEffect(() => {
    if (workspaceMode !== "write" || !typewriterMode) return;
    scheduleTypewriterCaret(editorRef.current);
  }, [workspaceMode, typewriterMode, focusMode, splitView, writeSidebarOpen, selectedId]);
  useEffect(() => {
    if (draft.length < 35_000) { setPreviewDraft(draft); return; }
    const delay = draft.length > 250_000 ? 460 : draft.length > 100_000 ? 300 : 150;
    const timer = window.setTimeout(() => setPreviewDraft(draft), delay);
    return () => window.clearTimeout(timer);
  }, [draft]);
  useEffect(() => {
    const editor = editorRef.current;
    const ornament = typography.sceneOrnament ?? themes.find((theme) => theme.name === meta?.theme)?.sceneOrnament ?? "❦";
    if (!editor || !document || (editor.dataset.markdown === draft && editor.dataset.ornament === ornament)) return;
    editor.innerHTML = document.editable
      ? markdownToEditorHtml(draft, ornament, (asset) => project ? `/api/projects/${encodeURIComponent(project.projectId)}/asset?path=${encodeURIComponent(asset)}` : asset)
      : generatedMatterToEditorHtml(draft);
    editor.dataset.markdown = draft;
    editor.dataset.ornament = ornament;
  }, [document?.id, draft, typography.sceneOrnament, meta?.theme, themes, project?.projectId]);
  useEffect(() => {
    Promise.all([api.themes(), api.matterTypes()])
      .then(([loadedThemes, loadedMatter]) => { setThemes(loadedThemes); setMatterTypes(loadedMatter); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    if (initialProject) return;
    const params = new URLSearchParams(window.location.search);
    const bookPath = params.get("book")?.trim();
    if (bookPath) void openFolder(bookPath);
    else if (params.get("sample") === "1") void loadSample();
  }, []);

  // Appearance is project data too. Persist it after a short quiet period so
  // adding, renaming or moving content can never revive an older style snapshot.
  useEffect(() => {
    if (!project || !meta) return;
    const projectId = project.projectId;
    const appearanceMeta = { ...project.meta, theme: meta.theme };
    const timer = window.setTimeout(async () => {
      try {
        await persistAppearance(projectId, appearanceMeta, typography);
      } catch (e) {
        if (project?.projectId === projectId) setError(e instanceof Error ? e.message : String(e));
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [project?.projectId, meta?.theme, typography]);

  const chapters = useMemo(() => project?.sections.filter((s) => s.kind === "chapter") ?? [], [project]);
  const frontMatter = useMemo(() => project?.sections.filter((s) => s.kind !== "chapter" && s.kind !== "backmatter") ?? [], [project]);
  const backMatter = useMemo(() => project?.sections.filter((s) => s.kind === "backmatter") ?? [], [project]);
  const selectedSection = project?.sections.find((s) => s.id === selectedId) ?? null;
  const coverSelected = selectedId === COVER_ID;
  const previewProfile = getPreviewProfile(previewMode);
  const chapterIndex = selectedSection?.kind === "chapter" ? chapters.findIndex((s) => s.id === selectedSection.id) + 1 : null;
  const writingOrnament = typography.sceneOrnament ?? themes.find((theme) => theme.name === meta?.theme)?.sceneOrnament ?? "❦";
  const draftWords = useMemo(() => {
    const cached = draftWordCountCacheRef.current;
    if (draft === cached.text) return cached.count;

    const appendLength = draft.length - cached.text.length;
    let count: number;
    if (cached.text.length > 0 && appendLength >= 0 && appendLength <= 2048 && draft.startsWith(cached.text)) {
      // Huge-manuscript fast typing is append-only. Count only whitespace ->
      // non-whitespace transitions in the appended tail instead of allocating a
      // 100k-entry regex result array for every single keystroke.
      count = cached.count;
      let previousNonWhitespace = /\S/.test(cached.text.slice(-1));
      for (let index = cached.text.length; index < draft.length; index++) {
        const currentNonWhitespace = !/\s/.test(draft[index]);
        if (currentNonWhitespace && !previousNonWhitespace) count++;
        previousNonWhitespace = currentNonWhitespace;
      }
    } else {
      count = wordCount(draft);
    }
    draftWordCountCacheRef.current = { text: draft, count };
    return count;
  }, [draft]);
  const totalWords = useMemo(() => project ? Math.max(draftWords, Math.round(project.bodyChars / 5.1)) : 0, [project, draftWords]);

  useEffect(() => {
    if (!project || !selectedId || selectedId === COVER_ID) return;
    // Renaming can change a chapter slug/id. updateCurrentChapterHeading already
    // holds the authoritative renamed document, so keep that editor mounted
    // instead of clearing it and fetching the same manuscript again.
    if (document?.id === selectedId) return;
    let cancelled = false;
    setDocument(null);
    setSaveState("idle");
    api.section(project.projectId, selectedId).then((doc) => {
      if (cancelled) return;
      undoRef.current = []; redoRef.current = []; draftRef.current = doc.markdown;
      editorDomDirtyRef.current = false; editorDomGenerationRef.current++;
      setDocument(doc); setDraft(doc.markdown); setPreviewDraft(doc.markdown); setDirty(false);
    }).catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => { cancelled = true; };
  }, [project?.projectId, selectedId, sectionRevision, document?.id]);

  useEffect(() => {
    if (workspaceMode === "write" || !project || !meta || !selectedId || selectedId === COVER_ID || document?.id !== selectedId || previewMode === "print") return;
    let cancelled = false;
    const controller = new AbortController();
    setPreviewLoading(true);
    const requestedDraft = draftRef.current;
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.preview(project.projectId, meta, meta.theme, typography, selectedId, requestedDraft, controller.signal);
        if (!cancelled) { commitPreviewHtml(result.html, requestedDraft); setPreviewError(null); }
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
  }, [workspaceMode, project?.projectId, meta, typography, previewMode === "print", selectedId, document?.id, document?.subtitle]);

  useEffect(() => {
    if (workspaceMode === "write" || !project || !meta || !selectedId || selectedId === COVER_ID || document?.id !== selectedId || previewMode !== "print") return;
    let cancelled = false;
    const controller = new AbortController();
    setPreviewLoading(true);
    const requestedDraft = previewDraft;
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.previewPrint(project.projectId, meta, meta.theme, printOptions, typography, selectedId, requestedDraft, controller.signal);
        if (!cancelled) { commitPreviewHtml(result.html, requestedDraft); setPreviewError(null); }
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
  }, [workspaceMode, project?.projectId, meta, typography, previewMode === "print", printOptions, selectedId, document?.id, document?.subtitle, previewDraft]);

  function commitPreviewHtml(html: string, representedDraft: string): void {
    const identity = `${project?.projectId ?? ""}:${selectedId ?? ""}:${previewMode}`;
    const frame = previewRef.current;
    const current = frame?.contentDocument;
    const scrollTop = current?.scrollingElement?.scrollTop ?? 0;
    // Print preview is already paginated static HTML. Replacing its head/body in
    // place can leave the iframe in the previous reader document lifecycle and
    // makes Reader → Print intermittently show no physical pages. Cross the
    // print boundary with a real srcDoc navigation instead.
    const crossesPrintBoundary = previewMode === "print" || frame?.dataset.folioLoadedMode === "print";
    if (current?.head && current.body && !crossesPrintBoundary) {
      const parsed = new DOMParser().parseFromString(html, "text/html");
      current.documentElement.lang = parsed.documentElement.lang;
      current.head.innerHTML = parsed.head.innerHTML;
      for (const attr of Array.from(current.body.attributes)) current.body.removeAttribute(attr.name);
      for (const attr of Array.from(parsed.body.attributes)) current.body.setAttribute(attr.name, attr.value);
      current.body.innerHTML = parsed.body.innerHTML;
      // The incoming server HTML represents the exact draft captured when the
      // request started, not necessarily the draft the user has by the time it
      // returns. Recording that snapshot lets onPreviewLoad patch any newer tail
      // instead of falsely treating stale server HTML as current.
      livePreviewDraftRef.current = representedDraft;
      previewIdentityRef.current = identity;
      pendingPreviewIdentityRef.current = "";
      // Replacing body invalidates compositor markers even when the Markdown snapshot is unchanged.
      // Force a fresh lazy composition pass so a late authoritative response cannot leave new DOM inert.
      onPreviewLoad(scrollTop, false, true);
      return;
    }
    pendingPreviewIdentityRef.current = identity;
    pendingPreviewDraftRef.current = representedDraft;
    pendingPreviewScrollRef.current = scrollTop;
    setPreviewHtml(html);
  }

  function applyLiveDraftToPreview(): "none" | "reused" | "patched" | "rebuilt" {
    // Generated title/copyright pages already have authoritative Pandoc HTML.
    // Re-rendering their internal markup as Markdown exposed literal <p> tags
    // and could add chapter-only typography such as drop caps.
    if (workspaceMode === "write" || previewMode === "print" || !selectedId || selectedId === COVER_ID || document?.id !== selectedId || !document.editable) return "none";
    const previewDocument = previewRef.current?.contentDocument;
    if (!previewDocument) return "none";
    // The editor model is authoritative. previewDraft is deliberately debounced
    // for expensive server/print work and can lag a fresh chapter by one render.
    // Local live preview must never re-apply that stale snapshot after an iframe
    // or server preview refresh.
    const liveDraft = draftRef.current;
    const previewScroller = previewDocument.scrollingElement as HTMLElement | null;
    const preservedScrollTop = previewScroller?.scrollTop ?? 0;
    let section = previewDocument.getElementById(selectedId)
      ?? previewDocument.querySelector("main.book > section.level1, main.book > section.chapter");
    // A newly created/renamed chapter can become editable before the full-book
    // Pandoc request finishes. Seed a minimal semantic page instead of leaving
    // the reader blank; the authoritative HTML replaces it when ready.
    if (!section) {
      const main = previewDocument.querySelector("main.book") ?? previewDocument.createElement("main");
      if (!main.isConnected) { main.className = "book"; previewDocument.body.appendChild(main); }
      const seeded = previewDocument.createElement("section");
      const seededHeading = previewDocument.createElement("h1");
      previewDocument.body.classList.add("book-formatter");
      seeded.id = selectedId;
      seeded.className = `level1 ${document.kind === "chapter" ? "chapter" : document.kind === "backmatter" ? "backmatter" : "frontmatter"}`;
      seededHeading.className = "chapter";
      seeded.appendChild(seededHeading);
      main.appendChild(seeded);
      section = seeded;
    }
    section.id = selectedId;
    syncLiveChapterLabel(previewDocument);
    const heading = Array.from(section.children).find((node) => node.tagName === "H1") ?? null;
    if (heading) heading.textContent = document.title;
    let subtitle = Array.from(section.children).find((node) => node.classList.contains("chapter-subtitle")) ?? null;
    if (document.subtitle) {
      if (!subtitle) {
        const wrapper = previewDocument.createElement("div");
        const paragraph = previewDocument.createElement("p");
        wrapper.className = "chapter-subtitle";
        paragraph.textContent = document.subtitle;
        wrapper.appendChild(paragraph);
        if (heading) heading.after(wrapper); else section.prepend(wrapper);
        subtitle = wrapper;
      } else {
        let paragraph = subtitle.querySelector("p");
        if (!paragraph) { paragraph = previewDocument.createElement("p"); subtitle.appendChild(paragraph); }
        paragraph.textContent = document.subtitle;
      }
    } else {
      subtitle?.remove();
      subtitle = null;
    }

    // For a huge manuscript, normal keyboard typing at the end should not force
    // Folio to serialize -> parse -> replace every unchanged paragraph again.
    // If the new Markdown is a small plain-text append to the draft already
    // represented by this iframe, patch only the final uncomposed paragraph.
    // The paragraph remains under the existing lazy compositor observer, so it
    // receives full professional composition if/when the reader scrolls to it.
    const representedDraft = livePreviewDraftRef.current;
    if (liveDraft.length > 250_000 && representedDraft === liveDraft) {
      if (previewScroller) previewScroller.scrollTop = preservedScrollTop;
      return "reused";
    }
    const appendDelta = liveDraft.length > 250_000
      && representedDraft.length > 0
      && liveDraft.startsWith(representedDraft)
      ? liveDraft.slice(representedDraft.length)
      : "";
    const simpleTailAppend = appendDelta.length > 0
      && appendDelta.length <= 2048
      && !/[\r\n*_`#<>[\]\\]/.test(appendDelta);
    const tail = lastPreviewProse(section);
    if (simpleTailAppend && tail && !tail.classList.contains("folio-composed")) {
      tail.append(previewDocument.createTextNode(appendDelta));
      livePreviewDraftRef.current = liveDraft;
      if (previewScroller) previewScroller.scrollTop = preservedScrollTop;
      return "patched";
    }

    Array.from(section.children).forEach((node) => {
      if (node !== heading && node !== subtitle) node.remove();
    });
    const template = previewDocument.createElement("template");
    const theme = themes.find((item) => item.name === meta?.theme);
    const ornament = typography.sceneOrnament ?? theme?.sceneOrnament ?? "❦";
    template.innerHTML = markdownToPreviewHtml(liveDraft, ornament, (asset) => project ? `/api/projects/${encodeURIComponent(project.projectId)}/asset?path=${encodeURIComponent(asset)}` : asset);
    section.appendChild(template.content);
    livePreviewDraftRef.current = liveDraft;
    if (previewScroller) previewScroller.scrollTop = preservedScrollTop;
    applyDraftDropcap(section, document.kind === "chapter" && (typography.dropcap ?? theme?.dropcap ?? false));
    if (typography.bodyAlign !== "left") hyphenatePreviewDocument(previewDocument, meta?.language || "en");
    void composePreviewDocument(previewDocument, typography.bodyAlign !== "left");
    return "rebuilt";
  }

  // A full-book paste must not wait for Pandoc. Update the already loaded
  // section in the iframe immediately; the authoritative Pandoc render replaces
  // it after the debounce. Re-apply on iframe load too, because a renamed
  // chapter creates a fresh frame whose document may arrive after this effect.
  useEffect(() => {
    const frame = window.requestAnimationFrame(applyLiveDraftToPreview);
    return () => window.cancelAnimationFrame(frame);
  }, [workspaceMode, previewDraft, document?.id, document?.subtitle, selectedId, typography.sceneOrnament, typography.dropcap, typography.bodyAlign, typography.chapterTitle?.showLabel, typography.chapterTitle?.labelText, meta?.theme, meta?.language, themes]);

  useEffect(() => {
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
  }, [dirty, draft, document?.editable, project?.projectId, selectedId]);

  // Device chrome is a client-side view of the same rendered book HTML. Apply
  // its layout even when switching profiles produces byte-identical srcDoc and
  // React therefore has no reason to reload the iframe.
  useEffect(() => {
    if (workspaceMode === "write") return;
    const frame = window.requestAnimationFrame(() => onPreviewLoad(undefined, true));
    return () => window.cancelAnimationFrame(frame);
  }, [workspaceMode, previewMode, previewHtml, printOptions.trim, typography.bodyAlign, typography.chapterTitle?.showLabel, typography.chapterTitle?.labelText, chapterIndex, selectedId]);
  useEffect(() => { previewStageRef.current?.scrollTo(0, 0); }, [selectedId]);

  function adopt(summary: ProjectSummary, preferredId?: string) {
    const sameProject = summary.projectId === project?.projectId;
    const liveMeta = sameProject && meta ? meta : summary.meta;
    const liveTypography = sameProject ? typography : (summary.typography ?? {});
    const displayedSummary = sameProject ? { ...summary, meta: liveMeta, typography: liveTypography } : summary;
    const preferred = preferredId ? summary.sections.find((s) => s.id === preferredId) : null;
    const first = preferred ?? summary.sections.find((s) => s.kind === "chapter") ?? summary.sections[0] ?? null;
    if (summary.projectId !== project?.projectId || first?.id !== selectedId) resetDocumentView();
    setProject(displayedSummary); setMeta(liveMeta); setTypography(liveTypography);
    setSelectedId(first?.id ?? null); setError(null);
    selectedRef.current = first?.id ?? null;
    requestAnimationFrame(() => {
      editorRef.current?.scrollTo(0, 0);
      previewStageRef.current?.scrollTo(0, 0);
    });
  }

  async function openFolder(projectPath?: string) {
    if (project && !(await saveCurrent())) return;
    setBusy(true); setError(null);
    try {
      const selected = projectPath ?? (await api.pickProjectFile("open", project?.projectFile ?? undefined)).path;
      if (!selected) return;
      const previousId = project?.projectId ?? null;
      const summary = await api.openProjectFile(selected);
      if (previousId && previousId !== summary.projectId) await api.closeProject(previousId);
      adopt(summary);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function loadSample() {
    if (project && !(await saveCurrent())) return;
    setBusy(true); setError(null);
    try {
      const previousId = project?.projectId ?? null;
      const summary = await api.loadSample();
      if (previousId && previousId !== summary.projectId) await api.closeProject(previousId);
      adopt(summary);
    }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function beginNewBook() {
    if (project && !(await saveCurrent())) return;
    setBusy(true); setError(null);
    try {
      const selected = (await api.pickProjectFile("save", undefined, "Untitled.folio")).path;
      if (!selected) return;
      const filename = selected.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "Untitled.folio";
      const guessed = filename.replace(/\.folio$/i, "") || "Untitled";
      setNewBookForm({ path: selected, title: guessed, author: "" });
      setShowNewBook(true);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function createNewBook() {
    if (!newBookForm.path.trim()) return;
    setBusy(true); setError(null);
    try {
      const previousId = project?.projectId ?? null;
      const summary = await api.newBook(newBookForm.path, newBookForm.title, newBookForm.author);
      if (previousId && previousId !== summary.projectId) await api.closeProject(previousId);
      adopt(summary);
      setShowNewBook(false);
      setShowBookDetails(true);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function returnToDashboard() {
    if (!(await saveCurrent())) return;
    setBusy(true); setError(null);
    try {
      if (project && meta) await persistAppearance(project.projectId, meta, typography);
      await sectionSaveQueueRef.current.flush();
      await appearanceSaveQueueRef.current.flush();
      if (project) await api.closeProject(project.projectId);
      onDashboard?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function addChapter() {
    if (!project || !meta || !(await saveCurrent())) return;
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

  async function reorderChapters(order: string[]) {
    if (!project || order.join("\0") === chapters.map((chapter) => chapter.id).join("\0") || !(await saveCurrent())) return;
    const previous = project;
    const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    let chapterCursor = 0;
    setProject({
      ...project,
      sections: project.sections.map((section) => section.kind === "chapter" ? byId.get(order[chapterCursor++])! : section),
    });
    // The contents list commits on the next frame. Synchronize the existing
    // iframe immediately afterwards as well as through the regular effects, so
    // a late preview load cannot restore the chapter's former label number.
    requestAnimationFrame(() => {
      const doc = previewRef.current?.contentDocument;
      if (doc) syncLiveChapterLabel(doc);
    });
    setBusy(true); setError(null);
    try {
      const updated = await api.reorderChapters(project.projectId, order);
      setProject({ ...updated, meta: meta ?? updated.meta, typography });
    } catch (e) {
      setProject(previous);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function moveChapter(id: string, delta: number) {
    const order = chapters.map((chapter) => chapter.id);
    const from = order.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    void reorderChapters(order);
  }

  function dropChapter(targetId: string) {
    if (!draggedChapterId || draggedChapterId === targetId) return setDraggedChapterId(null);
    const order = chapters.map((chapter) => chapter.id);
    const from = order.indexOf(draggedChapterId);
    const to = order.indexOf(targetId);
    if (from >= 0 && to >= 0) {
      order.splice(to, 0, order.splice(from, 1)[0]);
      void reorderChapters(order);
    }
    setDraggedChapterId(null);
  }

  async function addMatterSection(type: MatterType) {
    if (!project || !meta || !(await saveCurrent())) return;
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

  async function addImagePage(file: File) {
    if (!project || !meta || !(await saveCurrent())) return;
    const title = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Map";
    const before = new Set(project.sections.map((section) => section.id));
    setBusy(true); setError(null);
    try {
      await api.addImagePage(project.projectId, file, title, title, "contain");
      const summary = await api.reload(project.projectId);
      const created = summary.sections.find((section) => !before.has(section.id));
      adopt(summary, created?.id);
      setShowContent(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function deleteCurrentSection() {
    if (!project || !selectedId || !selectedSection) return;
    const recoverable = !(["titlepage", "copyright"] as string[]).includes(selectedSection.kind);
    if (!window.confirm(`Delete “${selectedSection.title}”?${recoverable ? "\n\nFolio will move the source to .folio-trash so it can be recovered." : ""}`)) return;
    const currentIndex = project.sections.findIndex((section) => section.id === selectedId);
    setBusy(true); setError(null); resetDocumentView(); setSelectedId(null);
    try {
      await api.deleteSection(project.projectId, selectedId);
      const summary = await api.reload(project.projectId);
      const fallback = summary.sections[Math.min(Math.max(currentIndex, 0), Math.max(summary.sections.length - 1, 0))];
      adopt(summary, fallback?.id);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function updateCurrentChapterHeading(change: { title?: string; subtitle?: string }) {
    if (!project || !selectedId || selectedSection?.kind !== "chapter") return;
    const previousDocument = document;
    const title = change.title?.trim();
    const subtitle = change.subtitle?.trim() ?? "";
    if (change.title !== undefined && (!title || title === selectedSection.title)) return;
    if (change.subtitle !== undefined && subtitle === (document?.subtitle ?? "")) return;
    if (!(await saveCurrent())) return;
    const draftAtStart = draftRef.current;
    // Subtitle rendering is a local composition change and must stay instant
    // even when rewriting/re-ingesting a 100,000-word source takes seconds.
    if (change.subtitle !== undefined && document) {
      setDocument({ ...document, subtitle: subtitle || undefined });
    }
    setBusy(true); setError(null);
    try {
      const updated = await api.updateSectionHeading(project.projectId, selectedId, {
        ...(change.title !== undefined ? { title } : {}),
        ...(change.subtitle !== undefined ? { subtitle } : {}),
      });
      await flushEditorDom();
      const liveDraft = draftRef.current;
      const draftChangedDuringSave = liveDraft !== draftAtStart;
      if (updated.id !== selectedId) { undoRef.current = []; redoRef.current = []; }
      // updateSectionHeading already re-ingests the authoritative source. A
      // second full-project reload made large books pause and briefly removed
      // the editor after every rename. Update only the summary row that changed.
      const renamedSummary: ProjectSummary = {
        ...project,
        sections: project.sections.map((section) => section.id === selectedId
          ? { ...section, id: updated.id, title: updated.title }
          : section),
        meta: meta ?? project.meta,
        typography,
      };
      setProject(renamedSummary);
      setMeta(meta ?? project.meta);
      setTypography(typography);
      setSelectedId(updated.id);
      selectedRef.current = updated.id;
      setDocument(draftChangedDuringSave ? { ...updated, markdown: liveDraft } : updated);
      if (!draftChangedDuringSave) {
        setDraft(updated.markdown);
        draftRef.current = updated.markdown;
      }
      setDirty(draftChangedDuringSave);
      setSaveState(draftChangedDuringSave ? "saving" : "saved");
      setPreviewError(null);
    } catch (e) {
      if (change.subtitle !== undefined && selectedRef.current === selectedId) setDocument(previousDocument);
      setError(e instanceof Error ? e.message : String(e));
    }
    finally { setBusy(false); }
  }

  function rememberIllustrationCaret() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount || !selection.anchorNode || !editor.contains(selection.anchorNode)) {
      illustrationRangeRef.current = null;
      return;
    }
    illustrationRangeRef.current = selection.getRangeAt(0).cloneRange();
  }

  async function insertIllustration(file: File) {
    if (!project || !document?.editable || document.id !== selectedSection?.id) return;
    const targetSectionId = selectedSection.id;
    if (!editorRef.current) return;
    setBusy(true); setError(null);
    try {
      const uploaded = await api.uploadIllustration(project.projectId, file);
      if (selectedRef.current !== targetSectionId) throw new Error("The illustration target changed while the image was uploading. Select the target section and insert it again.");
      const editor = editorRef.current;
      if (!editor) throw new Error("The editor is still loading. Try inserting the illustration again.");
      const alt = "Illustration";
      const figure = window.document.createElement("figure");
      figure.className = "editor-illustration";
      figure.setAttribute("data-folio-illustration", "true");
      figure.dataset.folioScale = "42";
      figure.dataset.folioCrop = "false";
      figure.dataset.folioRatio = "4-3";
      figure.dataset.folioX = "50";
      figure.dataset.folioY = "50";
      figure.dataset.folioWrap = "right";
      figure.contentEditable = "false";
      const image = window.document.createElement("img");
      image.src = uploaded.url;
      image.alt = alt;
      image.dataset.folioAsset = uploaded.asset;
      const remove = window.document.createElement("button");
      remove.type = "button";
      remove.className = "editor-illustration-remove";
      remove.setAttribute("aria-label", "Remove illustration");
      remove.title = "Remove illustration";
      remove.textContent = "×";
      figure.append(image, remove);

      const savedRange = illustrationRangeRef.current;
      let anchor: HTMLElement | null = null;
      let insertAfter = false;
      if (savedRange && editor.contains(savedRange.commonAncestorContainer)) {
        const rawNode = savedRange.startContainer;
        const element = rawNode.nodeType === Node.ELEMENT_NODE
          ? rawNode as Element
          : rawNode.parentElement;
        anchor = element?.closest<HTMLElement>("p,h1,h2,h3,h4,h5,h6,blockquote,ul,ol,.editor-scene-break,.editor-illustration") ?? null;
        if (anchor && editor.contains(anchor)) {
          const caretRect = savedRange.getBoundingClientRect();
          const anchorRect = anchor.getBoundingClientRect();
          if (caretRect.height || caretRect.width) insertAfter = caretRect.top >= anchorRect.top + anchorRect.height / 2;
        } else {
          anchor = null;
        }
      }

      if (anchor) {
        if (insertAfter) anchor.insertAdjacentElement("afterend", figure);
        else editor.insertBefore(figure, anchor);
      } else {
        editor.appendChild(figure);
      }
      illustrationRangeRef.current = null;

      // Commit the anchored illustration synchronously from the live editor DOM.
      // The generic editor input queue is deliberately lazy for huge chapters;
      // using it for an uploaded image created a window where React could swap
      // sections before the figure reached the draft. Image insertion is a
      // discrete publishing action, so make the Markdown authoritative now.
      const nextMarkdown = richTextToMarkdown(editor.innerHTML);
      editor.dataset.markdown = nextMarkdown;
      editorDomDirtyRef.current = false;
      editorDomGenerationRef.current++;
      recordDraft(nextMarkdown);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (illustrationInputRef.current) illustrationInputRef.current.value = "";
    }
  }

  async function uploadCover(file: File) {
    if (!project) return;
    setBusy(true); setError(null);
    try {
      const summary = await api.updateCover(project.projectId, file);
      setProject(summary); setMeta(summary.meta); setCoverVersion((value) => value + 1);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function persistSection(projectId: string, sectionId: string, value: string): Promise<SectionDocument> {
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

  async function saveBookDetails() {
    if (!project || !meta || !(await saveCurrent())) return;
    setSaveState("saving");
    try {
      const summary = await persistAppearance(project.projectId, meta, typography);
      adopt(summary, selectedId ?? undefined);
      setShowBookDetails(false);
      setSaveState("saved");
    } catch (e) { setSaveState("error"); setError(e instanceof Error ? e.message : String(e)); }
  }

  async function flushSplitEditor(): Promise<boolean> {
    const flush = splitFlushRef.current;
    return flush ? flush() : true;
  }

  async function changeWorkspaceMode(next: WorkspaceMode) {
    if (next === workspaceMode) return;
    if (next === "format" && splitView) {
      if (!(await flushSplitEditor())) return;
      setSplitView(false);
    }
    if (next === "format" && focusMode) setFocusMode(false);
    if (next === "format") setWriteSidebarOpen(true);
    if (next === "write" && workspaceMode !== "write") setWriteSidebarOpen(false);
    setWorkspaceMode(next);
  }

  async function toggleSplitView() {
    if (splitView) {
      if (await flushSplitEditor()) setSplitView(false);
      return;
    }
    setSplitView(true);
  }

  async function saveCurrent(): Promise<boolean> {
    if (!document?.editable || !project || !selectedId) return flushSplitEditor();
    await flushEditorDom();
    if (draftRef.current === document.markdown) {
      setDirty(false);
      return flushSplitEditor();
    }
    const sectionId = selectedId;
    const value = draftRef.current;
    setSaveState("saving");
    try {
      const saved = await persistSection(project.projectId, sectionId, value);
      if (selectedRef.current === sectionId && draftRef.current === value && !editorDomDirtyRef.current) {
        setDocument(saved); setDirty(false); setSaveState("saved");
      }
      return flushSplitEditor();
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
        if (project) await api.flushProject(project.projectId);
        return true;
      } catch (e) {
        setSaveState("error"); setError(e instanceof Error ? e.message : String(e));
        return false;
      }
    };
    return () => { delete host.__folioPrepareClose; };
  }, [project?.projectId, selectedId, document?.id, document?.editable, meta, typography]);

  async function reloadFiles() {
    if (!project || !(await saveCurrent())) return;
    const currentId = selectedId;
    setBusy(true); setError(null);
    try {
      const summary = await api.reload(project.projectId);
      const selected = summary.sections.find((section) => section.id === currentId)
        ?? summary.sections.find((section) => section.kind === "chapter")
        ?? summary.sections[0]
        ?? null;
      resetDocumentView();
      setProject(summary); setMeta(summary.meta); setTypography(summary.typography ?? {});
      setSelectedId(selected?.id ?? null);
      selectedRef.current = selected?.id ?? null;
      setSectionRevision((value) => value + 1);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function selectSection(nextId: string) {
    if (nextId === selectedId) return;
    if (await saveCurrent()) {
      resetDocumentView();
      selectedRef.current = nextId;
      setSelectedId(nextId);
    }
  }

  const navigationIds = project ? [COVER_ID, ...project.sections.map((section) => section.id)] : [];
  const selectedPosition = selectedId ? navigationIds.indexOf(selectedId) : -1;
  const previousId = selectedPosition > 0 ? navigationIds[selectedPosition - 1] : null;
  const nextId = selectedPosition >= 0 && selectedPosition < navigationIds.length - 1
    ? navigationIds[selectedPosition + 1]
    : null;

  function lexicalWordMatches(value: string): RegExpMatchArray[] {
    return Array.from(value.matchAll(/[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*/gu));
  }

  function editorCaretWordOrdinal(): number | null {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.focusNode || !editor.contains(selection.focusNode)) return null;
    const before = window.document.createRange();
    before.selectNodeContents(editor);
    try { before.setEnd(selection.focusNode, selection.focusOffset); }
    catch { return null; }
    const text = before.toString().replace(/\u00ad/g, "");
    const matches = lexicalWordMatches(text);
    const previousEndsAtCaret = matches.length > 0
      && (matches.at(-1)?.index ?? -1) + (matches.at(-1)?.[0].length ?? 0) === text.length;
    if (previousEndsAtCaret) return matches.length - 1;

    const focus = selection.focusNode;
    const next = focus.nodeType === Node.TEXT_NODE
      ? (focus as Text).data.slice(selection.focusOffset, selection.focusOffset + 1)
      : "";
    if (/[\p{L}\p{N}]/u.test(next)) return matches.length;
    return matches.length ? matches.length - 1 : null;
  }

  function mappedRangesForText(block: HTMLElement): Range[] {
    const doc = block.ownerDocument;
    const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        return parent && !parent.closest("script,style,.scene-break") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const mapping: Array<{ node: Text; offset: number }> = [];
    let text = "";
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      for (let index = 0; index < node.data.length; index++) {
        const char = node.data[index];
        if (char === "\u00ad" || char === "\u200b" || char === "\ufeff") continue;
        text += char;
        mapping.push({ node, offset: index });
      }
    }
    const ranges: Range[] = [];
    for (const match of lexicalWordMatches(text)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const first = mapping[start];
      const last = mapping[end - 1];
      if (!first || !last) continue;
      const range = doc.createRange();
      range.setStart(first.node, first.offset);
      range.setEnd(last.node, last.offset + 1);
      ranges.push(range);
    }
    return ranges;
  }

  function composedRangesForText(block: HTMLElement): Range[] {
    const doc = block.ownerDocument;
    const tokens = Array.from(block.querySelectorAll<HTMLElement>(".folio-word"));
    if (!tokens.length) return mappedRangesForText(block);
    const groups: HTMLElement[][] = [];
    let group: HTMLElement[] = [];
    for (const token of tokens) {
      if (group.length && token.dataset.folioSpaceBefore === "true") {
        groups.push(group);
        group = [];
      }
      group.push(token);
    }
    if (group.length) groups.push(group);

    const ranges: Range[] = [];
    for (const tokenGroup of groups) {
      const mapping: Array<{ node: Text; offset: number }> = [];
      let text = "";
      for (const token of tokenGroup) {
        const walker = doc.createTreeWalker(token, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          for (let index = 0; index < node.data.length; index++) {
            const char = node.data[index];
            if (char === "\u00ad" || char === "\u200b" || char === "\ufeff") continue;
            text += char;
            mapping.push({ node, offset: index });
          }
        }
      }
      for (const match of lexicalWordMatches(text)) {
        const start = match.index ?? 0;
        const end = start + match[0].length;
        const first = mapping[start];
        const last = mapping[end - 1];
        if (!first || !last) continue;
        const range = doc.createRange();
        range.setStart(first.node, first.offset);
        range.setEnd(last.node, last.offset + 1);
        ranges.push(range);
      }
    }
    return ranges;
  }

  function previewRangeAtWord(ordinal: number): Range[] | null {
    const doc = previewRef.current?.contentDocument;
    if (!doc || !selectedId || ordinal < 0) return null;
    const pagedSection = previewMode === "print"
      ? Array.from(doc.querySelectorAll<HTMLElement>(".pagedjs_page section")).find((candidate) => candidate.id === selectedId) ?? null
      : null;
    const section = pagedSection ?? doc.getElementById(selectedId)
      ?? doc.querySelector<HTMLElement>("main.book > section.level1, main.book > section.chapter, main.book > section.backmatter");
    if (!section) return null;
    const blocks = Array.from(section.querySelectorAll<HTMLElement>("p:not(.scene-break),li,h2,h3,h4,h5,h6"))
      .filter((block) => !block.closest(".chapter-subtitle,.scene-break") && !(block.tagName === "P" && block.closest("li")));
    let cursor = ordinal;
    for (const block of blocks) {
      const ranges = block.classList.contains("folio-composed") || block.querySelector(".folio-word")
        ? composedRangesForText(block)
        : mappedRangesForText(block);
      if (cursor < ranges.length) return [ranges[cursor]];
      cursor -= ranges.length;
    }
    return null;
  }

  function clearPreviewHighlight(doc?: Document | null) {
    const view = doc?.defaultView as (Window & { Highlight?: new (...ranges: Range[]) => unknown; CSS?: { highlights?: { set(name: string, value: unknown): void; delete(name: string): boolean } } }) | null;
    const registry = (view?.CSS as unknown as { highlights?: { delete(name: string): boolean } } | undefined)?.highlights;
    registry?.delete("folio-editor-word");
  }

  function highlightPreviewWord(target: { ordinal: number }): boolean {
    const frame = previewRef.current;
    const doc = frame?.contentDocument;
    const ranges = doc ? previewRangeAtWord(target.ordinal) : null;
    if (!frame || !doc?.head || !ranges?.length) return false;
    const view = doc.defaultView as (Window & { Highlight?: new (...ranges: Range[]) => unknown; CSS?: { highlights?: { set(name: string, value: unknown): void; delete(name: string): boolean } } }) | null;
    const registry = (view?.CSS as unknown as { highlights?: { set(name: string, value: unknown): void; delete(name: string): boolean } } | undefined)?.highlights;
    const HighlightCtor = view?.Highlight;
    if (!registry || !HighlightCtor) return false;

    let style = doc.getElementById("folio-editor-word-highlight") as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement("style");
      style.id = "folio-editor-word-highlight";
      style.textContent = "::highlight(folio-editor-word){background:rgba(208,162,74,.62);text-decoration:underline rgba(112,76,25,.55) 1px}";
      doc.head.appendChild(style);
    }
    registry.delete("folio-editor-word");
    registry.set("folio-editor-word", new HighlightCtor(...ranges));
    pendingPreviewWordRef.current = null;

    const range = ranges[0];
    const anchor = range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer as HTMLElement;
    anchor?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });

    if (previewHighlightTimerRef.current !== null) window.clearTimeout(previewHighlightTimerRef.current);
    previewHighlightTimerRef.current = window.setTimeout(() => {
      clearPreviewHighlight(previewRef.current?.contentDocument);
      previewHighlightTimerRef.current = null;
    }, 1050);
    return true;
  }

  function syncEditorClickToPreview() {
    const ordinal = editorCaretWordOrdinal();
    if (ordinal === null) return;
    const target = { ordinal };
    pendingPreviewWordRef.current = target;
    highlightPreviewWord(target);
  }

  function syncLiveChapterLabel(doc: Document) {
    doc.getElementById("folio-live-chapter-label")?.remove();
    if (!selectedId || selectedSection?.kind !== "chapter") return;
    const chapterTitle = typography.chapterTitle;
    if (chapterTitle?.showLabel !== false && !chapterTitle?.labelText?.trim()) return;
    const section = doc.getElementById(selectedId);
    const heading = section?.querySelector(":scope > h1") as HTMLElement | null;
    const visibleNumber = [...window.document.querySelectorAll(".contents-row.chapter-row")]
      .findIndex((row) => row.classList.contains("selected")) + 1;
    const modelNumber = chapters.findIndex((chapter) => chapter.id === selectedId) + 1;
    const number = visibleNumber || modelNumber;
    if (heading && chapterTitle?.showLabel !== false) {
      heading.dataset.folioLabel = `${chapterTitle!.labelText!.trim()} ${Math.max(1, number)}`;
    }
    const style = doc.createElement("style");
    style.id = "folio-live-chapter-label";
    const content = chapterTitle?.showLabel === false
      ? "none"
      : "attr(data-folio-label)";
    style.textContent = `section.chapter[id=${JSON.stringify(selectedId)}] > h1::before{content:${content}!important;${content === "none" ? "display:none!important;" : "display:block;"}}`;
    doc.head.appendChild(style);
  }

  function onPreviewLoad(restoreScroll?: number, geometryOnly = false, forceRecompose = false) {
    const frame = previewRef.current;
    const doc = frame?.contentDocument;
    if (!doc?.head || !frame) return;
    frame.dataset.folioLoadedMode = previewMode;
    doc.getElementById("folio-device-profile")?.remove();
    const style = doc.createElement("style");
    style.id = "folio-device-profile";
    if (previewMode === "print") {
      doc.getElementById("folio-device-calibration")?.remove();
      const page = doc.querySelector(".pagedjs_page") as HTMLElement | null;
      const width = Math.max(1, page?.getBoundingClientRect().width || 576);
      const available = Math.max(320, frame.clientWidth || previewStageRef.current?.clientWidth || 576);
      const scale = Math.max(.35, Math.min(1, (available - 28) / width));
      style.textContent = `html,body{background:#e9edf2!important}.pagedjs_pages{zoom:${scale};transform:none!important;width:max-content!important;min-width:100%!important;margin:0 auto!important;padding:8px 0 24px!important}.pagedjs_page{margin:10px auto!important}`;
    } else {
      const proseSelector = "body.book-formatter main.book section.chapter>p:not(.scene-break),body.book-formatter main.book section.chapter>blockquote p,body.book-formatter main.book section.chapter li,body.book-formatter main.book section.backmatter>p:not(.scene-break),body.book-formatter main.book section.backmatter li";
      const proseComposition = typography.bodyAlign === "left"
        ? `${proseSelector}{margin-right:0!important;text-align:left!important;text-align-last:left!important;-webkit-hyphens:none!important;hyphens:none!important;text-wrap:pretty!important}`
        : `${proseSelector}{margin-right:0!important;text-align:left!important;text-align-last:left!important;-webkit-hyphens:manual!important;hyphens:manual!important;overflow-wrap:normal!important;word-break:normal!important;word-spacing:normal!important;letter-spacing:normal!important}`;
      style.textContent = "html,body{min-height:100%!important}body{margin:0!important;padding:0!important}main.book{max-width:none!important;margin:0!important;box-sizing:border-box!important}section.level1{display:block!important;margin:0!important;border:0!important;padding:0!important;break-before:auto!important;page-break-before:auto!important}section.chapter>h1,h1.chapter{margin-top:12px!important}.folio-composed{text-indent:0!important}.folio-composed-line{display:block;white-space:nowrap;text-indent:0}.folio-line-justified,.folio-line-natural{text-align:left!important;text-align-last:left!important}.scene-break{text-align:center!important;text-align-last:center!important;word-spacing:normal!important;letter-spacing:normal!important}" + proseComposition;
    }
    doc.head.appendChild(style);
    const calibrationChanged = previewMode !== "print" ? calibratePreviewFrame(frame) : false;
    if (pendingPreviewDraftRef.current) {
      livePreviewDraftRef.current = pendingPreviewDraftRef.current;
      pendingPreviewDraftRef.current = "";
    }
    const compositionMode = typography.bodyAlign === "left" ? "left" : "justify";
    const compositionModeChanged = frame.dataset.folioCompositionMode !== compositionMode;
    frame.dataset.folioCompositionMode = compositionMode;
    syncLiveChapterLabel(doc);
    // Device/profile changes are geometry-only. Never let a transient debounce
    // difference between draft and previewDraft turn a reader switch into a
    // 5,200-paragraph content rebuild. Authoritative iframe loads still apply
    // the live draft through the normal content path.
    const liveApply = geometryOnly ? "reused" as const : applyLiveDraftToPreview();
    if (previewMode !== "print" && liveApply === "none") {
      if (typography.bodyAlign !== "left") hyphenatePreviewDocument(doc, meta?.language || "en");
      void composePreviewDocument(doc, typography.bodyAlign !== "left");
    } else if (previewMode !== "print"
      && liveApply !== "rebuilt"
      && (forceRecompose || geometryOnly || calibrationChanged || compositionModeChanged)) {
      // The content is already current. Geometry/alignment changes only need a
      // new lazy composition pass; composeParagraph hyphenates each paragraph
      // as it becomes visible. Re-hyphenating an entire 100k-word book here
      // would block Windows for tens of seconds before line one can render.
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
      // A profile switch already operates on the live iframe. Do not enqueue a
      // stale numeric scroll restoration that can fire after the reader has
      // clicked or scrolled to a new location in the same frame.
      if (!geometryOnly || typeof restoreScroll === "number") {
        doc.scrollingElement?.scrollTo(0, targetScroll);
      }
      updatePreviewPageCounts(frame);
      const pendingWord = pendingPreviewWordRef.current;
      if (pendingWord) window.setTimeout(() => highlightPreviewWord(pendingWord), 70);
    });
  }

  function applyInlineFormat(command: "bold" | "italic" | "underline" | "strikeThrough", placeholder: string) {
    const el = editorRef.current;
    if (!el || !document?.editable) return;
    el.focus();
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      window.document.execCommand(command, false);
      window.document.execCommand("insertText", false, placeholder);
      window.document.execCommand(command, false);
    } else window.document.execCommand(command, false);
    requestAnimationFrame(recordEditorDom);
  }

  function applyWritingColor(command: "foreColor" | "hiliteColor", value: string) {
    const el = editorRef.current;
    if (!el || !document?.editable) return;
    el.focus();
    window.document.execCommand("styleWithCSS", false, "true");
    window.document.execCommand(command, false, value);
    requestAnimationFrame(recordEditorDom);
  }

  function clearInlineFormatting() {
    const el = editorRef.current;
    if (!el || !document?.editable) return;
    el.focus();
    window.document.execCommand("removeFormat", false);
    requestAnimationFrame(recordEditorDom);
  }

  function insertSceneBreak() {
    const el = editorRef.current;
    if (!el || !document?.editable) return;
    const ornament = typography.sceneOrnament ?? themes.find((theme) => theme.name === meta?.theme)?.sceneOrnament ?? "❦";
    el.focus();
    insertEditorHtml(`<div class="editor-scene-break" data-scene-break="true" contenteditable="false"><span>${ornament.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span><button type="button" class="editor-scene-break-remove" aria-label="Remove scene break" title="Remove scene break">×</button></div><p><br></p>`);
    recordEditorDom();
  }

  function insertEditorHtml(html: string) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    const current = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const range = current && editor.contains(current.commonAncestorContainer) ? current : window.document.createRange();
    if (!current || !editor.contains(current.commonAncestorContainer)) {
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    range.deleteContents();
    const fragment = range.createContextualFragment(html);
    const last = fragment.lastChild;
    range.insertNode(fragment);
    if (last && selection) {
      range.setStartAfter(last); range.collapse(true);
      selection.removeAllRanges(); selection.addRange(range);
    }
  }

  async function editorPaste(event: React.ClipboardEvent<HTMLDivElement>) {
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
      if (large) setPastePreparing(false);
    }
  }

  function applyFastKeyToLivePreview(nextDraft: string, key: string): void {
    if (nextDraft.length < 250_000 || previewMode === "print" || !selectedId || !document?.editable) return;
    const previewDocument = previewRef.current?.contentDocument;
    if (!previewDocument) return;
    const section = previewDocument.getElementById(selectedId)
      ?? previewDocument.querySelector<HTMLElement>("main.book > section.chapter, main.book > section.level1");
    const tail = lastPreviewProse(section);
    if (!tail) return;

    // A visible tail may already have been composed. Restore only this one
    // paragraph to its semantic form, instead of rebuilding the whole book.
    const originalHtml = tail.dataset.folioOriginalHtml;
    if (originalHtml !== undefined) {
      const originalStyle = tail.dataset.folioOriginalStyle;
      tail.innerHTML = originalHtml;
      delete tail.dataset.folioOriginalHtml;
      delete tail.dataset.folioOriginalStyle;
      delete tail.dataset.folioStrictFailure;
      tail.classList.remove("folio-composed", "folio-composed-dropcap", "folio-compositor-safe-fallback");
      if (originalStyle === "__none__" || originalStyle === undefined) tail.removeAttribute("style");
      else tail.setAttribute("style", originalStyle);
    }

    tail.append(previewDocument.createTextNode(key));
    livePreviewDraftRef.current = nextDraft;

    // Re-arm lazy professional composition after the typing burst. This is cheap:
    // no Markdown/Pandoc rebuild, and off-screen paragraphs remain lazy.
    if (fastPreviewComposeTimerRef.current !== null) window.clearTimeout(fastPreviewComposeTimerRef.current);
    fastPreviewComposeTimerRef.current = window.setTimeout(() => {
      fastPreviewComposeTimerRef.current = null;
      const doc = previewRef.current?.contentDocument;
      if (doc && typography.bodyAlign !== "left") void composePreviewDocument(doc, true);
    }, 900);
  }

  function applyFastEditorKey(event: React.KeyboardEvent<HTMLDivElement>): boolean {
    const editor = editorRef.current;
    if (!editor || draftRef.current.length < 100_000) return false;
    if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing || event.key.length !== 1) return false;

    const selection = window.getSelection();
    if (!selection?.isCollapsed || !selection.focusNode || !editor.contains(selection.focusNode)) return false;
    const parent = selection.focusNode.nodeType === Node.ELEMENT_NODE
      ? selection.focusNode as Element
      : selection.focusNode.parentElement;
    if (parent?.closest("strong,b,em,i,u,s,a,code,sup,sub")) return false;

    // Structural end check, O(depth), never O(manuscript size).
    let node: Node = selection.focusNode;
    if (node.nodeType === Node.TEXT_NODE) {
      if (selection.focusOffset !== (node.textContent?.length ?? 0)) return false;
    } else if (selection.focusOffset !== node.childNodes.length) return false;
    while (node !== editor) {
      if (node.nextSibling || !node.parentNode) return false;
      node = node.parentNode;
    }

    event.preventDefault();
    const text = window.document.createTextNode(event.key);
    const focusNode = selection.focusNode;
    const rootBoundary = focusNode === editor && selection.focusOffset === editor.childNodes.length;
    if (rootBoundary) {
      const last = editor.lastElementChild as HTMLElement | null;
      if (last && last.getAttribute("contenteditable") !== "false" && !last.classList.contains("editor-scene-break")) {
        if (last.lastChild?.nodeName === "BR" && !(last.textContent ?? "")) last.lastChild.remove();
        last.appendChild(text);
      } else editor.appendChild(text);
    } else {
      const range = selection.getRangeAt(0);
      range.insertNode(text);
    }
    const caret = window.document.createRange();
    caret.setStartAfter(text); caret.collapse(true);
    selection.removeAllRanges(); selection.addRange(caret);

    const current = draftRef.current;
    const next = current + event.key;
    if (!fastInputBurstRef.current) {
      undoRef.current.push(current);
      if (undoRef.current.length > 200) undoRef.current.shift();
      redoRef.current = [];
      fastInputBurstRef.current = true;
    }
    if (fastInputBurstTimerRef.current !== null) window.clearTimeout(fastInputBurstTimerRef.current);
    fastInputBurstTimerRef.current = window.setTimeout(() => {
      fastInputBurstRef.current = false;
      fastInputBurstTimerRef.current = null;
    }, 700);

    editor.dataset.markdown = next;
    draftRef.current = next;
    applyFastKeyToLivePreview(next, event.key);
    setDraft(next);
    setDirty(true);
    return true;
  }

  function recordEditorDom() {
    const editor = editorRef.current;
    if (!editor) return;
    editorDomDirtyRef.current = true;
    editorDomGenerationRef.current++;
    if (draftRef.current.length < 35_000) void flushEditorDom();
    else scheduleEditorDomSync();
    if (typewriterMode) scheduleTypewriterCaret(editor);
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
    to.push(draftRef.current);
    draftRef.current = next;
    setDraft(next); setDirty(true);
    if (el) { el.innerHTML = markdownToEditorHtml(next, typography.sceneOrnament ?? "❦"); el.dataset.markdown = next; el.focus(); }
  }

  function findNext() {
    const el = editorRef.current;
    if (!el || !searchQuery) return;
    el.focus();
    (window as Window & { find?: (text: string, caseSensitive?: boolean, backwards?: boolean, wrap?: boolean) => boolean }).find?.(searchQuery, false, false, true);
  }

  function editorKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (applyFastEditorKey(event)) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === "z" || key === "y") {
      event.preventDefault();
      history(key === "y" || event.shiftKey ? "redo" : "undo");
    } else if (key === "b" || key === "i" || key === "u") {
      event.preventDefault();
      if (key === "b") applyInlineFormat("bold", "bold text");
      if (key === "i") applyInlineFormat("italic", "italic text");
      if (key === "u") applyInlineFormat("underline", "underlined text");
    } else if (key === "f") { event.preventDefault(); setShowSearch(true); }
    else if (key === "s") { event.preventDefault(); void saveCurrent(); }
  }

  function editorClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const sceneRemove = target.closest(".editor-scene-break-remove");
    if (sceneRemove) {
      event.preventDefault();
      sceneRemove.closest(".editor-scene-break")?.remove();
      recordEditorDom();
      return;
    }
    const illustrationRemove = target.closest(".editor-illustration-remove");
    if (illustrationRemove) {
      event.preventDefault();
      illustrationRemove.closest(".editor-illustration")?.remove();
      recordEditorDom();
      return;
    }
    window.requestAnimationFrame(() => {
      syncEditorClickToPreview();
      if (typewriterMode) centerTypewriterCaret(editorRef.current);
    });
  }

  async function saveAppearance() {
    if (!project || !meta) return;
    setSaveState("saving");
    try {
      const saved = await persistAppearance(project.projectId, meta, typography);
      setProject(saved); setMeta(saved.meta); setTypography(saved.typography ?? {});
      setSaveState("saved"); setShowStyle(false);
    } catch (e) { setSaveState("error"); setError(e instanceof Error ? e.message : String(e)); }
  }

  async function chooseExportDirectory(): Promise<void> {
    try {
      const selected = (await api.pickFolder(exportDirectory || undefined)).path;
      if (selected) setExportDirectory(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function runExport(label: string, format: string, preset?: string, force = false): Promise<void> {
    if (!project || !meta || !(await saveCurrent())) return;
    setExportState({ busy: label, result: null, error: null });
    try {
      const result = await api.export(project.projectId, format, { preset, meta, theme: meta.theme, typography, print: format === "print" ? printOptions : undefined, force, outputDir: exportDirectory.trim() || undefined });
      if (result.needsConfirm) {
        if (window.confirm(`${result.message ?? "This export already exists."}\n\nReplace it?`)) return runExport(label, format, preset, true);
        setExportState({ busy: null, result: null, error: null }); return;
      }
      if (!result.written) downloadResult(result);
      setExportState({ busy: null, result, error: null });
    } catch (e) { setExportState({ busy: null, result: null, error: e instanceof Error ? e.message : String(e) }); }
  }

  if (!project || !meta) return (
    <div className="folio-shell folio-empty-shell" data-ui-tone={uiTone}>
      <div className="folio-windowbar empty-windowbar"><div className="windowbar-spacer"/><div className="folio-wordmark">folio</div><div className="windowbar-spacer"/></div>
      <main className="empty-state"><div className="empty-book-mark">F</div><h1>Folio</h1><p>Beautiful books, without the formatting fight.</p><div className="empty-actions"><button className="native-button primary" disabled={busy} onClick={() => void beginNewBook()}>{busy ? "Opening…" : "New Book…"}</button><button className="native-button" disabled={busy} onClick={() => void openFolder()}>Open Book…</button><button className="native-button" disabled={busy} onClick={() => void loadSample()}>Open Sample</button></div>{error && <div className="empty-error">{error}</div>}</main>
      {showNewBook && <NewBookDialog value={newBookForm} setValue={setNewBookForm} busy={busy} onCancel={() => setShowNewBook(false)} onCreate={() => void createNewBook()}/>}
    </div>
  );

  return (
    <div className="folio-shell" data-ui-tone={uiTone} data-workspace-mode={workspaceMode} data-split-view={splitView ? "true" : "false"} data-focus-mode={focusMode ? "true" : "false"} data-typewriter-mode={workspaceMode === "write" && typewriterMode ? "true" : "false"} data-write-sidebar={writeSidebarOpen ? "open" : "closed"}>
      <header className="folio-commandbar">
        <button type="button" className="command-wordmark" aria-label="Back to dashboard" title="Back to dashboard" disabled={busy} onClick={() => void returnToDashboard()}>folio</button>
        <nav aria-label="Application commands">
          <button data-command="book" onClick={() => setShowBookDetails(true)}>Book</button>
          <button data-command="design" onClick={() => setShowStyle(true)}>Design</button>
          <button data-command="new-project" disabled={busy} onClick={() => void beginNewBook()}>New Project</button><button data-command="settings" onClick={() => setShowSettings(true)}>Settings</button>
          <span className="workspace-command-spacer"/>
          <span className="workspace-mode-switch" role="group" aria-label="Workspace mode">
            <button type="button" className={workspaceMode === "write" ? "active" : ""} aria-pressed={workspaceMode === "write"} onClick={() => void changeWorkspaceMode("write")}>Write</button>
            <button type="button" className={workspaceMode === "format" ? "active" : ""} aria-pressed={workspaceMode === "format"} onClick={() => void changeWorkspaceMode("format")}>Format</button>
          </span>
        </nav>
        <button className="tone-toggle" onClick={() => setUiTone((tone) => tone === "ivory" ? "midnight" : "ivory")} aria-label={uiTone === "ivory" ? "Use Midnight Editorial" : "Use Ivory and Ink"}>{uiTone === "ivory" ? "Midnight" : "Ivory"}</button>
      </header>
      <aside className="library-pane">
        <div className="library-toolbar"><span className="pane-label">Manuscript</span>{workspaceMode === "write" && !focusMode && <button type="button" className="library-collapse-button" aria-label="Hide manuscript sidebar" title="Hide manuscript sidebar" onClick={() => setWriteSidebarOpen(false)}>×</button>}</div>
        <div className="book-identity"><div className="book-title">{meta.title}</div><div className="book-author">{meta.author}</div></div>
        <nav className="contents-list" aria-label="Book contents">
          <button className={`contents-row cover-row ${coverSelected ? "selected" : ""}`} onClick={() => void selectSection(COVER_ID)}><span>Cover</span><small>{project.hasCover ? "" : "Add"}</small></button>
          {frontMatter.map((section) => <button key={section.id} className={`contents-row ${selectedId === section.id ? "selected" : ""}`} onClick={() => void selectSection(section.id)}><span>{section.title}</span></button>)}
          <div className="contents-heading">Contents</div>
          {chapters.map((section, index) => <button key={section.id} draggable={!busy} onDragStart={() => setDraggedChapterId(section.id)} onDragEnd={() => setDraggedChapterId(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropChapter(section.id)} className={`contents-row chapter-row ${selectedId === section.id ? "selected" : ""} ${draggedChapterId === section.id ? "dragging" : ""}`} onClick={() => void selectSection(section.id)} title={`${section.title} · drag to reorder`}><span className="chapter-grip"><UiIcon name="drag"/></span><span className="chapter-number">{index + 1}.</span><span className="chapter-label">{section.title}</span></button>)}
          {backMatter.length > 0 && <div className="contents-heading back-heading">Back Matter</div>}
          {backMatter.map((section) => <button key={section.id} className={`contents-row ${selectedId === section.id ? "selected" : ""}`} onClick={() => void selectSection(section.id)}><span>{section.title}</span></button>)}
        </nav>
        <button type="button" className="library-add-section" onClick={() => setShowContent(true)}><span aria-hidden="true">＋</span><span>Add Section</span></button>
        <div className="library-footer"><button className="tiny-footer-button" title="Open another book" aria-label="Open another book" onClick={() => void openFolder()}><UiIcon name="open"/></button><button className="tiny-footer-button" title="Reload files" aria-label="Reload files" onClick={() => void reloadFiles()}><UiIcon name="reload"/></button><div className="library-footer-spacer"/></div>
      </aside>

      <section className="editor-pane">
        <div className="editor-topbar">{workspaceMode === "write" && !focusMode && <button type="button" className={`write-sidebar-toggle ${writeSidebarOpen ? "active" : ""}`} aria-pressed={writeSidebarOpen} aria-label={writeSidebarOpen ? "Hide manuscript sidebar" : "Show manuscript sidebar"} title={writeSidebarOpen ? "Hide manuscript sidebar" : "Show manuscript sidebar"} onClick={() => setWriteSidebarOpen((value) => !value)}><UiIcon name="sidebar"/></button>}<div className="editor-topbar-right"><span className={`save-indicator ${saveState}`}>{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : ""}</span><span className="word-count">{totalWords.toLocaleString()} Words</span></div></div>
        <div className="section-titlebar">{coverSelected ? <div className="section-title-wrap cover-workspace-heading"><span className="section-title">Cover</span></div> : <ChapterHeading title={selectedSection?.title ?? document?.title ?? ""} subtitle={document?.subtitle ?? ""} index={chapterIndex} editable={selectedSection?.kind === "chapter"} busy={busy} onTitle={(title) => void updateCurrentChapterHeading({ title })} onSubtitle={(subtitle) => void updateCurrentChapterHeading({ subtitle })}/>}<div className="section-actions">{selectedSection?.kind === "chapter" && <><button className="section-move" title="Move chapter up" aria-label="Move chapter up" disabled={busy || chapterIndex === 1} onClick={() => moveChapter(selectedSection.id, -1)}><UiIcon name="up"/></button><button className="section-move" title="Move chapter down" aria-label="Move chapter down" disabled={busy || chapterIndex === chapters.length} onClick={() => moveChapter(selectedSection.id, 1)}><UiIcon name="down"/></button></>}{selectedSection && <button className="section-delete" title="Delete section" disabled={busy} onClick={() => void deleteCurrentSection()}>Delete</button>}</div></div>
        <div className={`format-toolbar ${coverSelected ? "cover-toolbar" : ""}`}>
          <div className="toolbar-group history-tools"><button onMouseDown={(e) => e.preventDefault()} onClick={() => history("undo")} title="Undo (Ctrl+Z)" aria-label="Undo"><UiIcon name="undo"/></button><button onMouseDown={(e) => e.preventDefault()} onClick={() => history("redo")} title="Redo (Ctrl+Y)" aria-label="Redo"><UiIcon name="redo"/></button></div>
          <div className="toolbar-group"><button disabled={!document?.editable} onMouseDown={(e) => e.preventDefault()} onClick={() => applyInlineFormat("bold", "bold text")} title="Bold (Ctrl+B)"><strong>B</strong></button><button disabled={!document?.editable} onMouseDown={(e) => e.preventDefault()} onClick={() => applyInlineFormat("italic", "italic text")} title="Italic (Ctrl+I)"><em>I</em></button><button disabled={!document?.editable} onMouseDown={(e) => e.preventDefault()} onClick={() => applyInlineFormat("underline", "underlined text")} title="Underline (Ctrl+U)"><u>U</u></button>{workspaceMode === "write" && <><button disabled={!document?.editable} onMouseDown={(e) => e.preventDefault()} onClick={() => applyInlineFormat("strikeThrough", "strikethrough text")} title="Strikethrough"><s>S</s></button><label className="writing-color-control" title="Text color"><span>A</span><input type="color" defaultValue="#b42318" disabled={!document?.editable} onChange={(e) => applyWritingColor("foreColor", e.target.value)}/></label><label className="writing-color-control writing-highlight-control" title="Highlight color"><span>H</span><input type="color" defaultValue="#d8f2d0" disabled={!document?.editable} onChange={(e) => applyWritingColor("hiliteColor", e.target.value)}/></label><button className="writing-clear-format" disabled={!document?.editable} onMouseDown={(e) => e.preventDefault()} onClick={clearInlineFormatting} title="Clear inline formatting">Clear</button></>}<button className="scene-break-button" disabled={!document?.editable} onMouseDown={(e) => e.preventDefault()} onClick={insertSceneBreak} title="Insert ornamental scene break">❦ <span>Break</span></button><button className="illustration-button" disabled={busy || !document?.editable || document.id !== selectedSection?.id} onMouseDown={(e) => { e.preventDefault(); rememberIllustrationCaret(); }} onClick={() => illustrationInputRef.current?.click()} title="Insert illustration at cursor">▧ <span>Image</span></button><input ref={illustrationInputRef} className="illustration-input" type="file" accept="image/png,image/jpeg" disabled={busy || !document?.editable || document.id !== selectedSection?.id} onChange={(event) => { const file = event.target.files?.[0]; if (file) void insertIllustration(file); }}/></div>
          <div className="toolbar-spacer"/>
          {showSearch ? <div className="editor-search"><input autoFocus value={searchQuery} placeholder="Find" onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") findNext(); if (e.key === "Escape") setShowSearch(false); }}/><button onClick={findNext}>Next</button><button onClick={() => setShowSearch(false)} aria-label="Close search">×</button></div> : <button className="search-pill" title="Find (Ctrl+F)" aria-label="Find" onClick={() => setShowSearch(true)}><UiIcon name="search"/></button>}
          {workspaceMode === "write" && <><span className="editor-layout-rule" aria-hidden="true"/><button type="button" className={`editor-split-toggle ${splitView ? "active" : ""}`} aria-pressed={splitView} aria-label={splitView ? "Close split editor" : "Split editor"} title={splitView ? "Close split editor" : "Split editor"} onMouseDown={(event) => event.preventDefault()} onClick={() => void toggleSplitView()}><UiIcon name="split"/></button><button type="button" className={`editor-typewriter-toggle ${typewriterMode ? "active" : ""}`} aria-pressed={typewriterMode} aria-label={typewriterMode ? "Disable typewriter mode" : "Enable typewriter mode"} title={typewriterMode ? "Disable typewriter mode" : "Typewriter mode"} onMouseDown={(event) => event.preventDefault()} onClick={() => setTypewriterMode((value) => !value)}><UiIcon name="typewriter"/></button><button type="button" className={`editor-focus-toggle ${focusMode ? "active" : ""}`} aria-pressed={focusMode} aria-label={focusMode ? "Exit focus mode" : "Enter focus mode"} title={focusMode ? "Exit focus mode (Esc)" : "Focus mode"} onMouseDown={(event) => event.preventDefault()} onClick={() => setFocusMode((value) => !value)}><UiIcon name="focus"/></button></>}
        </div>
        <div className="editor-paper">{coverSelected ? <CoverEditor projectId={project.projectId} hasCover={project.hasCover} coverVersion={coverVersion} busy={busy} onCover={(file) => void uploadCover(file)}/> : <>{pastePreparing && <div className="paste-progress" role="status">Preparing pasted manuscript…</div>}{selectedId ? (document ? <div ref={editorRef} autoFocus className={`manuscript-editor rich-editor ${workspaceMode === "write" && typewriterMode ? "typewriter-active" : ""}`} contentEditable={document.editable} suppressContentEditableWarning spellCheck={spellcheckEnabled} data-placeholder="Start writing…" onPaste={editorPaste} onInput={recordEditorDom} onClick={editorClick} onKeyDown={editorKeyDown} onKeyUp={() => { if (typewriterMode) scheduleTypewriterCaret(editorRef.current); }} onFocus={() => { if (typewriterMode) scheduleTypewriterCaret(editorRef.current); }} aria-label={"Edit " + document.title}/> : <div className="editor-loading">Loading section…</div>) : <div className="empty-project-editor"><strong>This book has no chapters.</strong><span>Add the first chapter to start writing.</span><button className="native-button primary" onClick={() => setShowContent(true)}>Add Chapter</button></div>}{document && !document.editable && <div className="readonly-note">This page is generated from Book Details. <button onClick={() => setShowBookDetails(true)}>Edit Book Details</button></div>}</>}</div>
      </section>

      {splitView && <WritingSplitPane
        project={project}
        primarySectionId={selectedId}
        ornament={writingOrnament}
        typewriterMode={typewriterMode}
        spellcheckEnabled={spellcheckEnabled}
        onClose={() => setSplitView(false)}
        onError={(message) => setError(message)}
        onRegisterFlush={(flush) => { splitFlushRef.current = flush; }}
      />}

      {workspaceMode === "write" && focusMode && <div className="focus-layout-controls" role="toolbar" aria-label="Focus layout controls">
        {splitView && <button type="button" className="focus-split-close" aria-label="Close split editor" title="Close split editor" onMouseDown={(event) => event.preventDefault()} onClick={() => void toggleSplitView()}><UiIcon name="split"/></button>}
        <button type="button" className={`focus-typewriter ${typewriterMode ? "active" : ""}`} aria-pressed={typewriterMode} aria-label={typewriterMode ? "Disable typewriter mode" : "Enable typewriter mode"} title={typewriterMode ? "Disable typewriter mode" : "Typewriter mode"} onMouseDown={(event) => event.preventDefault()} onClick={() => setTypewriterMode((value) => !value)}><UiIcon name="typewriter"/></button>
        <button type="button" className="focus-exit" aria-label="Exit focus mode" title="Exit focus mode (Esc)" onMouseDown={(event) => event.preventDefault()} onClick={() => setFocusMode(false)}><UiIcon name="focus"/></button>
      </div>}

      <section className="preview-pane">
        <div className="preview-topbar"><span className="preview-pane-title">Page Preview</span><div className="generate-wrap"><button className="generate-button" onClick={() => setShowGenerate((v) => !v)}>Export</button>{showGenerate && <div className="generate-menu"><button onClick={() => void runExport("EPUB · Kindle", "epub", "kdp")}>EPUB · Kindle</button><button onClick={() => void runExport("EPUB · Universal", "epub", "universal")}>EPUB · Universal</button><button onClick={() => void runExport("Print PDF", "print")}>Print PDF</button><button onClick={() => void runExport("Reading PDF", "pdf")}>Reading PDF</button><button onClick={() => void runExport("Word", "docx")}>Word (.docx)</button><div className="generate-status">{exportState.busy && "Generating " + exportState.busy + "…"}{exportState.error && <span className="error-text">{exportState.error}</span>}{exportState.result && <span>✓ {exportState.result.filename ?? "Done"} · {formatBytes(exportState.result.bytes)}</span>}</div></div>}</div></div>
        <div className="device-toolbar"><div className="device-label"><select aria-label="Preview device" value={previewMode} onChange={(e) => setPreviewMode(e.target.value as PreviewMode)}>{previewProfileGroups.map((group) => <optgroup key={group.label} label={group.label}>{group.profiles.map((profile) => <option key={profile.value} value={profile.value}>{profile.label}</option>)}</optgroup>)}</select>{previewMode === "print" && <select className="trim-select" aria-label="Print trim" value={printOptions.trim} onChange={(e) => setPrintOptions({ ...printOptions, trim: e.target.value })}>{trims.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}</div><div className="device-nav"><button disabled={!previousId} title="Previous section" aria-label="Previous section" onClick={() => previousId && void selectSection(previousId)}><UiIcon name="previous"/></button><span>{selectedPosition >= 0 ? selectedPosition + 1 : 0} / {navigationIds.length}</span><button disabled={!nextId} title="Next section" aria-label="Next section" onClick={() => nextId && void selectSection(nextId)}><UiIcon name="next"/></button></div></div>
        <div ref={previewStageRef} className={`preview-stage ${previewMode === "print" ? "print-stage" : "device-stage"}`}><div className={"reader-device device-" + previewMode} data-device-family={previewProfile?.family ?? "kindle"} style={previewMode === "print" || !previewProfile ? undefined : ({ "--folio-device-aspect": String(previewProfile.viewport.width / previewProfile.viewport.height), "--folio-device-max-width": `${previewProfile.shellMaxWidth}px` } as React.CSSProperties)}><div className="reader-screen">{previewLoading && <div className="preview-loading">Rendering…</div>}{previewError && !previewLoading && <div className="preview-error"><strong>Preview could not refresh.</strong><span>The last valid page is still shown.</span><small>{previewError}</small></div>}{coverSelected ? (project.hasCover ? <div className="cover-preview-surface"><img src={`/api/projects/${project.projectId}/cover?v=${coverVersion}`} alt={`${meta.title} cover`}/></div> : <div className="cover-preview-empty"><strong>No cover yet</strong><span>Add a PNG or JPEG from the Cover workspace.</span></div>) : selectedId ? <iframe key={`${project.projectId}:${selectedId}:${previewMode === "print" ? "print" : "reader"}`} ref={previewRef} className="preview-frame" title="Book preview" srcDoc={previewHtml} onLoad={() => onPreviewLoad()}/> : <div className="preview-empty">Add a chapter to see its live preview.</div>}</div></div></div>
      </section>

      <footer className="folio-statusbar"><span>{saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed" : "Autosave on"}</span><span>{workspaceMode === "write" ? (splitView ? "Write · Split" : "Write") : "Format"}</span><span>{meta.language || "en"}</span><span>{themes.find((theme) => theme.name === meta.theme)?.label ?? meta.theme}</span><span>{previewProfiles.find((profile) => profile.value === previewMode)?.label}</span></footer>

      {showStyle && (
        <StyleLibrary themes={themes} meta={meta} setMeta={setMeta} typography={typography} setTypography={setTypography} category={styleCategory} setCategory={setStyleCategory} printOptions={printOptions} setPrintOptions={setPrintOptions} onClose={() => setShowStyle(false)} onSave={() => void saveAppearance()}/>
      )}
      {showContent && <ContentDialog matterTypes={matterTypes} title={contentTitle} setTitle={setContentTitle} busy={busy} onAddChapter={() => void addChapter()} onAddMatter={(type) => void addMatterSection(type)} onAddImagePage={(file) => void addImagePage(file)} onClose={() => setShowContent(false)}/>}
      {showBookDetails && <BookDetailsDialog meta={meta} setMeta={setMeta} projectId={project.projectId} hasCover={project.hasCover} coverVersion={coverVersion} onCover={(file) => void uploadCover(file)} busy={busy} onClose={() => setShowBookDetails(false)} onSave={() => void saveBookDetails()}/>}
      {showSettings && <SettingsDialog spellcheckEnabled={spellcheckEnabled} setSpellcheckEnabled={setSpellcheckEnabled} exportDirectory={exportDirectory} onChooseExportDirectory={() => void chooseExportDirectory()} onResetExportDirectory={() => setExportDirectory("")} onClose={() => setShowSettings(false)}/>}
      {showNewBook && <NewBookDialog value={newBookForm} setValue={setNewBookForm} busy={busy} onCancel={() => setShowNewBook(false)} onCreate={() => void createNewBook()}/>}
      {error && <button className="global-error" onClick={() => setError(null)} title="Dismiss">{error}</button>}
    </div>
  );
}

function CoverEditor(props: { projectId: string; hasCover: boolean; coverVersion: number; busy: boolean; onCover: (file: File) => void }) {
  return <div className="cover-editor-panel"><div className="cover-editor-card"><div className="cover-editor-art">{props.hasCover ? <img src={`/api/projects/${props.projectId}/cover?v=${props.coverVersion}`} alt="Book cover"/> : <div className="cover-editor-empty"><strong>No cover yet</strong><span>Add the finished front-cover image for this book.</span></div>}</div><label className="native-button primary cover-upload-button">{props.hasCover ? "Replace Cover" : "Add Cover"}<input type="file" accept="image/png,image/jpeg" disabled={props.busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onCover(file); event.currentTarget.value = ""; }}/></label><p className="cover-editor-copy">The cover is embedded in EPUB and Reading PDF exports. Print PDF remains an interior file for print-on-demand services.</p></div></div>;
}

function DialogShell(props: { title: string; children: React.ReactNode; footer: React.ReactNode; onClose: () => void }) {
  return <div className="dialog-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}><section className="folio-dialog" role="dialog" aria-modal="true" aria-label={props.title}><header><h2>{props.title}</h2><button onClick={props.onClose} aria-label="Close">×</button></header><div className="dialog-body">{props.children}</div><footer>{props.footer}</footer></section></div>;
}

function SettingsDialog(props: {
  spellcheckEnabled: boolean;
  setSpellcheckEnabled: (enabled: boolean) => void;
  exportDirectory: string;
  onChooseExportDirectory: () => void;
  onResetExportDirectory: () => void;
  onClose: () => void;
}) {
  return <DialogShell title="Settings" onClose={props.onClose} footer={<button className="native-button primary" onClick={props.onClose}>Done</button>}>
    <div className="settings-list">
      <label className="settings-row">
        <span className="settings-copy"><strong>Spellcheck</strong><small>Underline suspected spelling errors while writing. This setting applies to the main editor and Split View.</small></span>
        <input type="checkbox" checked={props.spellcheckEnabled} onChange={(event) => props.setSpellcheckEnabled(event.target.checked)} aria-label="Enable spellcheck"/>
      </label>
      <div className="settings-row export-location-row">
        <span className="settings-copy">
          <strong>Export location</strong>
          <small>{props.exportDirectory || "Default: an Exports folder next to the current .folio project."}</small>
        </span>
        <span className="settings-actions">
          {props.exportDirectory && <button type="button" className="native-button" onClick={props.onResetExportDirectory}>Reset</button>}
          <button type="button" className="native-button" onClick={props.onChooseExportDirectory}>Choose folder…</button>
        </span>
      </div>
    </div>
  </DialogShell>;
}

function NewBookDialog(props: { value: { path: string; title: string; author: string }; setValue: (value: { path: string; title: string; author: string }) => void; busy: boolean; onCancel: () => void; onCreate: () => void }) {
  const { value, setValue } = props;
  return <DialogShell title="New Book" onClose={props.onCancel} footer={<><button className="native-button" onClick={props.onCancel}>Cancel</button><button className="native-button primary" disabled={props.busy || !value.title.trim()} onClick={props.onCreate}>Create Book</button></>}><label className="dialog-field"><span>Title</span><input autoFocus value={value.title} onChange={(e) => setValue({ ...value, title: e.target.value })}/></label><label className="dialog-field"><span>Author</span><input value={value.author} placeholder="Author name" onChange={(e) => setValue({ ...value, author: e.target.value })}/></label><label className="dialog-field"><span>Project file</span><input value={value.path} readOnly/></label></DialogShell>;
}

function ChapterHeading(props: { title: string; subtitle: string; index: number | null; editable: boolean; busy: boolean; onTitle: (title: string) => void; onSubtitle: (subtitle: string) => void }) {
  const [editing, setEditing] = useState<"title" | "subtitle" | null>(null);
  const [title, setTitle] = useState(props.title);
  const [subtitle, setSubtitle] = useState(props.subtitle);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setTitle(props.title); setSubtitle(props.subtitle); setEditing(null); }, [props.title, props.subtitle]);
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);
  const cancel = () => { setTitle(props.title); setSubtitle(props.subtitle); setEditing(null); };
  const commitTitle = () => { const value = title.trim(); setEditing(null); if (value && value !== props.title) props.onTitle(value); else setTitle(props.title); };
  const commitSubtitle = () => { const value = subtitle.trim(); setEditing(null); if (value !== props.subtitle) props.onSubtitle(value); else setSubtitle(props.subtitle); };
  // Enter commits by blurring, so exactly one path performs the rewrite. Calling
  // commit here and again from onBlur could launch two concurrent PATCHes.
  const keys = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
    if (event.key === "Escape") { event.preventDefault(); cancel(); }
  };
  return <div className="section-title-wrap">
    {props.index ? <span className="section-index">{props.index}.</span> : null}
    {editing === "title" ? <input ref={inputRef} className="section-title-input" autoFocus value={title} disabled={props.busy} onChange={(event) => setTitle(event.target.value)} onBlur={commitTitle} onKeyDown={keys}/> : <button className="section-title section-title-button" disabled={!props.editable || props.busy} title={props.editable ? "Rename chapter" : undefined} onClick={() => props.editable && setEditing("title")}>{props.title}</button>}
    {editing === "subtitle" ? <input ref={inputRef} className="section-subtitle-input" autoFocus value={subtitle} placeholder="Chapter subtitle" disabled={props.busy} onChange={(event) => setSubtitle(event.target.value)} onBlur={commitSubtitle} onKeyDown={keys}/> : <button className={`section-subtitle-button ${props.subtitle ? "" : "placeholder"}`} disabled={!props.editable || props.busy} title={props.editable ? "Edit chapter subtitle" : undefined} onClick={() => props.editable && setEditing("subtitle")}>{props.subtitle || "+ Add subtitle"}</button>}
  </div>;
}

function BookDetailsDialog(props: { meta: BookMeta; setMeta: (meta: BookMeta) => void; projectId: string; hasCover: boolean; coverVersion: number; onCover: (file: File) => void; busy: boolean; onClose: () => void; onSave: () => void }) {
  const { meta, setMeta } = props;
  const field = (label: string, key: keyof BookMeta, multiline = false) => <label className="dialog-field"><span>{label}</span>{multiline ? <textarea value={String(meta[key] ?? "")} onChange={(e) => setMeta({ ...meta, [key]: e.target.value })}/> : <input value={String(meta[key] ?? "")} onChange={(e) => setMeta({ ...meta, [key]: e.target.value })}/>}</label>;
  return <DialogShell title="Book Details" onClose={props.onClose} footer={<><button className="native-button" onClick={props.onClose}>Cancel</button><button className="native-button primary" disabled={props.busy || !meta.title.trim()} onClick={props.onSave}>Save</button></>}><div className="book-details-layout"><div className="cover-field"><div className="cover-thumbnail">{props.hasCover ? <img src={`/api/projects/${props.projectId}/cover?v=${props.coverVersion}`} alt="Book cover"/> : <span>No cover</span>}</div><label className="native-button cover-button">{props.hasCover ? "Replace Cover" : "Add Cover"}<input type="file" accept="image/png,image/jpeg" disabled={props.busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onCover(file); }}/></label><small>PNG or JPEG. Embedded in EPUB and used by exports.</small></div><div><div className="details-grid">{field("Title", "title")}{field("Subtitle", "subtitle")}{field("Author", "author")}{field("Series", "series")}{field("Book number", "series_index")}{field("Publisher", "publisher")}{field("Language", "language")}{field("ISBN", "isbn")}</div>{field("Copyright text", "copyright", true)}{field("Description", "description", true)}</div></div></DialogShell>;
}

function ContentDialog(props: { matterTypes: MatterType[]; title: string; setTitle: (title: string) => void; busy: boolean; onAddChapter: () => void; onAddMatter: (type: MatterType) => void; onAddImagePage: (file: File) => void; onClose: () => void }) {
  const front = props.matterTypes.filter((type) => type.placement === "frontmatter");
  const back = props.matterTypes.filter((type) => type.placement === "backmatter");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const group = (label: string, items: MatterType[], imagePage = false) => <div className="content-kind-group"><h3>{label}</h3>{imagePage && <><button type="button" className="content-image-kind" disabled={props.busy} onClick={() => imageInputRef.current?.click()}><span>Full-page Image</span><small>Map, family tree or illustration</small></button><input ref={imageInputRef} className="content-image-input" type="file" accept="image/png,image/jpeg" disabled={props.busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onAddImagePage(file); event.currentTarget.value = ""; }}/></>}{items.map((type) => <button key={type.key} disabled={props.busy} onClick={() => props.onAddMatter(type)}><span>{type.label}</span><small>Add editable page</small></button>)}</div>;
  return <DialogShell title="Add Content" onClose={props.onClose} footer={<button className="native-button" onClick={props.onClose}>Close</button>}><div className="add-chapter-box"><h3>Chapter</h3><div><input autoFocus value={props.title} onChange={(e) => props.setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && props.title.trim()) props.onAddChapter(); }}/><button className="native-button primary" disabled={props.busy || !props.title.trim()} onClick={props.onAddChapter}>Add Chapter</button></div></div><div className="content-kind-columns">{group("Front Matter", front, true)}{group("Back Matter", back)}</div></DialogShell>;
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
  const clearTypographyKeys = (...keys: Array<keyof Typography>) => {
    const next = { ...ty };
    for (const key of keys) delete next[key];
    setTy(next);
  };
  const resetCategory = () => {
    switch (category) {
      case "Body":
        clearTypographyKeys("bodyFont", "fontSize", "lineHeight", "bodyAlign", "paragraphIndent", "paragraphSpacing");
        return;
      case "Chapter Heading":
        clearTypographyKeys("headingFont", "chapterTitle");
        return;
      case "First Paragraph":
        clearTypographyKeys("dropcap");
        return;
      case "Paragraph After Break":
        clearTypographyKeys("paragraphAfterBreakIndent");
        return;
      case "Scene Break":
        clearTypographyKeys("sceneOrnament");
        return;
      case "Header & Footer":
        setPrintOptions({ ...printOptions, layout: defaultPrint.layout, startChaptersRecto: defaultPrint.startChaptersRecto });
        return;
      case "Title Page":
        clearTypographyKeys("titlePageFont");
        return;
      default:
        return;
    }
  };
  return <div className="customize-panel">
    <div className="customize-heading"><h3>{category}</h3><button type="button" className="customize-reset-button" onClick={resetCategory}>Reset to Theme Default</button></div>
    <p>Theme defaults already form a complete design. Override only what the book needs.</p>
    {category === "Body" && <>
      {row("Typeface", <select value={ty.bodyFont ?? ""} onChange={(e) => setTy({ ...ty, bodyFont: e.target.value || undefined })}>{fonts}</select>)}
      {row("Size", <select value={ty.fontSize ?? ""} onChange={(e) => setTy({ ...ty, fontSize: e.target.value || undefined })}><option value="">Theme default</option><option value="0.92em">Small</option><option value="1em">Standard</option><option value="1.08em">Large</option><option value="1.16em">Extra large</option></select>)}
      {row("Line spacing", <input type="range" min="1.3" max="1.8" step="0.05" value={Number(ty.lineHeight ?? 1.5)} onChange={(e) => setTy({ ...ty, lineHeight: Number(e.target.value) })}/>)}
      {row("Alignment", <select value={ty.bodyAlign ?? ""} onChange={(e) => setTy({ ...ty, bodyAlign: (e.target.value || undefined) as "left" | "justify" | undefined })}><option value="">Theme default</option><option value="justify">Professional justified</option><option value="left">Ragged right</option></select>)}
      {row("Paragraph spacing", <select value={ty.paragraphSpacing ?? ""} onChange={(e) => setTy({ ...ty, paragraphSpacing: e.target.value || undefined })}><option value="">Theme default</option><option value="0">None</option><option value="0.5em">Compact</option><option value="1em">Open</option></select>)}
    </>}
    {category === "Chapter Heading" && <>
      {row("Show theme label", <input type="checkbox" checked={ty.chapterTitle?.showLabel ?? true} onChange={(e) => setTy({ ...ty, chapterTitle: { ...ty.chapterTitle, showLabel: e.target.checked } })}/>)}
      {row("Label text", <input value={ty.chapterTitle?.labelText ?? ""} disabled={ty.chapterTitle?.showLabel === false} placeholder="CHAPTER → CHAPTER 1, CHAPTER 2…" title="Folio automatically appends the chapter number in current book order" onChange={(e) => setTy({ ...ty, chapterTitle: { ...ty.chapterTitle, labelText: e.target.value || undefined } })}/>)}
      {row("Typeface", <select value={ty.headingFont ?? ""} onChange={(e) => setTy({ ...ty, headingFont: e.target.value || undefined })}>{fonts}</select>)}
      {row("Size", <select value={ty.chapterTitle?.size ?? ""} onChange={(e) => setTy({ ...ty, chapterTitle: { ...ty.chapterTitle, size: e.target.value || undefined } })}><option value="">Theme default</option><option value="1.4em">Compact</option><option value="1.8em">Standard</option><option value="2.2em">Large</option></select>)}
      {row("Alignment", <select value={ty.chapterTitle?.align ?? ""} onChange={(e) => setTy({ ...ty, chapterTitle: { ...ty.chapterTitle, align: (e.target.value || undefined) as "left" | "center" | "right" | undefined } })}><option value="">Theme default</option><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select>)}
      {row("Letter case", <select value={ty.chapterTitle?.case ?? ""} onChange={(e) => setTy({ ...ty, chapterTitle: { ...ty.chapterTitle, case: (e.target.value || undefined) as "normal" | "smallcaps" | "uppercase" | undefined } })}><option value="">Theme default</option><option value="normal">Normal</option><option value="smallcaps">Small caps</option><option value="uppercase">Uppercase</option></select>)}
      {row("Style", <select value={ty.chapterTitle?.style ?? ""} onChange={(e) => setTy({ ...ty, chapterTitle: { ...ty.chapterTitle, style: (e.target.value || undefined) as "normal" | "italic" | undefined } })}><option value="">Theme default</option><option value="normal">Roman</option><option value="italic">Italic</option></select>)}
    </>}
    {category === "First Paragraph" && row("Drop cap", <input type="checkbox" checked={ty.dropcap ?? props.themeDropcap} onChange={(e) => setTy({ ...ty, dropcap: e.target.checked })}/>)}
    {category === "Paragraph After Break" && row("First-line indent", <select value={ty.paragraphAfterBreakIndent ?? ""} onChange={(e) => setTy({ ...ty, paragraphAfterBreakIndent: e.target.value || undefined })}><option value="">Theme default</option><option value="0">Flush</option><option value="1em">Compact</option><option value="1.25em">Standard</option><option value="1.6em">Deep</option></select>)}
    {category === "Scene Break" && <><div className="ornament-heading"><span>Choose an ornament</span><small>Every break in the book updates live.</small></div><div className="ornament-picker"><button className={ty.sceneOrnament === undefined ? "selected" : ""} onClick={() => setTy({ ...ty, sceneOrnament: undefined })}><span>Theme</span><small>default</small></button><button className={ty.sceneOrnament === "" ? "selected" : ""} onClick={() => setTy({ ...ty, sceneOrnament: "" })}><span>None</span><small>no symbol</small></button>{sceneOrnaments.map((ornament) => <button key={ornament} data-ornament={ornament} className={ty.sceneOrnament === ornament ? "selected" : ""} title={`Use ${ornament}`} onClick={() => setTy({ ...ty, sceneOrnament: ornament })}>{ornament}</button>)}</div>{row("Custom ornament", <input value={ty.sceneOrnament ?? ""} placeholder="Type or paste a symbol" onChange={(e) => setTy({ ...ty, sceneOrnament: e.target.value })}/>)}</>}
    {category === "Header & Footer" && <>{row("Running heads", <select value={printOptions.layout} onChange={(e) => setPrintOptions({ ...printOptions, layout: e.target.value })}><option value="author-title-bottom">Author / title · folio bottom</option><option value="author-title-top">Author / title · folio top</option><option value="title-chapter-bottom">Title / chapter · folio bottom</option><option value="title-chapter-top">Title / chapter · folio top</option><option value="folio-bottom">Page number only · bottom</option></select>)}{row("Recto chapter starts", <input type="checkbox" checked={printOptions.startChaptersRecto} onChange={(e) => setPrintOptions({ ...printOptions, startChaptersRecto: e.target.checked })}/>)}</>}
    {category === "Title Page" && row("Title typeface", <select value={ty.titlePageFont ?? ""} onChange={(e) => setTy({ ...ty, titlePageFont: e.target.value || undefined })}>{fonts}</select>)}
  </div>;
}

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { nearbyPhraseOccurrences, repetitionOccurrences } from "./write-studio";
import { markdownToEditorHtml } from "./rich-text";
import {
  caretTextOffset,
  changedTextRange,
  interpolatePairedScroll,
  placeCaretAtTextOffset,
  rangeForTextOffsets,
  secondDraftProgress,
  selectedTextOffsets,
  sourceFingerprint,
} from "./second-draft";
import type {
  SecondDraftBlock,
  SecondDraftBlockStatus,
  SecondDraftCarryover,
  SecondDraftIssue,
  SecondDraftIssueCategory,
  SecondDraftReviewPassKey,
  SecondDraftRewriteIntent,
  SecondDraftSealReveal,
  WriteStudioState,
} from "./write-studio";
import type { ProjectSummary, SectionDocument } from "./types";

type TextSelection = { start: number; end: number; text: string };
type SourceSelection = TextSelection;
type ManualScrollAnchor = { targetOffset: number; sourceOffset: number };
type SecondDraftViewState = {
  targetRatio: number;
  sourceRatio: number;
  memoryMode: boolean;
  syncScroll: boolean;
  manualAnchors: ManualScrollAnchor[];
  repetitionHeatmap: boolean;
};

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function elementScrollRatio(element: HTMLElement): number {
  const max = Math.max(0, element.scrollHeight - element.clientHeight);
  return max > 0 ? clampRatio(element.scrollTop / max) : 0;
}

function scrollTopForRatio(element: HTMLElement, ratio: number): number {
  return clampRatio(ratio) * Math.max(0, element.scrollHeight - element.clientHeight);
}

function textWordCount(text: string): number {
  return text.trim().match(/\S+/g)?.length ?? 0;
}

type WordDiffPiece = { kind: "same" | "added" | "removed"; text: string };

function wordDiff(before: string, after: string): WordDiffPiece[] {
  const a = before.trim().split(/\s+/).filter(Boolean);
  const b = after.trim().split(/\s+/).filter(Boolean);
  if (!a.length && !b.length) return [];

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < a.length - prefix
    && suffix < b.length - prefix
    && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) suffix++;

  const pieces: WordDiffPiece[] = [];
  const samePrefix = a.slice(0, prefix).join(" ");
  const removed = a.slice(prefix, a.length - suffix).join(" ");
  const added = b.slice(prefix, b.length - suffix).join(" ");
  const sameSuffix = suffix ? a.slice(a.length - suffix).join(" ") : "";

  if (samePrefix) pieces.push({ kind: "same", text: samePrefix });
  if (removed) pieces.push({ kind: "removed", text: removed });
  if (added) pieces.push({ kind: "added", text: added });
  if (sameSuffix) pieces.push({ kind: "same", text: sameSuffix });
  return pieces;
}

function readSecondDraftViewState(key: string): SecondDraftViewState | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SecondDraftViewState>;
    const manualAnchors = Array.isArray(value.manualAnchors)
      ? value.manualAnchors
          .map((item) => ({
            targetOffset: Math.max(0, Math.round(Number(item?.targetOffset))),
            sourceOffset: Math.max(0, Math.round(Number(item?.sourceOffset))),
          }))
          .filter((item) => Number.isFinite(item.targetOffset) && Number.isFinite(item.sourceOffset))
          .sort((a, b) => a.targetOffset - b.targetOffset)
      : [];
    return {
      targetRatio: clampRatio(Number(value.targetRatio ?? 0)),
      sourceRatio: clampRatio(Number(value.sourceRatio ?? 0)),
      memoryMode: Boolean(value.memoryMode),
      syncScroll: Boolean(value.syncScroll && manualAnchors.length),
      manualAnchors,
      repetitionHeatmap: value.repetitionHeatmap !== false,
    };
  } catch {
    return null;
  }
}

type SecondDraftPaneProps = {
  project: ProjectSummary;
  targetSectionId: string;
  ornament: string;
  writeZoom: number;
  state: WriteStudioState | null;
  onState: (state: WriteStudioState) => void;
  onClose: () => void;
  onError: (message: string) => void;
  onSaveTarget: () => Promise<boolean>;
  onGetTargetMarkdown: () => Promise<string>;
  onRevealTarget: () => void;
};

const BURN_HIGHLIGHTS = [
  "folio-source-rewritten", "folio-source-cut", "folio-source-keep",
  "folio-source-sent", "folio-source-later", "folio-source-active",
] as const;

const ISSUE_CATEGORIES: Array<{ value: SecondDraftIssueCategory; label: string }> = [
  { value: "pacing", label: "Pacing" },
  { value: "continuity", label: "Continuity" },
  { value: "dialogue", label: "Dialogue" },
  { value: "character", label: "Character" },
  { value: "clarity", label: "Clarity" },
  { value: "research", label: "Research" },
  { value: "other", label: "Other" },
];

const REVIEW_PASSES: Array<{ key: SecondDraftReviewPassKey; label: string }> = [
  { key: "structure", label: "Structure" },
  { key: "continuity", label: "Continuity" },
  { key: "pacing", label: "Pacing" },
  { key: "character", label: "Character" },
  { key: "dialogue", label: "Dialogue" },
  { key: "prose", label: "Prose" },
  { key: "facts", label: "Facts" },
];

const REWRITE_INTENTS: Array<{ value: SecondDraftRewriteIntent; label: string }> = [
  { value: "general", label: "General" },
  { value: "tighten", label: "Tighten" },
  { value: "expand", label: "Expand" },
  { value: "clarify", label: "Clarify" },
  { value: "voice", label: "Voice" },
  { value: "pacing", label: "Pacing" },
  { value: "dialogue", label: "Dialogue" },
  { value: "emotion", label: "Emotion" },
  { value: "continuity", label: "Continuity" },
  { value: "description", label: "Description" },
];

function latestActive(blocks: SecondDraftBlock[], targetSectionId: string): SecondDraftBlock | null {
  return [...blocks]
    .filter((block) => block.targetSectionId === targetSectionId && block.status === "active")
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;
}

function highlightName(status: SecondDraftBlockStatus): string {
  return "folio-source-" + status;
}

export default function SecondDraftPane(props: SecondDraftPaneProps) {
  const pair = props.state?.secondDraft.pairs[props.targetSectionId] ?? null;
  const blocks = props.state?.secondDraft.blocks ?? [];
  const relevantBlocks = useMemo(
    () => blocks.filter((block) => block.targetSectionId === props.targetSectionId),
    [blocks, props.targetSectionId],
  );
  const activeBlock = useMemo(() => latestActive(blocks, props.targetSectionId), [blocks, props.targetSectionId]);
  const carryovers = useMemo(
    () => (props.state?.secondDraft.carryovers ?? []).filter(
      (item) => item.toTargetSectionId === props.targetSectionId && item.status === "pending",
    ),
    [props.state?.secondDraft.carryovers, props.targetSectionId],
  );
  const candidateSections = useMemo(
    () => props.project.sections.filter((section) => section.id !== props.targetSectionId && section.kind === "chapter"),
    [props.project.sections, props.targetSectionId],
  );

  const [sourceId, setSourceId] = useState<string>(() => pair?.sourceSectionId ?? candidateSections[0]?.id ?? "");
  const [sourceDoc, setSourceDoc] = useState<SectionDocument | null>(null);
  const [selection, setSelection] = useState<SourceSelection | null>(null);
  const [targetSelection, setTargetSelection] = useState<TextSelection | null>(null);
  const [memoryMode, setMemoryMode] = useState(false);
  const [memoryPeek, setMemoryPeek] = useState(false);
  const [syncScroll, setSyncScroll] = useState(false);
  const [manualAnchors, setManualAnchors] = useState<ManualScrollAnchor[]>([]);
  const [repetitionHeatmap, setRepetitionHeatmap] = useState(true);
  const [repetitionSummary, setRepetitionSummary] = useState({ words: 0, phrases: 0, occurrences: 0, high: 0 });
  const [linksPanelOpen, setLinksPanelOpen] = useState(false);
  const memoryModeStateRef = useRef(memoryMode);
  const syncScrollStateRef = useRef(syncScroll);
  const manualAnchorsStateRef = useRef(manualAnchors);
  const repetitionHeatmapStateRef = useRef(repetitionHeatmap);
  memoryModeStateRef.current = memoryMode;
  syncScrollStateRef.current = syncScroll;
  manualAnchorsStateRef.current = manualAnchors;
  repetitionHeatmapStateRef.current = repetitionHeatmap;
  const [sendTargetId, setSendTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [sealReveal, setSealReveal] = useState<SecondDraftSealReveal | null>(null);
  const [sourceChanged, setSourceChanged] = useState(false);
  const [issuePanelOpen, setIssuePanelOpen] = useState(false);
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false);
  const [issueCategory, setIssueCategory] = useState<SecondDraftIssueCategory>("clarity");
  const [issueNote, setIssueNote] = useState("");
  const [comparison, setComparison] = useState<{ block: SecondDraftBlock; sourceText: string; targetText: string } | null>(null);
  const [rewriteIntent, setRewriteIntent] = useState<SecondDraftRewriteIntent>("general");
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefDraft, setBriefDraft] = useState("");
  const [sceneIndex, setSceneIndex] = useState(0);
  const [sceneCount, setSceneCount] = useState(1);
  const sourceMatchesPair = Boolean(pair && pair.sourceSectionId === sourceDoc?.id);
  const laterBlocks = useMemo(
    () => relevantBlocks.filter((block) => block.status === "later").sort((a, b) => a.sourceStart - b.sourceStart),
    [relevantBlocks],
  );
  const latestUndoableBlock = useMemo(
    () => [...relevantBlocks]
      .filter((block) => block.status !== "sent")
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null,
    [relevantBlocks],
  );
  const relevantIssues = useMemo(
    () => (props.state?.secondDraft.issues ?? [])
      .filter((issue) => issue.targetSectionId === props.targetSectionId)
      .sort((a, b) => a.sourceStart - b.sourceStart),
    [props.state?.secondDraft.issues, props.targetSectionId],
  );
  const unresolvedIssues = useMemo(() => relevantIssues.filter((issue) => !issue.resolved), [relevantIssues]);
  const reviewPasses = props.state?.secondDraft.reviews?.[props.targetSectionId] ?? {};
  const reviewPassCount = REVIEW_PASSES.filter((item) => Boolean(reviewPasses[item.key])).length;
  const draftBrief = props.state?.secondDraft.briefs?.[props.targetSectionId] ?? "";
  const rewrittenBlocks = useMemo(
    () => relevantBlocks
      .filter((block) => block.status === "rewritten" && block.targetStart !== undefined && block.targetEnd !== undefined)
      .sort((a, b) => a.sourceStart - b.sourceStart),
    [relevantBlocks],
  );
  const selectedExistingBlock = useMemo(
    () => selection
      ? relevantBlocks.find((block) => block.sourceStart < selection.end && block.sourceEnd > selection.start) ?? null
      : null,
    [selection, relevantBlocks],
  );
  const sourceEditorRef = useRef<HTMLDivElement>(null);
  const sourcePaperRef = useRef<HTMLDivElement>(null);
  const scrollSuppressedUntilRef = useRef<{ target: number; source: number }>({ target: 0, source: 0 });
  const scrollLeaderRef = useRef<"target" | "source">("target");
  const scrollFrameRef = useRef<number | null>(null);
  const restoringScrollRef = useRef(false);
  const targetCaretRef = useRef<number | null>(null);
  const rewriteTargetSnapshotRef = useRef<{ text: string; anchor: number } | null>(null);
  const unreviewedCursorRef = useRef(0);
  const issueCursorRef = useRef(0);
  const changedCursorRef = useRef(0);
  const viewKey = useMemo(
    () => `folio.second-draft.view.v3:${props.project.projectId}:${props.targetSectionId}:${sourceId || "none"}`,
    [props.project.projectId, props.targetSectionId, sourceId],
  );

  useEffect(() => {
    if (!briefOpen) setBriefDraft(draftBrief);
  }, [draftBrief, props.targetSectionId, briefOpen]);

  function persistViewState(overrides: Partial<SecondDraftViewState> = {}) {
    const sourceEditor = sourceEditorRef.current;
    const targetEditor = document.querySelector<HTMLElement>(".manuscript-editor");
    const previous = readSecondDraftViewState(viewKey);
    const restoring = restoringScrollRef.current;
    const next: SecondDraftViewState = {
      targetRatio: restoring
        ? previous?.targetRatio ?? (targetEditor ? elementScrollRatio(targetEditor) : 0)
        : targetEditor ? elementScrollRatio(targetEditor) : previous?.targetRatio ?? 0,
      sourceRatio: restoring
        ? previous?.sourceRatio ?? (sourceEditor ? elementScrollRatio(sourceEditor) : 0)
        : sourceEditor ? elementScrollRatio(sourceEditor) : previous?.sourceRatio ?? 0,
      memoryMode: memoryModeStateRef.current,
      syncScroll: syncScrollStateRef.current,
      manualAnchors: manualAnchorsStateRef.current,
      repetitionHeatmap: repetitionHeatmapStateRef.current,
      ...overrides,
    };
    try { window.localStorage.setItem(viewKey, JSON.stringify(next)); } catch { /* best-effort UI memory */ }
  }

  useEffect(() => {
    setSourceId(pair?.sourceSectionId ?? candidateSections[0]?.id ?? "");
    setSelection(null);
    setSealReveal(null);
  }, [props.targetSectionId, pair?.sourceSectionId, props.project.projectId]);

  useEffect(() => {
    const saved = readSecondDraftViewState(viewKey);
    const nextMemory = saved?.memoryMode ?? false;
    const nextSync = saved?.syncScroll ?? false;
    const nextAnchors = saved?.manualAnchors ?? [];
    const nextRepetitions = saved?.repetitionHeatmap ?? true;
    // Mark restoration before any scroll-sync effect gets a chance to react.
    restoringScrollRef.current = Boolean(saved);
    memoryModeStateRef.current = nextMemory;
    syncScrollStateRef.current = nextSync;
    manualAnchorsStateRef.current = nextAnchors;
    repetitionHeatmapStateRef.current = nextRepetitions;
    setMemoryMode(nextMemory);
    setSyncScroll(nextSync);
    setManualAnchors(nextAnchors);
    setRepetitionHeatmap(nextRepetitions);
  }, [viewKey]);

  useEffect(() => {
    if (!sourceId) { setSourceDoc(null); return; }
    let cancelled = false;
    setSourceDoc(null);
    api.section(props.project.projectId, sourceId)
      .then((doc) => { if (!cancelled) setSourceDoc(doc); })
      .catch((error) => !cancelled && props.onError(error instanceof Error ? error.message : String(error)));
    return () => { cancelled = true; };
  }, [props.project.projectId, sourceId]);

  useEffect(() => {
    const editor = sourceEditorRef.current;
    if (!editor || !sourceDoc) return;
    editor.innerHTML = markdownToEditorHtml(
      sourceDoc.markdown,
      props.ornament,
      (asset) => `/api/projects/${encodeURIComponent(props.project.projectId)}/asset?path=${encodeURIComponent(asset)}`,
    );
    editor.dataset.sectionId = sourceDoc.id;
    editor.dataset.markdown = sourceDoc.markdown;
    setSelection(null);
    setSceneIndex(0);
    setSceneCount(Math.max(1, editor.querySelectorAll(".editor-scene-break").length + 1));
    const text = editor.textContent ?? "";
    setSourceChanged(Boolean(pair && pair.sourceSectionId === sourceDoc.id && pair.sourceFingerprint !== sourceFingerprint(text)));
  }, [sourceDoc?.id, sourceDoc?.markdown, props.ornament, props.project.projectId, pair?.sourceFingerprint, pair?.sourceSectionId]);

  useEffect(() => {
    const editor = sourceEditorRef.current;
    if (!editor || !sourceDoc) return;
    const updateSceneFromScroll = () => {
      const host = editor.getBoundingClientRect();
      const breaks = [...editor.querySelectorAll<HTMLElement>(".editor-scene-break")];
      let next = 0;
      for (const divider of breaks) {
        const rect = divider.getBoundingClientRect();
        if (rect.top <= host.top + Math.min(90, editor.clientHeight * .2)) next++;
        else break;
      }
      setSceneIndex(Math.max(0, Math.min(breaks.length, next)));
    };
    updateSceneFromScroll();
    editor.addEventListener("scroll", updateSceneFromScroll, { passive: true });
    return () => editor.removeEventListener("scroll", updateSceneFromScroll);
  }, [sourceDoc?.id, sourceDoc?.markdown]);

  useEffect(() => {
    if (!sourceDoc) return;
    const sourceEditor = sourceEditorRef.current;
    const targetEditor = document.querySelector<HTMLElement>(".manuscript-editor");
    const saved = readSecondDraftViewState(viewKey);
    if (!sourceEditor || !targetEditor) return;
    if (!saved) {
      restoringScrollRef.current = false;
      return;
    }

    restoringScrollRef.current = true;
    let cancelled = false;
    let frame = 0;
    const restoreWhenReady = () => {
      if (cancelled) return;
      const targetMax = Math.max(0, targetEditor.scrollHeight - targetEditor.clientHeight);
      const sourceMax = Math.max(0, sourceEditor.scrollHeight - sourceEditor.clientHeight);
      const targetReady = saved.targetRatio <= 0.001 || targetMax > 1;
      const sourceReady = saved.sourceRatio <= 0.001 || sourceMax > 1;

      if ((!targetReady || !sourceReady) && frame < 20) {
        frame++;
        requestAnimationFrame(restoreWhenReady);
        return;
      }

      targetEditor.scrollTop = scrollTopForRatio(targetEditor, saved.targetRatio);
      sourceEditor.scrollTop = scrollTopForRatio(sourceEditor, saved.sourceRatio);
      requestAnimationFrame(() => {
        if (cancelled) return;
        scrollSuppressedUntilRef.current.target = 0;
        scrollSuppressedUntilRef.current.source = 0;
        restoringScrollRef.current = false;
      });
    };
    requestAnimationFrame(restoreWhenReady);
    return () => { cancelled = true; };
  }, [sourceDoc?.id, sourceDoc?.markdown, viewKey]);

  useEffect(() => {
    const registry = (CSS as unknown as {
      highlights?: { set: (name: string, value: unknown) => unknown; delete: (name: string) => unknown };
    }).highlights;
    const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!registry || !HighlightCtor || !sourceEditorRef.current) return;
    for (const name of BURN_HIGHLIGHTS) registry.delete(name);
    if (!sourceMatchesPair || sourceChanged) {
      return () => { for (const name of BURN_HIGHLIGHTS) registry.delete(name); };
    }
    const editor = sourceEditorRef.current;
    const grouped = new Map<string, Range[]>();
    for (const block of relevantBlocks) {
      const range = rangeForTextOffsets(editor, block.sourceStart, block.sourceEnd);
      if (!range) continue;
      const name = highlightName(block.status);
      const list = grouped.get(name) ?? [];
      list.push(range);
      grouped.set(name, list);
    }
    for (const [name, ranges] of grouped) registry.set(name, new HighlightCtor(...ranges));
    return () => { for (const name of BURN_HIGHLIGHTS) registry.delete(name); };
  }, [relevantBlocks, sourceDoc?.id, sourceDoc?.markdown, sourceMatchesPair, sourceChanged]);

  useEffect(() => {
    const registry = (CSS as unknown as {
      highlights?: { set: (name: string, value: unknown) => unknown; delete: (name: string) => unknown };
    }).highlights;
    const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    const names = ["folio-repeat-phrase", "folio-repeat-low", "folio-repeat-medium", "folio-repeat-high"] as const;
    if (!registry || !HighlightCtor) return;

    let targetEditor: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attachFrame: number | null = null;
    let mutationObserver: MutationObserver | null = null;
    let attachAttempts = 0;

    const clear = () => { for (const name of names) registry.delete(name); };
    const update = () => {
      clear();
      if (!targetEditor || !repetitionHeatmapStateRef.current) {
        setRepetitionSummary({ words: 0, phrases: 0, occurrences: 0, high: 0 });
        return;
      }

      const text = targetEditor.textContent ?? "";
      const phraseHits = nearbyPhraseOccurrences(text, props.project.meta.language, 80);
      const wordHits = repetitionOccurrences(text, props.project.meta.language, 80);
      const grouped = new Map<string, Range[]>();
      const words = new Set<string>();
      const phrases = new Set<string>();
      let high = 0;

      // Register phrase ranges first. Word-level severity highlights are added
      // afterwards, so a strong single-word warning stays visible even when it
      // sits inside a repeated phrase.
      for (const hit of phraseHits) {
        const range = rangeForTextOffsets(targetEditor, hit.start, hit.end);
        if (!range) continue;
        const list = grouped.get("folio-repeat-phrase") ?? [];
        list.push(range);
        grouped.set("folio-repeat-phrase", list);
        phrases.add(hit.phrase);
      }

      let phraseCursor = 0;
      for (const hit of wordHits) {
        while (phraseCursor < phraseHits.length && phraseHits[phraseCursor].end < hit.start) phraseCursor++;
        let coveredByPhrase = false;
        for (let index = phraseCursor; index < phraseHits.length && phraseHits[index].start <= hit.start; index++) {
          if (phraseHits[index].end >= hit.end) {
            coveredByPhrase = true;
            break;
          }
        }
        if (coveredByPhrase) continue;

        const range = rangeForTextOffsets(targetEditor, hit.start, hit.end);
        if (!range) continue;
        const name = `folio-repeat-${hit.severity}`;
        const list = grouped.get(name) ?? [];
        list.push(range);
        grouped.set(name, list);
        words.add(hit.word);
        if (hit.severity === "high") high++;
      }

      for (const name of names) {
        const ranges = grouped.get(name);
        if (ranges?.length) registry.set(name, new HighlightCtor(...ranges));
      }
      setRepetitionSummary({
        words: words.size,
        phrases: phrases.size,
        occurrences: wordHits.length + phraseHits.length,
        high,
      });
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(update, 90);
    };

    const attach = (editor: HTMLElement) => {
      if (targetEditor === editor) return;
      if (targetEditor) targetEditor.removeEventListener("input", schedule);
      mutationObserver?.disconnect();
      targetEditor = editor;
      targetEditor.addEventListener("input", schedule);
      mutationObserver = new MutationObserver(schedule);
      mutationObserver.observe(targetEditor, { subtree: true, childList: true, characterData: true });
      requestAnimationFrame(update);
    };

    const attachWhenReady = () => {
      const editor = document.querySelector<HTMLElement>(".manuscript-editor");
      if (editor) {
        attach(editor);
        return;
      }
      if (attachAttempts++ < 120) attachFrame = requestAnimationFrame(attachWhenReady);
    };

    attachWhenReady();
    return () => {
      if (timer) clearTimeout(timer);
      if (attachFrame !== null) cancelAnimationFrame(attachFrame);
      mutationObserver?.disconnect();
      targetEditor?.removeEventListener("input", schedule);
      clear();
    };
  }, [props.targetSectionId, props.project.meta.language, repetitionHeatmap]);

  useEffect(() => {
    const targetEditor = document.querySelector<HTMLElement>(".manuscript-editor");
    if (!targetEditor) return;
    const rememberTargetSelection = () => {
      const selected = selectedTextOffsets(targetEditor);
      setTargetSelection(selected);
      const offset = caretTextOffset(targetEditor);
      if (offset !== null) targetCaretRef.current = offset;
    };
    rememberTargetSelection();
    targetEditor.addEventListener("mouseup", rememberTargetSelection);
    targetEditor.addEventListener("keyup", rememberTargetSelection);
    targetEditor.addEventListener("input", rememberTargetSelection);
    targetEditor.addEventListener("focus", rememberTargetSelection);
    return () => {
      targetEditor.removeEventListener("mouseup", rememberTargetSelection);
      targetEditor.removeEventListener("keyup", rememberTargetSelection);
      targetEditor.removeEventListener("input", rememberTargetSelection);
      targetEditor.removeEventListener("focus", rememberTargetSelection);
    };
  }, [props.targetSectionId]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => { if (event.key === "Alt" && memoryMode) setMemoryPeek(true); };
    const up = (event: KeyboardEvent) => { if (event.key === "Alt") setMemoryPeek(false); };
    const blur = () => setMemoryPeek(false);
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
    };
  }, [memoryMode]);

  useEffect(() => {
    if (!pair || !sourceMatchesPair || sourceChanged) return;
    const sourceEditor = sourceEditorRef.current;
    const targetEditor = document.querySelector<HTMLElement>(".manuscript-editor");
    if (!sourceEditor || !targetEditor) return;

    const scrollPointForOffset = (editor: HTMLElement, offset: number): number | null => {
      const length = editor.textContent?.length ?? 0;
      const max = Math.max(0, editor.scrollHeight - editor.clientHeight);
      if (length <= 0 || max <= 0) return 0;
      const start = Math.max(0, Math.min(length - 1, offset));
      const range = rangeForTextOffsets(editor, start, start + 1);
      if (!range) return null;
      const rect = range.getBoundingClientRect();
      const host = editor.getBoundingClientRect();
      const contentY = rect.top - host.top + editor.scrollTop;
      // Keep linked text around the upper third of each editor. Raw content-Y
      // cannot be used as scrollTop near the end of a document because the
      // browser clamps it, which was the main source of late-chapter drift.
      return Math.max(0, Math.min(max, contentY - editor.clientHeight * 0.28));
    };

    const buildAnchors = () => {
      const targetMax = Math.max(0, targetEditor.scrollHeight - targetEditor.clientHeight);
      const sourceMax = Math.max(0, sourceEditor.scrollHeight - sourceEditor.clientHeight);
      const manual: Array<{ target: number; source: number }> = [];

      for (const anchor of manualAnchors) {
        const targetPoint = scrollPointForOffset(targetEditor, anchor.targetOffset);
        const sourcePoint = scrollPointForOffset(sourceEditor, anchor.sourceOffset);
        if (targetPoint !== null && sourcePoint !== null) manual.push({ target: targetPoint, source: sourcePoint });
      }

      const edgeTolerance = 3;
      const anchors = [...manual];
      if (!manual.some((item) => item.target <= edgeTolerance || item.source <= edgeTolerance)) {
        anchors.push({ target: 0, source: 0 });
      }
      if (!manual.some((item) => item.target >= targetMax - edgeTolerance || item.source >= sourceMax - edgeTolerance)) {
        anchors.push({ target: targetMax, source: sourceMax });
      }
      return anchors;
    };

    let cachedAnchors = buildAnchors();
    let persistTimer: ReturnType<typeof setTimeout> | null = null;
    const rebuildAnchors = () => { cachedAnchors = buildAnchors(); };
    const remember = () => {
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        persistTimer = null;
        persistViewState();
      }, 45);
    };
    const now = () => performance.now();

    const syncOneWay = (from: "target" | "source") => {
      if (restoringScrollRef.current || !syncScrollStateRef.current || manualAnchorsStateRef.current.length === 0) return;
      const anchors = cachedAnchors;
      if (!anchors.length) return;

      if (from === "target") {
        const max = Math.max(0, sourceEditor.scrollHeight - sourceEditor.clientHeight);
        const next = Math.max(0, Math.min(max, interpolatePairedScroll(targetEditor.scrollTop, anchors)));
        if (Math.abs(sourceEditor.scrollTop - next) > 0.75) {
          scrollSuppressedUntilRef.current.source = now() + 90;
          sourceEditor.scrollTop = next;
        }
      } else {
        const inverse = anchors.map((item) => ({ target: item.source, source: item.target }));
        const max = Math.max(0, targetEditor.scrollHeight - targetEditor.clientHeight);
        const next = Math.max(0, Math.min(max, interpolatePairedScroll(sourceEditor.scrollTop, inverse)));
        if (Math.abs(targetEditor.scrollTop - next) > 0.75) {
          scrollSuppressedUntilRef.current.target = now() + 90;
          targetEditor.scrollTop = next;
        }
      }
      remember();
    };

    const schedule = (from: "target" | "source") => {
      scrollLeaderRef.current = from;
      if (scrollFrameRef.current !== null) return;
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        syncOneWay(scrollLeaderRef.current);
      });
    };

    const userTookControl = (side: "target" | "source") => {
      scrollSuppressedUntilRef.current[side] = 0;
      scrollLeaderRef.current = side;
    };

    const onTargetScroll = () => {
      if (restoringScrollRef.current) return;
      if (now() < scrollSuppressedUntilRef.current.target) { remember(); return; }
      schedule("target");
    };
    const onSourceScroll = () => {
      if (restoringScrollRef.current) return;
      if (now() < scrollSuppressedUntilRef.current.source) { remember(); return; }
      schedule("source");
    };
    const targetIntent = () => userTookControl("target");
    const sourceIntent = () => userTookControl("source");
    const targetInput = () => {
      rebuildAnchors();
      schedule("target");
    };

    targetEditor.addEventListener("scroll", onTargetScroll, { passive: true });
    sourceEditor.addEventListener("scroll", onSourceScroll, { passive: true });
    for (const event of ["wheel", "pointerdown", "touchstart", "keydown"] as const) {
      targetEditor.addEventListener(event, targetIntent, { passive: event !== "keydown" });
      sourceEditor.addEventListener(event, sourceIntent, { passive: event !== "keydown" });
    }
    targetEditor.addEventListener("input", targetInput);

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      rebuildAnchors();
      schedule(scrollLeaderRef.current);
    });
    resizeObserver?.observe(targetEditor);
    resizeObserver?.observe(sourceEditor);

    return () => {
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = null;
      scrollSuppressedUntilRef.current.target = 0;
      scrollSuppressedUntilRef.current.source = 0;
      targetEditor.removeEventListener("scroll", onTargetScroll);
      sourceEditor.removeEventListener("scroll", onSourceScroll);
      for (const event of ["wheel", "pointerdown", "touchstart", "keydown"] as const) {
        targetEditor.removeEventListener(event, targetIntent);
        sourceEditor.removeEventListener(event, sourceIntent);
      }
      targetEditor.removeEventListener("input", targetInput);
      resizeObserver?.disconnect();
    };
  }, [pair?.sourceSectionId, sourceMatchesPair, sourceChanged, sourceDoc?.id, syncScroll, manualAnchors, memoryMode, viewKey]);

  function linkSelectedLines() {
    if (!selection || !targetSelection) return;
    const anchor = {
      targetOffset: Math.round((targetSelection.start + targetSelection.end) / 2),
      sourceOffset: Math.round((selection.start + selection.end) / 2),
    };
    const next = [...manualAnchors.filter((item) =>
      Math.abs(item.targetOffset - anchor.targetOffset) > 8
      && Math.abs(item.sourceOffset - anchor.sourceOffset) > 8
    ), anchor].sort((a, b) => a.targetOffset - b.targetOffset);
    setManualAnchors(next);
    setSyncScroll(true);
    setTargetSelection(null);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    persistViewState({ manualAnchors: next, syncScroll: true });
  }

  function clearManualScrollAnchors() {
    setManualAnchors([]);
    setSyncScroll(false);
    setLinksPanelOpen(false);
    manualAnchorsStateRef.current = [];
    syncScrollStateRef.current = false;
    persistViewState({ manualAnchors: [], syncScroll: false });
  }

  function removeManualScrollAnchor(index: number) {
    const next = manualAnchors.filter((_, itemIndex) => itemIndex !== index);
    setManualAnchors(next);
    manualAnchorsStateRef.current = next;
    const nextSync = next.length > 0 && syncScrollStateRef.current;
    setSyncScroll(nextSync);
    syncScrollStateRef.current = nextSync;
    if (!next.length) setLinksPanelOpen(false);
    persistViewState({ manualAnchors: next, syncScroll: nextSync });
  }

  function jumpToManualScrollAnchor(anchor: ManualScrollAnchor) {
    const sourceEditor = sourceEditorRef.current;
    const targetEditor = document.querySelector<HTMLElement>(".manuscript-editor");
    if (!sourceEditor || !targetEditor) return;

    const reveal = (editor: HTMLElement, offset: number) => {
      const length = editor.textContent?.length ?? 0;
      if (!length) return;
      const start = Math.max(0, Math.min(length - 1, offset));
      const range = rangeForTextOffsets(editor, start, start + 1);
      if (!range) return;
      const rect = range.getBoundingClientRect();
      const host = editor.getBoundingClientRect();
      const next = editor.scrollTop + rect.top - host.top - editor.clientHeight * .28;
      editor.scrollTop = Math.max(0, Math.min(editor.scrollHeight - editor.clientHeight, next));
    };

    const suppressUntil = performance.now() + 140;
    scrollSuppressedUntilRef.current.target = suppressUntil;
    scrollSuppressedUntilRef.current.source = suppressUntil;
    reveal(targetEditor, anchor.targetOffset);
    reveal(sourceEditor, anchor.sourceOffset);
  }

  function captureSelection() {
    const editor = sourceEditorRef.current;
    if (editor) setSelection(selectedTextOffsets(editor));
  }

  function currentTargetCaret(): number | undefined {
    const editor = document.querySelector<HTMLElement>(".manuscript-editor");
    if (!editor) return undefined;
    const live = caretTextOffset(editor);
    if (live !== null) {
      targetCaretRef.current = live;
      return live;
    }
    return targetCaretRef.current ?? (editor.textContent?.length ?? 0);
  }

  function restoreTargetCaret(offset: number | undefined) {
    const editor = document.querySelector<HTMLElement>(".manuscript-editor");
    if (!editor || offset === undefined) return;
    targetCaretRef.current = offset;
    editor.focus();
    placeCaretAtTextOffset(editor, offset);
  }

  async function pairSource() {
    const editor = sourceEditorRef.current;
    if (!editor || !sourceDoc) return;
    if (pair && relevantBlocks.length > 0 && (pair.sourceSectionId !== sourceDoc.id || sourceChanged)) {
      const confirmed = window.confirm("Re-pairing this chapter will clear its existing Second Draft source decisions. Continue?");
      if (!confirmed) return;
    }
    setBusy(true);
    try {
      const text = editor.textContent ?? "";
      props.onState(await api.setSecondDraftPair(
        props.project.projectId, props.targetSectionId, sourceDoc.id, text.length, sourceFingerprint(text),
      ));
      setSourceChanged(false);
      setSelection(null);
      setManualAnchors([]);
      setSyncScroll(false);
      setTargetSelection(null);
      persistViewState({ manualAnchors: [], syncScroll: false });
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function createAndSet(status: Exclude<SecondDraftBlockStatus, "sent">) {
    if (!selection || !pair || !sourceMatchesPair || sourceChanged) return;
    setBusy(true);
    try {
      const targetStart = status === "active" ? currentTargetCaret() : undefined;
      if (status === "active") {
        const targetEditor = document.querySelector<HTMLElement>(".manuscript-editor");
        rewriteTargetSnapshotRef.current = {
          text: targetEditor?.textContent ?? "",
          anchor: targetStart ?? 0,
        };
      }
      const state = await api.createSecondDraftBlock(props.project.projectId, {
        targetSectionId: props.targetSectionId,
        sourceStart: selection.start,
        sourceEnd: selection.end,
        sourceText: selection.text,
        targetStart,
        status,
        intent: status === "active" ? rewriteIntent : undefined,
      });
      props.onState(state);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
      if (status === "active") {
        props.onRevealTarget();
        requestAnimationFrame(() => restoreTargetCaret(targetStart));
      }
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function updateActiveIntent(intent: SecondDraftRewriteIntent) {
    if (!activeBlock) { setRewriteIntent(intent); return; }
    setRewriteIntent(intent);
    setBusy(true);
    try {
      props.onState(await api.updateSecondDraftBlock(props.project.projectId, activeBlock.id, { intent }));
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function saveDraftBrief() {
    setBusy(true);
    try {
      props.onState(await api.setSecondDraftBrief(props.project.projectId, props.targetSectionId, briefDraft.trim()));
      setBriefOpen(false);
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  function jumpToScene(nextIndex: number) {
    const editor = sourceEditorRef.current;
    if (!editor) return;
    const breaks = [...editor.querySelectorAll<HTMLElement>(".editor-scene-break")];
    const safe = Math.max(0, Math.min(breaks.length, nextIndex));
    setSceneIndex(safe);
    if (safe === 0) {
      editor.scrollTop = 0;
    } else {
      const divider = breaks[safe - 1];
      const host = editor.getBoundingClientRect();
      const rect = divider.getBoundingClientRect();
      editor.scrollTop = Math.max(0, editor.scrollTop + rect.top - host.top - 18);
    }
    editor.dispatchEvent(new Event("scroll"));
  }

  async function finishActive(status: Exclude<SecondDraftBlockStatus, "active" | "sent">) {
    if (!activeBlock) return;
    setBusy(true);
    try {
      let targetStart = activeBlock.targetStart;
      let targetEnd: number | undefined;
      if (status === "rewritten") {
        const targetEditor = document.querySelector<HTMLElement>(".manuscript-editor");
        const snapshot = rewriteTargetSnapshotRef.current;
        const changed = snapshot && targetEditor
          ? changedTextRange(snapshot.text, targetEditor.textContent ?? "", snapshot.anchor)
          : null;
        if (changed) {
          targetStart = changed.start;
          targetEnd = changed.end;
        } else {
          targetEnd = currentTargetCaret();
        }
      } else if (status === "keep") {
        targetEnd = currentTargetCaret();
      }
      props.onState(await api.updateSecondDraftBlock(props.project.projectId, activeBlock.id, {
        status,
        targetStart,
        targetEnd,
      }));
      rewriteTargetSnapshotRef.current = null;
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function resumeLater(block: SecondDraftBlock) {
    if (block.status !== "later") return;
    setBusy(true);
    try {
      const targetStart = currentTargetCaret();
      const targetEditor = document.querySelector<HTMLElement>(".manuscript-editor");
      rewriteTargetSnapshotRef.current = {
        text: targetEditor?.textContent ?? "",
        anchor: targetStart ?? 0,
      };
      props.onState(await api.updateSecondDraftBlock(props.project.projectId, block.id, {
        status: "active",
        targetStart,
      }));
      setSelection(null);
      window.getSelection()?.removeAllRanges();
      props.onRevealTarget();
      requestAnimationFrame(() => {
        const source = sourceEditorRef.current;
        const range = source ? rangeForTextOffsets(source, block.sourceStart, block.sourceEnd) : null;
        if (source && range) {
          const host = source.getBoundingClientRect();
          const rect = range.getBoundingClientRect();
          source.scrollTop = Math.max(0, source.scrollTop + rect.top - host.top - source.clientHeight * .28);
          source.dispatchEvent(new Event("scroll"));
        }
        restoreTargetCaret(targetStart);
      });
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function resolveLater(block: SecondDraftBlock, status: "cut" | "keep") {
    if (block.status !== "later") return;
    setBusy(true);
    try {
      props.onState(await api.updateSecondDraftBlock(props.project.projectId, block.id, { status }));
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function undoDecision(block: SecondDraftBlock) {
    if (block.status === "sent") return;
    setBusy(true);
    try {
      if (block.status === "active") rewriteTargetSnapshotRef.current = null;
      props.onState(await api.removeSecondDraftBlock(props.project.projectId, block.id));
      setSelection(null);
      setTargetSelection(null);
      window.getSelection()?.removeAllRanges();
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  function jumpToNextUnreviewed() {
    const editor = sourceEditorRef.current;
    if (!editor || !pair) return;
    const text = editor.textContent ?? "";
    if (!text.length) return;

    const occupied = relevantBlocks
      .map((block) => [Math.max(0, block.sourceStart), Math.min(text.length, block.sourceEnd)] as const)
      .filter(([start, end]) => end > start)
      .sort((a, b) => a[0] - b[0]);

    const nextGap = (from: number): { start: number; end: number } | null => {
      let cursor = Math.max(0, Math.min(text.length, from));
      for (const [start, end] of occupied) {
        if (end <= cursor) continue;
        if (start > cursor) return { start: cursor, end: start };
        cursor = Math.max(cursor, end);
      }
      return cursor < text.length ? { start: cursor, end: text.length } : null;
    };

    let gap = nextGap(unreviewedCursorRef.current);
    if (!gap) gap = nextGap(0);
    if (!gap) {
      props.onError("Every source passage already has a Second Draft decision.");
      return;
    }

    let start = gap.start;
    while (start < gap.end && /\s/.test(text[start] ?? "")) start++;
    if (start >= gap.end) {
      unreviewedCursorRef.current = gap.end + 1;
      jumpToNextUnreviewed();
      return;
    }
    let end = Math.min(gap.end, start + 72);
    while (end > start + 1 && /\s/.test(text[end - 1] ?? "")) end--;
    const range = rangeForTextOffsets(editor, start, end);
    if (!range) return;
    const selectionApi = window.getSelection();
    selectionApi?.removeAllRanges();
    selectionApi?.addRange(range);
    const normalized = range.cloneContents().textContent ?? range.toString();
    setSelection({ start, end, text: normalized });
    const host = editor.getBoundingClientRect();
    const rect = range.getBoundingClientRect();
    editor.scrollTop = Math.max(0, editor.scrollTop + rect.top - host.top - editor.clientHeight * .3);
    unreviewedCursorRef.current = Math.min(text.length, end + 1);
  }

  function selectAndRevealSourceRange(start: number, end: number) {
    const editor = sourceEditorRef.current;
    if (!editor) return;
    const range = rangeForTextOffsets(editor, start, end);
    if (!range) return;
    const selectionApi = window.getSelection();
    selectionApi?.removeAllRanges();
    selectionApi?.addRange(range);
    const normalized = range.cloneContents().textContent ?? range.toString();
    setSelection({ start, end, text: normalized });
    const host = editor.getBoundingClientRect();
    const rect = range.getBoundingClientRect();
    editor.scrollTop = Math.max(0, editor.scrollTop + rect.top - host.top - editor.clientHeight * .3);
  }

  async function createIssue() {
    if (!selection || !pair || !sourceMatchesPair || sourceChanged) return;
    setBusy(true);
    try {
      props.onState(await api.createSecondDraftIssue(props.project.projectId, {
        targetSectionId: props.targetSectionId,
        sourceStart: selection.start,
        sourceEnd: selection.end,
        sourceText: selection.text,
        category: issueCategory,
        note: issueNote.trim(),
      }));
      setIssueNote("");
      setIssuePanelOpen(true);
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function resolveIssue(issue: SecondDraftIssue) {
    setBusy(true);
    try { props.onState(await api.updateSecondDraftIssue(props.project.projectId, issue.id, { resolved: true })); }
    catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  function jumpToNextIssue() {
    if (!unresolvedIssues.length) return;
    const next = unresolvedIssues.find((issue) => issue.sourceStart >= issueCursorRef.current) ?? unresolvedIssues[0];
    issueCursorRef.current = next.sourceEnd + 1;
    selectAndRevealSourceRange(next.sourceStart, next.sourceEnd);
    setIssuePanelOpen(true);
  }

  function openComparison(block: SecondDraftBlock) {
    if (block.status !== "rewritten" || block.targetStart === undefined || block.targetEnd === undefined) return;
    const target = document.querySelector<HTMLElement>(".manuscript-editor");
    if (!target) return;
    const range = rangeForTextOffsets(target, block.targetStart, block.targetEnd);
    const targetText = range?.cloneContents().textContent ?? range?.toString() ?? "";
    setComparison({ block, sourceText: block.sourceText, targetText });
  }

  function jumpToNextChanged() {
    if (!rewrittenBlocks.length) return;
    const index = changedCursorRef.current % rewrittenBlocks.length;
    const block = rewrittenBlocks[index];
    changedCursorRef.current = index + 1;
    selectAndRevealSourceRange(block.sourceStart, block.sourceEnd);
    const target = document.querySelector<HTMLElement>(".manuscript-editor");
    if (target && block.targetStart !== undefined) {
      const range = rangeForTextOffsets(target, block.targetStart, Math.max(block.targetStart + 1, block.targetEnd ?? block.targetStart + 1));
      if (range) {
        const host = target.getBoundingClientRect();
        const rect = range.getBoundingClientRect();
        target.scrollTop = Math.max(0, target.scrollTop + rect.top - host.top - target.clientHeight * .3);
      }
    }
    openComparison(block);
  }

  async function toggleReviewPass(key: SecondDraftReviewPassKey) {
    const next = { ...reviewPasses, [key]: !reviewPasses[key] };
    setBusy(true);
    try { props.onState(await api.setSecondDraftReviewPasses(props.project.projectId, props.targetSectionId, next)); }
    catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  const canSendAhead = Boolean(selection && pair && sourceMatchesPair && sendTargetId && !sourceChanged && !busy);

  async function sendAhead() {
    if (!canSendAhead || !selection || !pair) return;
    setBusy(true);
    try {
      props.onState(await api.sendSecondDraftAhead(props.project.projectId, {
        fromTargetSectionId: props.targetSectionId,
        toTargetSectionId: sendTargetId,
        sourceStart: selection.start,
        sourceEnd: selection.end,
        sourceText: selection.text,
      }));
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function updateCarryover(item: SecondDraftCarryover, status: "used" | "dismissed") {
    setBusy(true);
    try { props.onState(await api.updateSecondDraftCarryover(props.project.projectId, item.id, status)); }
    catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function sealChapter() {
    if (!pair || sourceChanged) return;
    setBusy(true);
    try {
      if (!(await props.onSaveTarget())) return;
      const markdown = await props.onGetTargetMarkdown();
      const result = await api.sealSecondDraftChapter(props.project.projectId, props.targetSectionId, markdown);
      props.onState(result.state);
      setSealReveal(result.reveal);
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  const progress = secondDraftProgress(pair, blocks);
  const unresolved = relevantBlocks.filter((block) => block.status === "active" || block.status === "later").length;
  const processed = relevantBlocks.filter((block) => ["rewritten", "cut", "keep", "sent"].includes(block.status)).length;
  const sendOptions = props.project.sections.filter(
    (section) => section.kind === "chapter" && section.id !== props.targetSectionId && section.id !== pair?.sourceSectionId,
  );

  return <section className={`writing-split-pane second-draft-pane ${memoryMode ? "memory-mode" : ""} ${memoryPeek ? "memory-peek" : ""}`} aria-label="Second Draft source">
    <div className="writing-split-top-strip" aria-hidden="true" />
    <header className="writing-split-header second-draft-header">
      <div className="writing-split-title">
        <strong>Second Draft</strong>
        <select aria-label="Source draft chapter" value={sourceId} onChange={(event) => setSourceId(event.target.value)} disabled={busy || Boolean(activeBlock)}>
          {candidateSections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
        </select>
        {(!pair || pair.sourceSectionId !== sourceId || sourceChanged) &&
          <button type="button" className="second-draft-pair" disabled={busy || !sourceDoc} onClick={() => void pairSource()}>
            {pair && sourceChanged ? "Re-pair source" : "Use as source"}
          </button>}
      </div>
      <div className="second-draft-head-actions">
        {sourceMatchesPair && <span className="second-draft-progress">{Math.round(progress * 100)}% source</span>}
        {sourceMatchesPair && <button type="button" className={reviewPanelOpen ? "active" : ""} onClick={() => {
          setReviewPanelOpen((value) => !value);
          setIssuePanelOpen(false);
        }}>Passes {reviewPassCount}/{REVIEW_PASSES.length}</button>}
        {sourceMatchesPair && <button type="button" className={issuePanelOpen ? "active" : ""} onClick={() => {
          setIssuePanelOpen((value) => !value);
          setReviewPanelOpen(false);
        }}>Issues {unresolvedIssues.length}</button>}
        {sourceMatchesPair && <button type="button" className={briefOpen ? "active" : ""} title={draftBrief || "Set the goal for this chapter rewrite"} onClick={() => {
          setBriefDraft(draftBrief);
          setBriefOpen((value) => !value);
          setIssuePanelOpen(false);
          setReviewPanelOpen(false);
        }}>Brief{draftBrief ? " •" : ""}</button>}
        <button type="button" className={"second-draft-repeat-toggle " + (repetitionHeatmap ? "active" : "")} aria-pressed={repetitionHeatmap}
          aria-label={repetitionHeatmap ? "Hide repetition highlights" : "Show repetition highlights"}
          title={repetitionHeatmap
            ? `Hide repetition highlights · ${repetitionSummary.words} repeated words · ${repetitionSummary.phrases} repeated phrases`
            : "Show nearby word and phrase repetitions in the new draft"}
          onClick={() => setRepetitionHeatmap((value) => {
            const next = !value;
            repetitionHeatmapStateRef.current = next;
            persistViewState({ repetitionHeatmap: next });
            return next;
          })}>
          <svg className="second-draft-repeat-eye" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M1.8 10s3.1-5 8.2-5 8.2 5 8.2 5-3.1 5-8.2 5-8.2-5-8.2-5Z" />
            <circle cx="10" cy="10" r="2.35" />
            {!repetitionHeatmap && <path className="slash" d="M3.4 3.4 16.6 16.6" />}
          </svg>
          <span>Repeats{repetitionHeatmap && (repetitionSummary.words + repetitionSummary.phrases) > 0 ? ` ${repetitionSummary.words + repetitionSummary.phrases}` : ""}</span>
        </button>
        <button type="button" className={memoryMode ? "active" : ""} aria-pressed={memoryMode} title="Hide source while writing; hold Alt to peek" onClick={() => setMemoryMode((value) => {
          const next = !value;
          persistViewState({ memoryMode: next });
          return next;
        })}>Memory</button>
        <button type="button" title="Close Second Draft" aria-label="Close Second Draft" onClick={props.onClose}>×</button>
      </div>
    </header>

    {carryovers.length > 0 && <div className="second-draft-arrivals">
      <strong>{carryovers.length} carried here</strong>
      <div>{carryovers.map((item) => <article key={item.id}>
        <p>{item.sourceText}</p>
        <button disabled={busy} onClick={() => void updateCarryover(item, "used")}>Mark used</button>
        <button disabled={busy} onClick={() => void updateCarryover(item, "dismissed")}>Dismiss</button>
      </article>)}</div>
    </div>}

    {sourceChanged && sourceMatchesPair && <div className="second-draft-warning">
      Source changed since it was paired. Re-pair it before continuing so Source Burn and scroll anchors stay exact.
    </div>}

    <div className="writing-split-toolbar second-draft-source-toolbar" aria-label="Second Draft source controls">
      <div className="second-draft-source-meta">
        <span>Source draft · read only</span>
        {memoryMode && <span className="memory-hint">Hold Alt to peek</span>}
      </div>
      {sourceMatchesPair && !sourceChanged && <>
        <div className="second-draft-scene-controls" role="group" aria-label="Source scene navigation">
          <button type="button" disabled={sceneIndex <= 0} onClick={() => jumpToScene(sceneIndex - 1)} title="Previous source scene">‹</button>
          <span>Scene {sceneIndex + 1}/{sceneCount}</span>
          <button type="button" disabled={sceneIndex >= sceneCount - 1} onClick={() => jumpToScene(sceneIndex + 1)} title="Next source scene">›</button>
        </div>
        <div className="second-draft-review-controls" role="group" aria-label="Second Draft review navigation">
          <button type="button" onClick={jumpToNextUnreviewed}>Next unreviewed</button>
          <button type="button" disabled={!rewrittenBlocks.length} onClick={jumpToNextChanged}>Next changed</button>
          <button type="button" disabled={!unresolvedIssues.length} onClick={jumpToNextIssue}>Next issue</button>
          <button type="button" disabled={!latestUndoableBlock || busy}
            title={latestUndoableBlock ? "Undo the most recent Second Draft decision" : "No decision to undo"}
            onClick={() => latestUndoableBlock && void undoDecision(latestUndoableBlock)}>Undo last</button>
        </div>
        <div className="second-draft-sync-controls" role="group" aria-label="Paired scroll controls">
          <span className="second-draft-sync-status">{manualAnchors.length === 0
            ? "Select matching lines"
            : syncScroll
              ? `Synced · ${manualAnchors.length} link${manualAnchors.length === 1 ? "" : "s"}`
              : `Paused · ${manualAnchors.length} link${manualAnchors.length === 1 ? "" : "s"}`}</span>
          <button type="button" disabled={manualAnchors.length === 0} className={syncScroll ? "active" : ""} aria-pressed={syncScroll}
            title={manualAnchors.length === 0 ? "Link one source line to one target line first" : syncScroll ? "Pause paired scrolling" : "Resume paired scrolling"}
            onClick={() => setSyncScroll((value) => {
              const next = manualAnchors.length > 0 && !value;
              persistViewState({ syncScroll: next });
              return next;
            })}>Sync</button>
          <button type="button" disabled={!selection || !targetSelection}
            title="Select matching text on the source and target, then link those exact lines"
            onClick={linkSelectedLines}>Link lines</button>
          {manualAnchors.length > 0 && <button type="button" className={linksPanelOpen ? "active" : ""}
            aria-expanded={linksPanelOpen} title="View, jump to, or remove individual paired-scroll links"
            onClick={() => setLinksPanelOpen((value) => !value)}>Links {manualAnchors.length}</button>}
          {manualAnchors.length > 0 && <button type="button" title="Remove all explicit text links"
            onClick={clearManualScrollAnchors}>Reset links</button>}
          {linksPanelOpen && manualAnchors.length > 0 && <div className="second-draft-links-popover" role="dialog" aria-label="Paired scroll links">
            <div className="second-draft-links-head"><strong>Scroll links</strong><span>{manualAnchors.length}</span></div>
            <div className="second-draft-links-list">
              {manualAnchors.map((anchor, index) => <div className="second-draft-link-row" key={`${anchor.targetOffset}:${anchor.sourceOffset}`}>
                <button type="button" className="second-draft-link-jump" title="Jump both drafts to this link"
                  onClick={() => jumpToManualScrollAnchor(anchor)}>
                  <strong>Link {index + 1}</strong>
                  <span>Target {anchor.targetOffset.toLocaleString()} ↔ Source {anchor.sourceOffset.toLocaleString()}</span>
                </button>
                <button type="button" className="second-draft-link-remove" aria-label={`Remove link ${index + 1}`}
                  title="Remove this link" onClick={() => removeManualScrollAnchor(index)}>×</button>
              </div>)}
            </div>
          </div>}
        </div>
      </>}
    </div>

    {sourceMatchesPair && !sourceChanged && pair && <div className="second-draft-map" aria-label="Second Draft revision map">
      <div className="second-draft-map-track">
        {relevantBlocks.map((block) => {
          const left = Math.max(0, Math.min(100, (block.sourceStart / Math.max(1, pair.sourceTextLength)) * 100));
          const width = Math.max(.65, Math.min(100 - left, ((block.sourceEnd - block.sourceStart) / Math.max(1, pair.sourceTextLength)) * 100));
          return <button key={block.id} type="button"
            className={"second-draft-map-segment " + block.status}
            style={{ left: left + "%", width: width + "%" }}
            title={`${block.status}${block.intent && block.intent !== "general" ? " · " + block.intent : ""}: ${block.sourceText.slice(0, 90)}`}
            onClick={() => selectAndRevealSourceRange(block.sourceStart, block.sourceEnd)} />;
        })}
        {unresolvedIssues.map((issue) => {
          const left = Math.max(0, Math.min(100, (issue.sourceStart / Math.max(1, pair.sourceTextLength)) * 100));
          return <button key={issue.id} type="button" className="second-draft-map-issue"
            style={{ left: left + "%" }}
            title={`${issue.category}: ${issue.note || issue.sourceText.slice(0, 90)}`}
            onClick={() => {
              selectAndRevealSourceRange(issue.sourceStart, issue.sourceEnd);
              setIssuePanelOpen(true);
            }} />;
        })}
      </div>
      <span>{processed} decisions · {unresolvedIssues.length} issues</span>
    </div>}

    {sourceMatchesPair && !sourceChanged && <div className="second-draft-actionbar" aria-label="Second Draft actions">
      <div className="second-draft-action-copy">
        {activeBlock ? <>
          <strong>Rewriting</strong>
          <span>{activeBlock.sourceText.length > 120 ? activeBlock.sourceText.slice(0, 117) + "…" : activeBlock.sourceText}</span>
        </> : selection && selectedExistingBlock ? <>
          <strong>{selectedExistingBlock.status === "later" ? "Parked for later" : "Already processed"}</strong>
          <span>{selectedExistingBlock.sourceText.length > 120 ? selectedExistingBlock.sourceText.slice(0, 117) + "…" : selectedExistingBlock.sourceText}</span>
        </> : selection ? <>
          <strong>Selected source</strong>
          <span>{selection.text.length > 120 ? selection.text.slice(0, 117) + "…" : selection.text}</span>
        </> : laterBlocks.length > 0 ? <>
          <strong>Later queue · {laterBlocks.length}</strong>
          <span>{laterBlocks[0].sourceText.length > 120 ? laterBlocks[0].sourceText.slice(0, 117) + "…" : laterBlocks[0].sourceText}</span>
        </> : <>
          <strong>Source Burn</strong>
          <span>Select source text, then decide what happens to it.</span>
        </>}
      </div>

      <div className="second-draft-action-buttons">
        {activeBlock ? <>
          <select className="second-draft-intent-select" aria-label="Rewrite intent"
            value={activeBlock.intent ?? rewriteIntent}
            disabled={busy}
            onChange={(event) => void updateActiveIntent(event.target.value as SecondDraftRewriteIntent)}>
            {REWRITE_INTENTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <button disabled={busy} className="primary" onClick={() => void finishActive("rewritten")}>Done</button>
          <button disabled={busy} onClick={() => void finishActive("cut")}>Cut</button>
          <button disabled={busy} onClick={() => void finishActive("later")}>Later</button>
          <button disabled={busy} onClick={() => void finishActive("keep")}>Keep</button>
          <button disabled={busy} onClick={() => void undoDecision(activeBlock)}>Cancel rewrite</button>
        </> : selection && selectedExistingBlock?.status === "later" ? <>
          <button disabled={busy} className="primary" onClick={() => void resumeLater(selectedExistingBlock)}>Resume</button>
          <button disabled={busy} onClick={() => void resolveLater(selectedExistingBlock, "cut")}>Cut</button>
          <button disabled={busy} onClick={() => void resolveLater(selectedExistingBlock, "keep")}>Keep</button>
          <button disabled={busy} onClick={() => void undoDecision(selectedExistingBlock)}>Undo later</button>
        </> : selection && selectedExistingBlock ? <>
          {selectedExistingBlock.status === "rewritten" &&
            <button disabled={busy} className="primary" onClick={() => openComparison(selectedExistingBlock)}>Compare rewrite</button>}
          {selectedExistingBlock.status !== "sent" &&
            <button disabled={busy} onClick={() => void undoDecision(selectedExistingBlock)}>
              {selectedExistingBlock.status === "rewritten" ? "Undo rewrite" : "Undo decision"}
            </button>}
        </> : selection ? <>
          <select className="second-draft-intent-select" aria-label="Rewrite intent" value={rewriteIntent}
            onChange={(event) => setRewriteIntent(event.target.value as SecondDraftRewriteIntent)}>
            {REWRITE_INTENTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <button disabled={busy} className="primary" onClick={() => void createAndSet("active")}>Rewrite this</button>
          <button disabled={busy} onClick={() => void createAndSet("cut")}>Cut</button>
          <button disabled={busy} onClick={() => void createAndSet("later")}>Later</button>
          <button disabled={busy} onClick={() => void createAndSet("keep")}>Keep</button>
          <div className="second-draft-send-ahead">
            <select value={sendTargetId} onChange={(event) => setSendTargetId(event.target.value)} aria-label="Send source ahead to chapter">
              <option value="">Send ahead…</option>
              {sendOptions.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
            </select>
            <button type="button" disabled={!canSendAhead} data-send-ready={canSendAhead ? "true" : "false"} title="Send selected source to the chosen chapter" onClick={() => void sendAhead()}>Send</button>
          </div>
        </> : laterBlocks.length > 0 ? <>
          <button disabled={busy} className="primary" onClick={() => void resumeLater(laterBlocks[0])}>Resume next</button>
          <button disabled={busy} onClick={() => void resolveLater(laterBlocks[0], "cut")}>Cut</button>
          <button disabled={busy} onClick={() => void resolveLater(laterBlocks[0], "keep")}>Keep</button>
        </> : <>
          <select className="second-draft-intent-select" disabled aria-label="Rewrite intent"><option>General</option></select>
          <button disabled className="primary" title="Select source text first">Rewrite this</button>
          <button disabled title="Select source text first">Cut</button>
          <button disabled title="Select source text first">Later</button>
          <button disabled title="Select source text first">Keep</button>
          <div className="second-draft-send-ahead">
            <select disabled aria-label="Send source ahead to chapter">
              <option>Send ahead…</option>
            </select>
            <button type="button" disabled title="Select source text first">Send</button>
          </div>
        </>}
      </div>

      <button type="button" className="second-draft-flag-issue" disabled={!selection || busy}
        title={selection ? "Flag this source passage for a later review pass" : "Select source text first"}
        onClick={() => {
          setIssuePanelOpen(true);
          setReviewPanelOpen(false);
        }}>Flag issue</button>

      <button type="button" className="second-draft-seal" disabled={busy || unresolved > 0 || processed === 0}
        title={unresolved
          ? `Resolve ${unresolved} active/later source block(s) before sealing`
          : processed === 0
            ? "Process at least one source passage before sealing"
            : `Seal chapter · ${Math.round(progress * 100)}% source reviewed`}
        onClick={() => void sealChapter()}>Seal</button>
    </div>}

    {briefOpen && sourceMatchesPair && <aside className="second-draft-drawer second-draft-brief-drawer" aria-label="Second Draft chapter brief">
      <div className="second-draft-drawer-head">
        <strong>Draft brief</strong>
        <span>Keep the rewrite pointed at one goal</span>
        <button type="button" onClick={() => setBriefOpen(false)}>×</button>
      </div>
      <textarea value={briefDraft} maxLength={4000}
        placeholder="Example: Cut exposition, make the confrontation tenser, keep Mara less certain."
        onChange={(event) => setBriefDraft(event.target.value)} />
      <div className="second-draft-brief-actions">
        <small>{briefDraft.length}/4000</small>
        <button type="button" disabled={busy || briefDraft === draftBrief} onClick={() => void saveDraftBrief()}>Save brief</button>
      </div>
    </aside>}

    {reviewPanelOpen && sourceMatchesPair && <aside className="second-draft-drawer second-draft-review-drawer" aria-label="Second Draft review passes">
      <div className="second-draft-drawer-head">
        <strong>Chapter passes</strong>
        <span>{reviewPassCount}/{REVIEW_PASSES.length} complete</span>
        <button type="button" onClick={() => setReviewPanelOpen(false)}>×</button>
      </div>
      <div className="second-draft-pass-grid">
        {REVIEW_PASSES.map((item) => <button key={item.key} type="button"
          className={reviewPasses[item.key] ? "complete" : ""}
          disabled={busy}
          onClick={() => void toggleReviewPass(item.key)}>
          <span>{reviewPasses[item.key] ? "✓" : "○"}</span>{item.label}
        </button>)}
      </div>
    </aside>}

    {issuePanelOpen && sourceMatchesPair && <aside className="second-draft-drawer second-draft-issues-drawer" aria-label="Second Draft issues">
      <div className="second-draft-drawer-head">
        <strong>Issues</strong>
        <span>{unresolvedIssues.length} open</span>
        <button type="button" onClick={() => setIssuePanelOpen(false)}>×</button>
      </div>
      {selection && <div className="second-draft-issue-compose">
        <div className="second-draft-issue-selection">{selection.text.length > 110 ? selection.text.slice(0, 107) + "…" : selection.text}</div>
        <div className="second-draft-issue-form">
          <select value={issueCategory} onChange={(event) => setIssueCategory(event.target.value as SecondDraftIssueCategory)}>
            {ISSUE_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <input value={issueNote} onChange={(event) => setIssueNote(event.target.value)}
            placeholder="What needs another pass?" maxLength={4000} />
          <button type="button" disabled={busy} onClick={() => void createIssue()}>Add issue</button>
        </div>
      </div>}
      <div className="second-draft-issue-list">
        {unresolvedIssues.length === 0
          ? <p>No open issues in this chapter.</p>
          : unresolvedIssues.map((issue) => <article key={issue.id}>
              <button type="button" className="second-draft-issue-jump"
                onClick={() => selectAndRevealSourceRange(issue.sourceStart, issue.sourceEnd)}>
                <span>{ISSUE_CATEGORIES.find((item) => item.value === issue.category)?.label ?? issue.category}</span>
                <strong>{issue.sourceText.length > 92 ? issue.sourceText.slice(0, 89) + "…" : issue.sourceText}</strong>
                {issue.note && <small>{issue.note}</small>}
              </button>
              <button type="button" disabled={busy} onClick={() => void resolveIssue(issue)}>Resolve</button>
            </article>)}
      </div>
    </aside>}

    {comparison && <div className="second-draft-compare-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) setComparison(null);
    }}>
      <section className="second-draft-compare" role="dialog" aria-modal="true" aria-label="Compare rewrite">
        <div className="second-draft-drawer-head">
          <strong>Compare rewrite</strong>
          <span>{textWordCount(comparison.sourceText)} → {textWordCount(comparison.targetText)} words · {textWordCount(comparison.targetText) - textWordCount(comparison.sourceText) >= 0 ? "+" : ""}{textWordCount(comparison.targetText) - textWordCount(comparison.sourceText)}</span>
          <button type="button" onClick={() => setComparison(null)}>×</button>
        </div>
        <div className="second-draft-compare-meta">
          <span>Intent: {REWRITE_INTENTS.find((item) => item.value === (comparison.block.intent ?? "general"))?.label ?? "General"}</span>
          <span>{comparison.sourceText && comparison.targetText ? Math.round((textWordCount(comparison.targetText) / Math.max(1, textWordCount(comparison.sourceText)) - 1) * 100) : 0}% word delta</span>
        </div>
        <div className="second-draft-compare-grid">
          <article><span>Source</span><p>{comparison.sourceText}</p></article>
          <article><span>Rewrite</span><p>{comparison.targetText || "No target text captured for this rewrite."}</p></article>
        </div>
        <div className="second-draft-word-diff" aria-label="Word-level rewrite diff">
          <strong>Word diff</strong>
          <p>{wordDiff(comparison.sourceText, comparison.targetText).map((piece, index) =>
            <span key={index} className={piece.kind}>{piece.text} </span>)}</p>
        </div>
      </section>
    </div>}

    <div ref={sourcePaperRef} className="writing-split-paper second-draft-source-paper">
      {sourceDoc
        ? <div ref={sourceEditorRef} className="writing-split-editor rich-editor second-draft-source"
            style={{ "--folio-write-font-size": `${16 * props.writeZoom}px` } as React.CSSProperties}
            contentEditable={false} data-placeholder="Choose a source chapter…" onMouseUp={captureSelection} onKeyUp={captureSelection}
            aria-label={`Source draft: ${sourceDoc.title}`} />
        : <div className="writing-split-loading">{sourceId ? "Loading source…" : "Choose a source chapter."}</div>}
    </div>

    {sealReveal && <div className="second-draft-reveal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) setSealReveal(null);
    }}>
      <section className="second-draft-reveal" role="dialog" aria-modal="true" aria-labelledby="second-draft-reveal-title">
        <button className="second-draft-reveal-close" aria-label="Close chapter reveal" onClick={() => setSealReveal(null)}>×</button>
        <span className="second-draft-reveal-kicker">Chapter sealed</span>
        <h2 id="second-draft-reveal-title">Draft 2</h2>
        <div className="second-draft-reveal-words">
          <div><strong>{sealReveal.sourceWords.toLocaleString()}</strong><span>source words</span></div>
          <span>→</span>
          <div><strong>{sealReveal.targetWords.toLocaleString()}</strong><span>new words</span></div>
        </div>
        <div className="second-draft-reveal-grid">
          <div><strong>{sealReveal.rewritten}</strong><span>rewritten</span></div>
          <div><strong>{sealReveal.cut}</strong><span>cut</span></div>
          <div><strong>{sealReveal.kept}</strong><span>kept</span></div>
          <div><strong>{sealReveal.sentAhead}</strong><span>sent ahead</span></div>
        </div>
        <div className="second-draft-reveal-progress"><span style={{ width: `${sealReveal.processedPercent}%` }} /><b>{sealReveal.processedPercent}% source processed</b></div>
      </section>
    </div>}
  </section>;
}

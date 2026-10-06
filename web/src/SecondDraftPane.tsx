import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { markdownToEditorHtml } from "./rich-text";
import {
  caretTextOffset,
  interpolatePairedScroll,
  rangeForTextOffsets,
  secondDraftProgress,
  selectedTextOffsets,
  sourceFingerprint,
} from "./second-draft";
import type {
  SecondDraftBlock,
  SecondDraftBlockStatus,
  SecondDraftCarryover,
  SecondDraftSealReveal,
  WriteStudioState,
} from "./write-studio";
import type { ProjectSummary, SectionDocument } from "./types";

type SourceSelection = { start: number; end: number; text: string };
type ManualScrollAnchor = { targetRatio: number; sourceRatio: number };
type SecondDraftViewState = {
  targetRatio: number;
  sourceRatio: number;
  memoryMode: boolean;
  syncScroll: boolean;
  manualAnchors: ManualScrollAnchor[];
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

function readSecondDraftViewState(key: string): SecondDraftViewState | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SecondDraftViewState>;
    return {
      targetRatio: clampRatio(Number(value.targetRatio ?? 0)),
      sourceRatio: clampRatio(Number(value.sourceRatio ?? 0)),
      memoryMode: Boolean(value.memoryMode),
      syncScroll: value.syncScroll !== false,
      manualAnchors: Array.isArray(value.manualAnchors)
        ? value.manualAnchors
            .map((item) => ({ targetRatio: clampRatio(Number(item?.targetRatio)), sourceRatio: clampRatio(Number(item?.sourceRatio)) }))
            .filter((item) => Number.isFinite(item.targetRatio) && Number.isFinite(item.sourceRatio))
            .slice(-8)
        : [],
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
  const [memoryMode, setMemoryMode] = useState(false);
  const [memoryPeek, setMemoryPeek] = useState(false);
  const [syncScroll, setSyncScroll] = useState(true);
  const [manualAnchors, setManualAnchors] = useState<ManualScrollAnchor[]>([]);
  const [sendTargetId, setSendTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [sealReveal, setSealReveal] = useState<SecondDraftSealReveal | null>(null);
  const [sourceChanged, setSourceChanged] = useState(false);
  const sourceMatchesPair = Boolean(pair && pair.sourceSectionId === sourceDoc?.id);
  const laterBlocks = useMemo(
    () => relevantBlocks.filter((block) => block.status === "later").sort((a, b) => a.sourceStart - b.sourceStart),
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
  const scrollSyncRef = useRef(false);
  const restoringScrollRef = useRef(false);
  const viewKey = useMemo(
    () => `folio.second-draft.view.v2:${props.project.projectId}:${props.targetSectionId}:${sourceId || "none"}`,
    [props.project.projectId, props.targetSectionId, sourceId],
  );

  function persistViewState(overrides: Partial<SecondDraftViewState> = {}) {
    const sourceEditor = sourceEditorRef.current;
    const targetEditor = document.querySelector<HTMLElement>(".manuscript-editor");
    const previous = readSecondDraftViewState(viewKey);
    const next: SecondDraftViewState = {
      targetRatio: targetEditor ? elementScrollRatio(targetEditor) : previous?.targetRatio ?? 0,
      sourceRatio: sourceEditor ? elementScrollRatio(sourceEditor) : previous?.sourceRatio ?? 0,
      memoryMode,
      syncScroll,
      manualAnchors,
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
    setMemoryMode(saved?.memoryMode ?? false);
    setSyncScroll(saved?.syncScroll ?? true);
    setManualAnchors(saved?.manualAnchors ?? []);
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
    const text = editor.textContent ?? "";
    setSourceChanged(Boolean(pair && pair.sourceSectionId === sourceDoc.id && pair.sourceFingerprint !== sourceFingerprint(text)));
  }, [sourceDoc?.id, sourceDoc?.markdown, props.ornament, props.project.projectId, pair?.sourceFingerprint, pair?.sourceSectionId]);

  useEffect(() => {
    if (!sourceDoc) return;
    const sourceEditor = sourceEditorRef.current;
    const targetEditor = document.querySelector<HTMLElement>(".manuscript-editor");
    const saved = readSecondDraftViewState(viewKey);
    if (!sourceEditor || !targetEditor || !saved) return;
    restoringScrollRef.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      targetEditor.scrollTop = scrollTopForRatio(targetEditor, saved.targetRatio);
      sourceEditor.scrollTop = scrollTopForRatio(sourceEditor, saved.sourceRatio);
      requestAnimationFrame(() => { restoringScrollRef.current = false; });
    }));
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

    const pointForOffset = (editor: HTMLElement, offset: number): number | null => {
      const length = editor.textContent?.length ?? 0;
      if (length <= 0) return 0;
      const start = Math.max(0, Math.min(length - 1, offset));
      const range = rangeForTextOffsets(editor, start, start + 1);
      if (!range) return null;
      const rect = range.getBoundingClientRect();
      const host = editor.getBoundingClientRect();
      return Math.max(0, rect.top - host.top + editor.scrollTop);
    };

    const buildAnchors = () => {
      const targetMax = Math.max(0, targetEditor.scrollHeight - targetEditor.clientHeight);
      const sourceMax = Math.max(0, sourceEditor.scrollHeight - sourceEditor.clientHeight);
      const anchors: Array<{ target: number; source: number }> = [{ target: 0, source: 0 }];

      for (const anchor of manualAnchors) {
        anchors.push({ target: anchor.targetRatio * targetMax, source: anchor.sourceRatio * sourceMax });
      }

      for (const block of relevantBlocks) {
        if (!["active", "rewritten", "keep"].includes(block.status) || block.targetStart === undefined) continue;
        const targetStart = pointForOffset(targetEditor, block.targetStart);
        const sourceStart = pointForOffset(sourceEditor, block.sourceStart);
        if (targetStart !== null && sourceStart !== null) anchors.push({ target: targetStart, source: sourceStart });

        if ((block.status === "rewritten" || block.status === "keep") && block.targetEnd !== undefined) {
          const targetEnd = pointForOffset(targetEditor, block.targetEnd);
          const sourceEnd = pointForOffset(sourceEditor, block.sourceEnd);
          if (targetEnd !== null && sourceEnd !== null) anchors.push({ target: targetEnd, source: sourceEnd });
        }
      }

      anchors.push({ target: targetMax, source: sourceMax });
      return anchors;
    };

    const remember = () => persistViewState();
    const syncFromTarget = () => {
      if (scrollSyncRef.current || restoringScrollRef.current) return;
      if (!syncScroll) { remember(); return; }
      scrollSyncRef.current = true;
      const next = interpolatePairedScroll(targetEditor.scrollTop, buildAnchors());
      sourceEditor.scrollTop = Math.max(0, Math.min(sourceEditor.scrollHeight - sourceEditor.clientHeight, next));
      requestAnimationFrame(() => {
        scrollSyncRef.current = false;
        remember();
      });
    };
    const syncFromSource = () => {
      if (scrollSyncRef.current || restoringScrollRef.current) return;
      if (!syncScroll) { remember(); return; }
      scrollSyncRef.current = true;
      const inverse = buildAnchors().map((item) => ({ target: item.source, source: item.target }));
      const next = interpolatePairedScroll(sourceEditor.scrollTop, inverse);
      targetEditor.scrollTop = Math.max(0, Math.min(targetEditor.scrollHeight - targetEditor.clientHeight, next));
      requestAnimationFrame(() => {
        scrollSyncRef.current = false;
        remember();
      });
    };

    targetEditor.addEventListener("scroll", syncFromTarget, { passive: true });
    sourceEditor.addEventListener("scroll", syncFromSource, { passive: true });

    if (syncScroll && !restoringScrollRef.current) requestAnimationFrame(syncFromTarget);

    return () => {
      persistViewState();
      targetEditor.removeEventListener("scroll", syncFromTarget);
      sourceEditor.removeEventListener("scroll", syncFromSource);
    };
  }, [pair?.sourceSectionId, relevantBlocks, sourceMatchesPair, sourceChanged, sourceDoc?.id, syncScroll, manualAnchors, memoryMode, viewKey]);

  function linkCurrentScrollPosition() {
    const sourceEditor = sourceEditorRef.current;
    const targetEditor = document.querySelector<HTMLElement>(".manuscript-editor");
    if (!sourceEditor || !targetEditor) return;
    const anchor = { targetRatio: elementScrollRatio(targetEditor), sourceRatio: elementScrollRatio(sourceEditor) };
    const next = [...manualAnchors.filter((item) => Math.abs(item.targetRatio - anchor.targetRatio) > 0.012), anchor]
      .sort((a, b) => a.targetRatio - b.targetRatio)
      .slice(-8);
    setManualAnchors(next);
    setSyncScroll(true);
    persistViewState({ manualAnchors: next, syncScroll: true });
  }

  function clearManualScrollAnchors() {
    setManualAnchors([]);
    persistViewState({ manualAnchors: [] });
  }

  function captureSelection() {
    const editor = sourceEditorRef.current;
    if (editor) setSelection(selectedTextOffsets(editor));
  }

  function currentTargetCaret(): number | undefined {
    const editor = document.querySelector<HTMLElement>(".manuscript-editor");
    if (!editor) return undefined;
    const offset = caretTextOffset(editor);
    return offset === null ? (editor.textContent?.length ?? 0) : offset;
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
      setSyncScroll(true);
      persistViewState({ manualAnchors: [], syncScroll: true });
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function createAndSet(status: Exclude<SecondDraftBlockStatus, "sent">) {
    if (!selection || !pair || !sourceMatchesPair || sourceChanged) return;
    setBusy(true);
    try {
      const state = await api.createSecondDraftBlock(props.project.projectId, {
        targetSectionId: props.targetSectionId,
        sourceStart: selection.start,
        sourceEnd: selection.end,
        sourceText: selection.text,
        targetStart: status === "active" ? currentTargetCaret() : undefined,
        status,
      });
      props.onState(state);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
      if (status === "active") {
        props.onRevealTarget();
        requestAnimationFrame(() => document.querySelector<HTMLElement>(".manuscript-editor")?.focus());
      }
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function finishActive(status: Exclude<SecondDraftBlockStatus, "active" | "sent">) {
    if (!activeBlock) return;
    setBusy(true);
    try {
      props.onState(await api.updateSecondDraftBlock(props.project.projectId, activeBlock.id, {
        status,
        targetEnd: status === "rewritten" || status === "keep" ? currentTargetCaret() : undefined,
      }));
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function resumeLater(block: SecondDraftBlock) {
    if (block.status !== "later") return;
    setBusy(true);
    try {
      props.onState(await api.updateSecondDraftBlock(props.project.projectId, block.id, {
        status: "active",
        targetStart: currentTargetCaret(),
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
        document.querySelector<HTMLElement>(".manuscript-editor")?.focus();
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

  async function sendAhead() {
    if (!selection || !pair || !sourceMatchesPair || !sendTargetId || sourceChanged) return;
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
      {sourceMatchesPair && !sourceChanged && <div className="second-draft-sync-controls" role="group" aria-label="Paired scroll controls">
        <span className="second-draft-sync-status">{syncScroll ? `Synced${manualAnchors.length ? ` · ${manualAnchors.length} link${manualAnchors.length === 1 ? "" : "s"}` : ""}` : "Free scroll"}</span>
        <button type="button" className={syncScroll ? "active" : ""} aria-pressed={syncScroll}
          title={syncScroll ? "Turn off paired scrolling to position both drafts independently" : "Turn paired scrolling back on"}
          onClick={() => setSyncScroll((value) => {
            const next = !value;
            persistViewState({ syncScroll: next });
            return next;
          })}>Sync</button>
        <button type="button" disabled={syncScroll} title="With Sync off, position both drafts where they correspond, then link those positions"
          onClick={linkCurrentScrollPosition}>Link here</button>
        {manualAnchors.length > 0 && <button type="button" title="Remove manual scroll links and use automatic anchors only"
          onClick={clearManualScrollAnchors}>Reset links</button>}
      </div>}
    </div>

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
          <button disabled={busy} className="primary" onClick={() => void finishActive("rewritten")}>Done</button>
          <button disabled={busy} onClick={() => void finishActive("cut")}>Cut</button>
          <button disabled={busy} onClick={() => void finishActive("later")}>Later</button>
          <button disabled={busy} onClick={() => void finishActive("keep")}>Keep</button>
        </> : selection && selectedExistingBlock?.status === "later" ? <>
          <button disabled={busy} className="primary" onClick={() => void resumeLater(selectedExistingBlock)}>Resume</button>
          <button disabled={busy} onClick={() => void resolveLater(selectedExistingBlock, "cut")}>Cut</button>
          <button disabled={busy} onClick={() => void resolveLater(selectedExistingBlock, "keep")}>Keep</button>
        </> : selection && selectedExistingBlock ? null : selection ? <>
          <button disabled={busy} className="primary" onClick={() => void createAndSet("active")}>Rewrite this</button>
          <button disabled={busy} onClick={() => void createAndSet("cut")}>Cut</button>
          <button disabled={busy} onClick={() => void createAndSet("later")}>Later</button>
          <button disabled={busy} onClick={() => void createAndSet("keep")}>Keep</button>
          <div className="second-draft-send-ahead">
            <select value={sendTargetId} onChange={(event) => setSendTargetId(event.target.value)} aria-label="Send source ahead to chapter">
              <option value="">Send ahead…</option>
              {sendOptions.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
            </select>
            <button disabled={busy || !sendTargetId} title="Send selected source to the chosen chapter" onClick={() => void sendAhead()}>Send</button>
          </div>
        </> : laterBlocks.length > 0 ? <>
          <button disabled={busy} className="primary" onClick={() => void resumeLater(laterBlocks[0])}>Resume next</button>
          <button disabled={busy} onClick={() => void resolveLater(laterBlocks[0], "cut")}>Cut</button>
          <button disabled={busy} onClick={() => void resolveLater(laterBlocks[0], "keep")}>Keep</button>
        </> : null}
      </div>

      <button type="button" className="second-draft-seal" disabled={busy || unresolved > 0 || processed === 0}
        title={unresolved
          ? `Resolve ${unresolved} active/later source block(s) before sealing`
          : processed === 0
            ? "Process at least one source passage before sealing"
            : `Seal chapter · ${Math.round(progress * 100)}% source reviewed`}
        onClick={() => void sealChapter()}>Seal</button>
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

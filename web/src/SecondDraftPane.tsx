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
  const [sendTargetId, setSendTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [sealReveal, setSealReveal] = useState<SecondDraftSealReveal | null>(null);
  const [sourceChanged, setSourceChanged] = useState(false);
  const sourceEditorRef = useRef<HTMLDivElement>(null);
  const sourcePaperRef = useRef<HTMLDivElement>(null);
  const scrollSyncRef = useRef(false);

  useEffect(() => {
    setSourceId(pair?.sourceSectionId ?? candidateSections[0]?.id ?? "");
    setSelection(null);
    setSealReveal(null);
  }, [props.targetSectionId, pair?.sourceSectionId, props.project.projectId]);

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
    const text = editor.innerText;
    setSourceChanged(Boolean(pair && pair.sourceSectionId === sourceDoc.id && pair.sourceFingerprint !== sourceFingerprint(text)));
  }, [sourceDoc?.id, sourceDoc?.markdown, props.ornament, props.project.projectId, pair?.sourceFingerprint, pair?.sourceSectionId]);

  useEffect(() => {
    const registry = (CSS as unknown as {
      highlights?: { set: (name: string, value: unknown) => unknown; delete: (name: string) => unknown };
    }).highlights;
    const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!registry || !HighlightCtor || !sourceEditorRef.current) return;
    for (const name of BURN_HIGHLIGHTS) registry.delete(name);
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
  }, [relevantBlocks, sourceDoc?.id, sourceDoc?.markdown]);

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
    if (!pair || sourceChanged) return;
    const sourceEditor = sourceEditorRef.current;
    const targetEditor = document.querySelector<HTMLElement>(".manuscript-editor");
    if (!sourceEditor || !targetEditor) return;

    const buildAnchors = () => {
      const targetMax = Math.max(0, targetEditor.scrollHeight - targetEditor.clientHeight);
      const sourceMax = Math.max(0, sourceEditor.scrollHeight - sourceEditor.clientHeight);
      const anchors: Array<{ target: number; source: number }> = [{ target: 0, source: 0 }];
      for (const block of relevantBlocks) {
        if ((block.status !== "rewritten" && block.status !== "keep") || block.targetStart === undefined) continue;
        const targetRange = rangeForTextOffsets(targetEditor, block.targetStart, Math.min(targetEditor.innerText.length, block.targetStart + 1));
        const sourceRange = rangeForTextOffsets(sourceEditor, block.sourceStart, Math.min(sourceEditor.innerText.length, block.sourceStart + 1));
        if (!targetRange || !sourceRange) continue;
        const targetRect = targetRange.getBoundingClientRect();
        const sourceRect = sourceRange.getBoundingClientRect();
        const targetRectHost = targetEditor.getBoundingClientRect();
        const sourceRectHost = sourceEditor.getBoundingClientRect();
        anchors.push({
          target: Math.max(0, targetRect.top - targetRectHost.top + targetEditor.scrollTop),
          source: Math.max(0, sourceRect.top - sourceRectHost.top + sourceEditor.scrollTop),
        });
      }
      anchors.push({ target: targetMax, source: sourceMax });
      return anchors;
    };

    const syncFromTarget = () => {
      if (scrollSyncRef.current) return;
      scrollSyncRef.current = true;
      const next = interpolatePairedScroll(targetEditor.scrollTop, buildAnchors());
      sourceEditor.scrollTop = Math.max(0, Math.min(sourceEditor.scrollHeight - sourceEditor.clientHeight, next));
      requestAnimationFrame(() => { scrollSyncRef.current = false; });
    };
    const syncFromSource = () => {
      if (scrollSyncRef.current) return;
      scrollSyncRef.current = true;
      const inverse = buildAnchors().map((item) => ({ target: item.source, source: item.target }));
      const next = interpolatePairedScroll(sourceEditor.scrollTop, inverse);
      targetEditor.scrollTop = Math.max(0, Math.min(targetEditor.scrollHeight - targetEditor.clientHeight, next));
      requestAnimationFrame(() => { scrollSyncRef.current = false; });
    };
    targetEditor.addEventListener("scroll", syncFromTarget, { passive: true });
    sourceEditor.addEventListener("scroll", syncFromSource, { passive: true });
    return () => {
      targetEditor.removeEventListener("scroll", syncFromTarget);
      sourceEditor.removeEventListener("scroll", syncFromSource);
    };
  }, [pair?.sourceSectionId, relevantBlocks, sourceChanged, sourceDoc?.id]);

  function captureSelection() {
    const editor = sourceEditorRef.current;
    if (editor) setSelection(selectedTextOffsets(editor));
  }

  function currentTargetCaret(): number | undefined {
    const editor = document.querySelector<HTMLElement>(".manuscript-editor");
    if (!editor) return undefined;
    const offset = caretTextOffset(editor);
    return offset === null ? editor.innerText.length : offset;
  }

  async function pairSource() {
    const editor = sourceEditorRef.current;
    if (!editor || !sourceDoc) return;
    setBusy(true);
    try {
      const text = editor.innerText;
      props.onState(await api.setSecondDraftPair(
        props.project.projectId, props.targetSectionId, sourceDoc.id, text.length, sourceFingerprint(text),
      ));
      setSourceChanged(false);
      setSelection(null);
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function createAndSet(status: SecondDraftBlockStatus) {
    if (!selection || !pair || sourceChanged) return;
    setBusy(true);
    try {
      let state = await api.createSecondDraftBlock(props.project.projectId, {
        targetSectionId: props.targetSectionId,
        sourceStart: selection.start,
        sourceEnd: selection.end,
        sourceText: selection.text,
        targetStart: status === "active" ? currentTargetCaret() : undefined,
      });
      const created = [...state.secondDraft.blocks]
        .filter((block) => block.targetSectionId === props.targetSectionId && block.status === "active")
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
      if (status !== "active" && created) state = await api.updateSecondDraftBlock(props.project.projectId, created.id, { status });
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

  async function sendAhead() {
    if (!selection || !pair || !sendTargetId || sourceChanged) return;
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
  const sourceMatchesPair = Boolean(pair && pair.sourceSectionId === sourceDoc?.id);
  const sendOptions = props.project.sections.filter(
    (section) => section.kind === "chapter" && section.id !== props.targetSectionId && section.id !== pair?.sourceSectionId,
  );

  return <section className={`writing-split-pane second-draft-pane ${memoryMode ? "memory-mode" : ""} ${memoryPeek ? "memory-peek" : ""}`} aria-label="Second Draft source">
    <div className="writing-split-top-strip" aria-hidden="true" />
    <header className="writing-split-header second-draft-header">
      <div className="writing-split-title">
        <strong>Second Draft</strong>
        <select aria-label="Source draft chapter" value={sourceId} onChange={(event) => setSourceId(event.target.value)} disabled={busy}>
          {candidateSections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
        </select>
        {(!pair || pair.sourceSectionId !== sourceId || sourceChanged) &&
          <button type="button" className="second-draft-pair" disabled={busy || !sourceDoc} onClick={() => void pairSource()}>
            {pair && sourceChanged ? "Re-pair source" : "Use as source"}
          </button>}
      </div>
      <div className="second-draft-head-actions">
        {pair && <span className="second-draft-progress">{Math.round(progress * 100)}% source</span>}
        <button type="button" className={memoryMode ? "active" : ""} aria-pressed={memoryMode} title="Hide source while writing; hold Alt to peek" onClick={() => setMemoryMode((value) => !value)}>Memory</button>
        <button type="button" title="Close Second Draft" aria-label="Close Second Draft" onClick={props.onClose}>×</button>
      </div>
    </header>

    {carryovers.length > 0 && <div className="second-draft-arrivals">
      <strong>{carryovers.length} carried here</strong>
      <div>{carryovers.map((item) => <article key={item.id}>
        <p>{item.sourceText}</p>
        <button disabled={busy} onClick={() => void updateCarryover(item, "used")}>Used</button>
        <button disabled={busy} onClick={() => void updateCarryover(item, "dismissed")}>Dismiss</button>
      </article>)}</div>
    </div>}

    {sourceChanged && sourceMatchesPair && <div className="second-draft-warning">
      Source changed since it was paired. Re-pair it before continuing so Source Burn and scroll anchors stay exact.
    </div>}

    <div className="writing-split-toolbar second-draft-source-toolbar" aria-label="Second Draft source controls">
      <span>Source draft · read only</span>
      {memoryMode && <span className="memory-hint">Hold Alt to peek</span>}
    </div>

    <div ref={sourcePaperRef} className="writing-split-paper second-draft-source-paper">
      {sourceDoc
        ? <div ref={sourceEditorRef} className="writing-split-editor rich-editor second-draft-source"
            style={{ "--folio-write-font-size": `${16 * props.writeZoom}px` } as React.CSSProperties}
            contentEditable={false} data-placeholder="Choose a source chapter…" onMouseUp={captureSelection} onKeyUp={captureSelection}
            aria-label={`Source draft: ${sourceDoc.title}`} />
        : <div className="writing-split-loading">{sourceId ? "Loading source…" : "Choose a source chapter."}</div>}
    </div>

    {pair && !sourceChanged && <aside className="second-draft-rail" aria-label="Second Draft rail">
      {activeBlock ? <>
        <span className="rail-label">Rewriting</span>
        <button disabled={busy} className="rail-done" onClick={() => void finishActive("rewritten")}>✓ Done</button>
        <button disabled={busy} onClick={() => void finishActive("cut")}>Cut</button>
        <button disabled={busy} onClick={() => void finishActive("later")}>Later</button>
        <button disabled={busy} onClick={() => void finishActive("keep")}>Keep</button>
      </> : selection ? <>
        <span className="rail-label">{selection.text.length > 80 ? selection.text.slice(0, 77) + "…" : selection.text}</span>
        <button disabled={busy} className="rail-rewrite" onClick={() => void createAndSet("active")}>Rewrite this</button>
        <button disabled={busy} onClick={() => void createAndSet("cut")}>Cut</button>
        <button disabled={busy} onClick={() => void createAndSet("later")}>Later</button>
        <button disabled={busy} onClick={() => void createAndSet("keep")}>Keep</button>
        <div className="rail-send-ahead">
          <select value={sendTargetId} onChange={(event) => setSendTargetId(event.target.value)} aria-label="Send source ahead to chapter">
            <option value="">Send ahead…</option>
            {sendOptions.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
          </select>
          <button disabled={busy || !sendTargetId} onClick={() => void sendAhead()}>→</button>
        </div>
      </> : <span className="rail-empty">Select source text</span>}
      <div className="rail-spacer" />
      <button type="button" className="rail-seal" disabled={busy || unresolved > 0}
        title={unresolved ? `Resolve ${unresolved} active/later source block(s) before sealing` : "Seal this chapter"}
        onClick={() => void sealChapter()}>Seal chapter</button>
    </aside>}

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

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { ProjectSummary, SectionDocument } from "./types";
import {
  buildSearchRegex,
  countMatches,
  diffLines,
  markdownToReadableSnapshotText,
  nearbyRepetitions,
  repeatedWords,
  replaceMatches,
  replacementForMatch,
  todayKey,
  type RevisionPayload,
  type SearchOptions,
  type SelectionCapture,
  type SessionStats,
  type WriteStudioState,
  type WriteStudioTab,
  type WritingTargets,
} from "./write-studio";

interface Props {
  open: boolean;
  activeTab: WriteStudioTab;
  setActiveTab: (tab: WriteStudioTab) => void;
  project: ProjectSummary;
  document: SectionDocument | null;
  selectedId: string | null;
  draft: string;
  currentWords: number;
  totalWords: number;
  liveSectionWordCounts: Record<string, number>;
  externalEditRevision: number;
  language: string;
  session: SessionStats;
  state: WriteStudioState | null;
  onState: (state: WriteStudioState) => void;
  onClose: () => void;
  onCaptureSelection: () => SelectionCapture | null;
  onGetCurrentMarkdown: () => Promise<string>;
  onSaveCurrent: () => Promise<boolean>;
  onRevealText: (text: string, prefix?: string, suffix?: string) => void;
  onNavigateText: (sectionId: string, text: string, prefix?: string, suffix?: string) => Promise<void>;
  onReplaceCurrent: (markdown: string) => void;
  onRestoreMarkdown: (markdown: string) => Promise<void>;
  onProjectUpdate: (summary: ProjectSummary) => void;
  onBookRestored: (summary: ProjectSummary) => void;
  onError: (message: string) => void;
}

type SearchScope = "chapter" | "book";
type SearchHit = {
  sectionId: string;
  title: string;
  text: string;
  snippet: string;
  replacementSnippet: string;
  prefix: string;
  suffix: string;
};

function clampPercent(value: number, target: number | null | undefined): number {
  if (!target || target <= 0) return 0;
  return Math.max(0, Math.min(100, (value / target) * 100));
}

function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? hours + "h " + String(rest).padStart(2, "0") + "m" : rest + "m";
}

function shortDate(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function TargetProgress({ label, value, target }: { label: string; value: number; target: number | null | undefined }) {
  return <div className="write-target-progress">
    <div className="write-target-progress-copy"><span>{label}</span><strong>{value.toLocaleString()} {target ? "/ " + target.toLocaleString() : ""}</strong></div>
    <div className="write-progress-track"><span style={{ width: clampPercent(value, target) + "%" }}/></div>
  </div>;
}

function NumberTarget({ label, value, onChange, placeholder }: { label: string; value: number | null | undefined; onChange: (value: number | null) => void; placeholder?: string }) {
  return <label className="write-target-input"><span>{label}</span><input type="number" min="0" step="100" value={value ?? ""} placeholder={placeholder} onChange={(event) => onChange(event.target.value === "" ? null : Math.max(0, Number(event.target.value) || 0))}/></label>;
}

export default function WriteStudioDrawer(props: Props) {
  const [targetDraft, setTargetDraft] = useState<WritingTargets>({ book: null, daily: null, session: null, chapters: {} });
  const [targetsDirty, setTargetsDirty] = useState(false);
  const [researchTitle, setResearchTitle] = useState("");
  const [researchBody, setResearchBody] = useState("");
  const [noteQuery, setNoteQuery] = useState("");
  const [editingResearch, setEditingResearch] = useState<string | null>(null);
  const [editResearchTitle, setEditResearchTitle] = useState("");
  const [editResearchBody, setEditResearchBody] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [editCommentBody, setEditCommentBody] = useState("");
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [snapshotScope, setSnapshotScope] = useState<"chapter" | "book">("chapter");
  const [compareRevision, setCompareRevision] = useState<RevisionPayload | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const revisionLoadTokenRef = useRef(0);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [searchOptions, setSearchOptions] = useState<SearchOptions>({ caseSensitive: false, wholeWord: false, regex: false });
  const [scope, setScope] = useState<SearchScope>("chapter");
  const [bookDocs, setBookDocs] = useState<SectionDocument[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [analysisWindow, setAnalysisWindow] = useState(80);
  const [analysisScope, setAnalysisScope] = useState<SearchScope>("chapter");
  const [imageBusy, setImageBusy] = useState(false);
  const [exactCounts, setExactCounts] = useState<{ total: number; sections: Record<string, number> } | null>(null);

  useEffect(() => {
    if (!props.state) return;
    const serverSignature = JSON.stringify(props.state.targets);
    const draftSignature = JSON.stringify(targetDraft);
    if (targetsDirty) {
      if (serverSignature === draftSignature) setTargetsDirty(false);
      return;
    }
    if (serverSignature !== draftSignature) {
      setTargetDraft({
        book: props.state.targets.book,
        daily: props.state.targets.daily,
        session: props.state.targets.session,
        chapters: { ...props.state.targets.chapters },
      });
    }
  }, [props.state?.targets, targetDraft, targetsDirty]);

  useEffect(() => {
    setTargetsDirty(false);
  }, [props.project.projectId]);

  useEffect(() => {
    revisionLoadTokenRef.current++;
    setCompareRevision(null);
  }, [props.selectedId, props.project.projectId]);

  const projectSectionIdentity = useMemo(
    () => props.project.sections.map((section) => section.id).join("\u0000"),
    [props.project.sections],
  );

  useEffect(() => {
    setBookDocs(null);
    setExactCounts(null);
  }, [props.project.projectId, projectSectionIdentity]);

  useEffect(() => {
    setBookDocs(null);
  }, [props.externalEditRevision]);

  useEffect(() => {
    if (!props.selectedId || props.document?.id !== props.selectedId) return;
    setBookDocs((current) => {
      if (!current) return current;
      const index = current.findIndex((doc) => doc.id === props.selectedId);
      if (index < 0 || current[index].markdown === props.draft) return current;
      const next = current.slice();
      next[index] = { ...current[index], markdown: props.draft };
      return next;
    });
  }, [props.draft, props.selectedId, props.document?.id]);

  useEffect(() => {
    if (!props.open || props.activeTab !== "session") return;
    let cancelled = false;
    api.writingWordCounts(props.project.projectId)
      .then((counts) => { if (!cancelled) setExactCounts(counts); })
      .catch((error) => { if (!cancelled) props.onError(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, [props.open, props.activeTab, props.project.projectId, projectSectionIdentity]);

  const sessionNet = props.session.gross - props.session.deleted;
  const today = todayKey();
  const todayProgress = props.state?.dailyProgress[today] ?? 0;
  const chapterTarget = props.selectedId ? targetDraft.chapters[props.selectedId] ?? null : null;
  const analysisSeparator = useMemo(() => Array.from({ length: 200 }, (_, index) => String(1000000 + index)).join(" "), []);
  const analysisSource = analysisScope === "book"
    ? (bookDocs ? bookDocs.map((doc) => doc.id === props.selectedId ? props.draft : doc.markdown).join("\n\n" + analysisSeparator + "\n\n") : "")
    : props.draft;
  const exactBookWords = exactCounts
    ? exactCounts.total + Object.entries(props.liveSectionWordCounts).reduce((delta, [sectionId, liveCount]) => {
        const kind = props.project.sections.find((section) => section.id === sectionId)?.kind;
        if (kind !== "chapter" && kind !== "backmatter") return delta;
        const savedCount = exactCounts.sections[sectionId];
        return savedCount === undefined ? delta : delta + liveCount - savedCount;
      }, 0)
    : props.totalWords;
  const repeated = useMemo(() => repeatedWords(analysisSource, props.language), [analysisSource, props.language]);
  const nearby = useMemo(() => nearbyRepetitions(analysisSource, props.language, analysisWindow), [analysisSource, props.language, analysisWindow]);
  const revisions = useMemo(() => (props.state?.revisions ?? []).filter((item) => item.scope === "book" || item.sectionId === props.selectedId), [props.state?.revisions, props.selectedId]);
  const comments = useMemo(() => (props.state?.comments ?? []).filter((item) => item.sectionId === props.selectedId).sort((a, b) => Number(a.resolved) - Number(b.resolved) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), [props.state?.comments, props.selectedId]);
  const notes = useMemo(() => {
    const query = noteQuery.trim().toLocaleLowerCase();
    return [...(props.state?.research ?? [])]
      .filter((note) => !query || note.title.toLocaleLowerCase().includes(query) || note.body.toLocaleLowerCase().includes(query))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }, [props.state?.research, noteQuery]);

  let currentMatchCount = 0;
  let searchError = "";
  try {
    currentMatchCount = query ? countMatches(props.draft, query, searchOptions) : 0;
  } catch (error) {
    searchError = error instanceof Error ? error.message : String(error);
  }

  const tabs: Array<{ key: WriteStudioTab; label: string }> = [
    { key: "session", label: "Session" },
    { key: "research", label: "Notes" },
    { key: "comments", label: "Comments" },
    { key: "history", label: "History" },
    { key: "find", label: "Find" },
    { key: "analysis", label: "Analysis" },
  ];

  async function saveTargets() {
    try {
      const state = await api.saveWritingTargets(props.project.projectId, targetDraft);
      props.onState(state);
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
  }

  async function addResearch() {
    if (!researchTitle.trim() && !researchBody.trim()) return;
    try {
      const state = await api.addResearchNote(props.project.projectId, researchTitle, researchBody);
      props.onState(state);
      setResearchTitle("");
      setResearchBody("");
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
  }

  async function saveResearch(noteId: string) {
    try {
      const state = await api.updateResearchNote(props.project.projectId, noteId, { title: editResearchTitle, body: editResearchBody });
      props.onState(state);
      setEditingResearch(null);
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
  }

  async function addResearchImage(file: File) {
    setImageBusy(true);
    try {
      const state = await api.addResearchImage(props.project.projectId, file);
      props.onState(state);
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setImageBusy(false); }
  }

  async function addComment() {
    const selection = props.onCaptureSelection();
    if (!selection) {
      props.onError("Select manuscript text before adding a comment.");
      return;
    }
    try {
      const state = await api.addWritingComment(props.project.projectId, props.selectedId ?? "", selection.quote, commentBody, selection.prefix, selection.suffix);
      props.onState(state);
      setCommentBody("");
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
  }

  async function createSnapshot() {
    setHistoryBusy(true);
    try {
      let state: WriteStudioState;
      if (snapshotScope === "book") {
        const saved = await props.onSaveCurrent();
        if (!saved) throw new Error("Current chapter could not be saved before creating the book snapshot.");
        state = await api.createBookSnapshot(props.project.projectId, snapshotLabel.trim() || undefined);
      } else {
        if (!props.selectedId || !props.document?.editable) return;
        const markdown = await props.onGetCurrentMarkdown();
        state = await api.createSnapshot(props.project.projectId, props.selectedId, markdown, snapshotLabel.trim() || undefined);
      }
      props.onState(state);
      setSnapshotLabel("");
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setHistoryBusy(false); }
  }

  async function loadRevision(id: string) {
    const token = ++revisionLoadTokenRef.current;
    setHistoryBusy(true);
    try {
      const revision = await api.revision(props.project.projectId, id);
      if (revisionLoadTokenRef.current === token) setCompareRevision(revision);
    } catch (error) {
      if (revisionLoadTokenRef.current === token) props.onError(error instanceof Error ? error.message : String(error));
    } finally {
      if (revisionLoadTokenRef.current === token) setHistoryBusy(false);
    }
  }

  async function restoreRevision() {
    if (!compareRevision) return;
    if (compareRevision.revision.scope === "book") {
      if (!window.confirm("Restore this whole-book snapshot? Folio will create a safety snapshot of the current book first.")) return;
      setHistoryBusy(true);
      try {
        const saved = await props.onSaveCurrent();
        if (!saved) throw new Error("Current chapter could not be saved before restoring the book.");
        const safety = await api.createBookSnapshot(props.project.projectId, "Before book restore");
        props.onState(safety);
        const result = await api.restoreBookSnapshot(props.project.projectId, compareRevision.revision.id);
        const summary = await api.reload(props.project.projectId);
        props.onBookRestored(summary);
        props.onState(await api.writeStudio(props.project.projectId));
        setBookDocs(null);
        setExactCounts(null);
        setCompareRevision(null);
        if (result.skipped.length) props.onError("Book restored, but " + result.skipped.length + " section(s) could not be matched.");
      } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
      finally { setHistoryBusy(false); }
      return;
    }

    const revisionMarkdown = compareRevision.markdown;
    if (!props.selectedId || typeof revisionMarkdown !== "string") return;
    if (!window.confirm("Restore this revision? Folio will create a snapshot of the current chapter first.")) return;
    setHistoryBusy(true);
    try {
      const current = await props.onGetCurrentMarkdown();
      const backedUp = await api.createSnapshot(props.project.projectId, props.selectedId, current, "Before restore");
      props.onState(backedUp);
      await props.onRestoreMarkdown(revisionMarkdown);
      const refreshed = await api.writeStudio(props.project.projectId);
      props.onState(refreshed);
      setCompareRevision(null);
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setHistoryBusy(false); }
  }

  async function scanBook(force = false): Promise<SectionDocument[]> {
    if (bookDocs && !force) return bookDocs;
    setSearchBusy(true);
    try {
      const saved = await props.onSaveCurrent();
      if (!saved) throw new Error("Current editors could not be saved before scanning the book.");
      const docs = (await Promise.all(props.project.sections.map((section) => api.section(props.project.projectId, section.id))))
        .filter((doc) => doc.editable)
        .map((doc) => doc.id === props.selectedId ? { ...doc, markdown: props.draft } : doc);
      setBookDocs(docs);
      return docs;
    } finally {
      setSearchBusy(false);
    }
  }

  async function replaceAll() {
    if (!query || searchError) return;
    if (scope === "chapter") {
      if (!props.selectedId) return;
      const next = replaceMatches(props.draft, query, replacement, searchOptions);
      if (next === props.draft) return;
      if (!window.confirm("Replace all " + currentMatchCount + " match" + (currentMatchCount === 1 ? "" : "es") + " in this chapter? Folio will create a safety snapshot first.")) return;
      const current = await props.onGetCurrentMarkdown();
      props.onState(await api.createSnapshot(props.project.projectId, props.selectedId, current, "Before Replace All"));
      props.onReplaceCurrent(next);
      return;
    }

    try {
      const saved = await props.onSaveCurrent();
      if (!saved) throw new Error("Current chapter could not be saved before Replace All.");
      const docs = await scanBook(true);
      const affected = docs.filter((doc) => countMatches(doc.markdown, query, searchOptions) > 0);
      if (!affected.length) return;
      if (!window.confirm("Replace all matches in " + affected.length + " section" + (affected.length === 1 ? "" : "s") + "? Folio will create a whole-book safety snapshot first.")) return;
      const safety = await api.createBookSnapshot(props.project.projectId, "Before Replace All");
      props.onState(safety);
      setSearchBusy(true);
      let currentReplacement: string | null = null;
      for (const doc of affected) {
        const next = replaceMatches(doc.markdown, query, replacement, searchOptions);
        await api.saveSection(props.project.projectId, doc.id, next);
        if (doc.id === props.selectedId) currentReplacement = next;
      }
      if (currentReplacement !== null) props.onReplaceCurrent(currentReplacement);
      const summary = await api.reload(props.project.projectId);
      props.onProjectUpdate(summary);
      setBookDocs(null);
      setExactCounts(null);
    } catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setSearchBusy(false); }
  }

  async function inspectAnalysisWord(word: string) {
    if (analysisScope === "book" && !bookDocs) {
      try { await scanBook(); }
      catch (error) { props.onError(error instanceof Error ? error.message : String(error)); return; }
    }
    setQuery(word);
    setReplacement("");
    setSearchOptions({ caseSensitive: false, wholeWord: true, regex: false });
    setScope(analysisScope);
    props.setActiveTab("find");
  }

  async function bookMatches() {
    if (!query || searchError) return [];
    try {
      const docs = scope === "book"
        ? (await scanBook()).map((doc) => doc.id === props.selectedId ? { ...doc, markdown: props.draft } : doc)
        : (props.document ? [{ ...props.document, markdown: props.draft }] : []);
      const regex = buildSearchRegex(query, searchOptions, true);
      const hits: SearchHit[] = [];
      for (const doc of docs) {
        for (const match of doc.markdown.matchAll(regex)) {
          const index = match.index ?? 0;
          const text = match[0] || query;
          const start = Math.max(0, index - 45);
          const end = Math.min(doc.markdown.length, index + text.length + 65);
          const before = doc.markdown.slice(start, index);
          const after = doc.markdown.slice(index + text.length, end);
          const replaced = replacementForMatch(doc.markdown, match, replacement);
          hits.push({
            sectionId: doc.id,
            title: doc.title,
            text,
            snippet: (before + text + after).replace(/\s+/g, " "),
            replacementSnippet: (before + replaced + after).replace(/\s+/g, " "),
            prefix: before.replace(/\s+/g, " ").slice(-120),
            suffix: after.replace(/\s+/g, " ").slice(0, 120),
          });
          if (hits.length >= 80) return hits;
        }
      }
      return hits;
    } catch (error) {
      props.onError(error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  useEffect(() => {
    if (!query) { setSearchHits([]); return; }
    if (scope === "book" && !bookDocs) { setSearchHits([]); return; }
    void bookMatches().then(setSearchHits);
  }, [query, replacement, scope, searchOptions.caseSensitive, searchOptions.wholeWord, searchOptions.regex, props.draft, props.selectedId, bookDocs]);

  if (!props.open) return null;

  return <aside className={"write-studio-drawer " + (props.activeTab === "history" && compareRevision ? "compare-expanded " : "") + (props.activeTab === "research" ? "notes-expanded" : "")} aria-label="Writing tools">
    <header className="write-studio-header">
      <div><span className="write-studio-eyebrow">Write</span><strong>Writing Studio</strong></div>
      <button type="button" onClick={props.onClose} aria-label="Close writing tools">×</button>
    </header>

    <nav className="write-studio-tabs" aria-label="Writing Studio sections">
      {tabs.map((tab) => <button key={tab.key} className={props.activeTab === tab.key ? "active" : ""} onClick={() => props.setActiveTab(tab.key)}>{tab.label}</button>)}
    </nav>

    <div className="write-studio-body">
      {!props.state && <div className="write-studio-empty">Loading writing data…</div>}

      {props.state && props.activeTab === "session" && <div className="write-studio-section">
        <div className="write-section-heading"><div><h3>Writing targets</h3><p>Project data, stored inside the .folio file.</p></div><button className="write-small-button primary" onClick={() => void saveTargets()}>Save</button></div>
        <div className="write-target-grid">
          <NumberTarget label="Book" value={targetDraft.book} placeholder="90000" onChange={(book) => { setTargetsDirty(true); setTargetDraft({ ...targetDraft, book }); }}/>
          <NumberTarget label="Daily" value={targetDraft.daily} placeholder="1500" onChange={(daily) => { setTargetsDirty(true); setTargetDraft({ ...targetDraft, daily }); }}/>
          <NumberTarget label="Session" value={targetDraft.session} placeholder="1000" onChange={(session) => { setTargetsDirty(true); setTargetDraft({ ...targetDraft, session }); }}/>
          <NumberTarget label="Chapter" value={chapterTarget} placeholder="5000" onChange={(value) => {
            if (!props.selectedId) return;
            const chapters = { ...targetDraft.chapters };
            if (value === null) delete chapters[props.selectedId];
            else chapters[props.selectedId] = value;
            setTargetsDirty(true);
            setTargetDraft({ ...targetDraft, chapters });
          }}/>
        </div>
        <div className="write-progress-stack">
          <TargetProgress label="Book" value={exactBookWords} target={targetDraft.book}/>
          <TargetProgress label="Today" value={todayProgress} target={targetDraft.daily}/>
          <TargetProgress label="This session" value={Math.max(0, sessionNet)} target={targetDraft.session}/>
          <TargetProgress label="Current chapter" value={props.currentWords} target={chapterTarget}/>
        </div>

        <h3 className="write-subheading">Session stats</h3>
        <div className="write-stat-grid">
          <div><span>Active time</span><strong>{formatDuration(props.session.activeMs)}</strong></div>
          <div><span>Gross</span><strong>+{props.session.gross.toLocaleString()}</strong></div>
          <div><span>Deleted</span><strong>−{props.session.deleted.toLocaleString()}</strong></div>
          <div><span>Net</span><strong>{sessionNet >= 0 ? "+" : ""}{sessionNet.toLocaleString()}</strong></div>
          <div><span>Words/min</span><strong>{props.session.activeMs < 1000 ? 0 : Math.max(0, Math.round(props.session.gross / (props.session.activeMs / 60000)))}</strong></div>
          <div><span>Chapter</span><strong>{props.currentWords.toLocaleString()}</strong></div>
        </div>
      </div>}

      {props.state && props.activeTab === "research" && <div className="write-studio-section notes-section">
        <div className="write-section-heading"><div><h3>Project notes</h3><p>Private working notes stored with this .folio project. They never become book content and never enter export.</p></div></div>
        <div className="notes-compose">
          <input value={researchTitle} placeholder="Title (optional)" onChange={(event) => setResearchTitle(event.target.value)}/>
          <textarea
            value={researchBody}
            placeholder="Ideas, reminders, character details, research, things to fix later…"
            onChange={(event) => setResearchBody(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                void addResearch();
              }
            }}
          />
          <div className="notes-compose-footer"><small>Ctrl/Cmd + Enter to save</small><button className="write-small-button primary" disabled={!researchTitle.trim() && !researchBody.trim()} onClick={() => void addResearch()}>Save note</button></div>
        </div>

        <div className="notes-library-head">
          <div><h4>Notebook</h4><span>{props.state.research.length} {props.state.research.length === 1 ? "note" : "notes"}</span></div>
          <input value={noteQuery} placeholder="Search notes…" aria-label="Search project notes" onChange={(event) => setNoteQuery(event.target.value)}/>
        </div>
        <div className="notes-list">
          {notes.map((note) => editingResearch === note.id
            ? <article className="note-editor-card" key={note.id}>
                <input value={editResearchTitle} placeholder="Title" onChange={(event) => setEditResearchTitle(event.target.value)}/>
                <textarea autoFocus value={editResearchBody} placeholder="Write your note…" onChange={(event) => setEditResearchBody(event.target.value)}/>
                <div className="write-card-actions"><button onClick={() => setEditingResearch(null)}>Cancel</button><button className="primary" onClick={() => void saveResearch(note.id)}>Save</button></div>
              </article>
            : <article className={"note-list-card " + (note.pinned ? "pinned" : "")} key={note.id}>
                <button className="note-open" onClick={() => { setEditingResearch(note.id); setEditResearchTitle(note.title); setEditResearchBody(note.body); }}>
                  <span className="note-card-head"><strong>{note.title.trim() || "Untitled note"}</strong>{note.pinned && <span>Pinned</span>}</span>
                  <span className="note-card-preview">{note.body.trim() || "Empty note"}</span>
                  <small>Edited {shortDate(note.updatedAt)}</small>
                </button>
                <div className="note-card-actions">
                  <button onClick={() => void api.updateResearchNote(props.project.projectId, note.id, { pinned: !note.pinned }).then(props.onState).catch((e) => props.onError(e instanceof Error ? e.message : String(e)))}>{note.pinned ? "Unpin" : "Pin"}</button>
                  <button className="danger" onClick={() => void api.deleteResearchNote(props.project.projectId, note.id).then(props.onState).catch((e) => props.onError(e instanceof Error ? e.message : String(e)))}>Delete</button>
                </div>
              </article>
          )}
          {!props.state.research.length && <div className="write-studio-empty">No notes yet. This is the place for everything that should stay out of the manuscript.</div>}
          {Boolean(props.state.research.length) && !notes.length && <div className="write-studio-empty">No notes match that search.</div>}
        </div>

        <div className="research-images-heading"><h4>Reference images</h4><label className={"write-small-button " + (imageBusy ? "disabled" : "")}>{imageBusy ? "Adding…" : "Add image"}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={imageBusy} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void addResearchImage(file); event.currentTarget.value = ""; }}/></label></div>
        <div className="research-image-grid">
          {props.state.researchImages.map((image) => <figure key={image.id} className="research-image-card">
            <img src={api.researchImageUrl(props.project.projectId, image.id)} alt={image.filename}/>
            <figcaption><span title={image.filename}>{image.filename}</span><button type="button" title="Delete reference image" aria-label={"Delete " + image.filename} onClick={() => void api.deleteResearchImage(props.project.projectId, image.id).then(props.onState).catch((e) => props.onError(e instanceof Error ? e.message : String(e)))}>×</button></figcaption>
          </figure>)}
          {!props.state.researchImages.length && <div className="research-image-empty">No reference images.</div>}
        </div>
      </div>}

      {props.state && props.activeTab === "comments" && <div className="write-studio-section">
        <div className="write-section-heading"><div><h3>Inline comments</h3><p>Select text in the manuscript, then attach a note. Comments never enter export.</p></div></div>
        <div className="comment-compose"><textarea value={commentBody} placeholder="Comment…" onChange={(event) => setCommentBody(event.target.value)}/><button className="write-small-button primary" disabled={!props.selectedId} onMouseDown={(event) => event.preventDefault()} onClick={() => void addComment()}>Add to selection</button></div>
        <div className="write-card-list">
          {comments.map((comment) => <article className={"write-card comment-card " + (comment.resolved ? "resolved" : "")} key={comment.id}>
            <button className="comment-quote" onClick={() => props.onRevealText(comment.quote, comment.prefix, comment.suffix)}>“{comment.quote}”</button>
            {editingComment === comment.id
              ? <><textarea className="comment-edit-body" value={editCommentBody} onChange={(event) => setEditCommentBody(event.target.value)}/><div className="write-card-actions"><button onClick={() => setEditingComment(null)}>Cancel</button><button className="primary" onClick={() => void api.updateWritingComment(props.project.projectId, comment.id, { body: editCommentBody }).then((state) => { props.onState(state); setEditingComment(null); }).catch((e) => props.onError(e instanceof Error ? e.message : String(e)))}>Save</button></div></>
              : <>{comment.body && <p>{comment.body}</p>}<div className="write-card-actions"><button onClick={() => { setEditingComment(comment.id); setEditCommentBody(comment.body); }}>Edit</button><button onClick={() => void api.updateWritingComment(props.project.projectId, comment.id, { resolved: !comment.resolved }).then(props.onState).catch((e) => props.onError(e instanceof Error ? e.message : String(e)))}>{comment.resolved ? "Reopen" : "Resolve"}</button><button className="danger" onClick={() => void api.deleteWritingComment(props.project.projectId, comment.id).then(props.onState).catch((e) => props.onError(e instanceof Error ? e.message : String(e)))}>Delete</button></div></>}
          </article>)}
          {!comments.length && <div className="write-studio-empty">No comments in this section.</div>}
        </div>
      </div>}

      {props.state && props.activeTab === "history" && <div className="write-studio-section history-section">
        <div className="write-section-heading"><div><h3>Snapshots & history</h3><p>Snapshots are permanent. Autosave history is retained and trimmed automatically.</p></div></div>
        <div className="snapshot-scope" role="group" aria-label="Snapshot scope"><button className={snapshotScope === "chapter" ? "active" : ""} onClick={() => setSnapshotScope("chapter")}>Current chapter</button><button className={snapshotScope === "book" ? "active" : ""} onClick={() => setSnapshotScope("book")}>Whole book</button></div>
        <div className="snapshot-compose"><input value={snapshotLabel} placeholder="Snapshot label (optional)" onChange={(event) => setSnapshotLabel(event.target.value)}/><button className="write-small-button primary" disabled={historyBusy || (snapshotScope === "chapter" && !props.document?.editable)} onClick={() => void createSnapshot()}>Create snapshot</button></div>
        <div className="revision-list">
          {revisions.map((revision) => <button key={revision.id} className={"revision-row " + (compareRevision?.revision.id === revision.id ? "active" : "")} onClick={() => void loadRevision(revision.id)}><span className={"revision-kind " + revision.kind + " " + revision.scope}>{revision.scope === "book" ? "Book" : revision.kind === "snapshot" ? "Snapshot" : "Auto"}</span><span className="revision-copy"><strong>{revision.label || shortDate(revision.createdAt)}</strong><small>{revision.wordCount.toLocaleString()} words{revision.sectionCount ? " · " + revision.sectionCount + " sections" : ""} · {shortDate(revision.createdAt)}</small></span></button>)}
          {!revisions.length && <div className="write-studio-empty">History will appear after writing or creating a snapshot.</div>}
        </div>
        {compareRevision && <div className="revision-compare">
          <div className="revision-compare-head"><strong>{compareRevision.revision.scope === "book" ? "Whole-book snapshot" : "Previous | Current"}</strong><div><button className="write-small-button" onClick={() => setCompareRevision(null)}>Close</button><button className="write-small-button primary" disabled={historyBusy} onClick={() => void restoreRevision()}>Restore</button></div></div>
          {compareRevision.revision.scope === "book"
            ? <div className="book-snapshot-summary"><strong>{compareRevision.revision.wordCount.toLocaleString()} words</strong><span>{compareRevision.revision.sectionCount ?? compareRevision.sections?.length ?? 0} editable sections captured</span><p>Restoring changes manuscript content only. Folio keeps the current book style, export settings and project appearance.</p></div>
            : <div className="revision-side-by-side">
                <div className="revision-column-head"><span>Previous</span><span>Current</span></div>
                <div className="revision-compare-grid">{diffLines(markdownToReadableSnapshotText(compareRevision.markdown ?? ""), markdownToReadableSnapshotText(props.draft)).map((line, index) => <div key={index} className={"compare-row " + line.kind}><span className="previous">{line.kind === "add" ? "" : line.text || " "}</span><span className="current">{line.kind === "remove" ? "" : line.text || " "}</span></div>)}</div>
              </div>}
        </div>}
      </div>}

      {props.state && props.activeTab === "find" && <div className="write-studio-section">
        <div className="write-section-heading"><div><h3>Find & replace</h3><p>Search a chapter or scan the whole book before changing anything.</p></div></div>
        <div className="advanced-search">
          <input value={query} placeholder="Find" onChange={(event) => setQuery(event.target.value)}/>
          <input value={replacement} placeholder="Replace with" onChange={(event) => setReplacement(event.target.value)}/>
          <div className="search-scope"><button className={scope === "chapter" ? "active" : ""} onClick={() => setScope("chapter")}>Chapter</button><button className={scope === "book" ? "active" : ""} onClick={() => { setScope("book"); setSearchHits([]); }}>Entire book</button></div>
          <div className="search-options"><label><input type="checkbox" checked={searchOptions.caseSensitive} onChange={(event) => setSearchOptions({ ...searchOptions, caseSensitive: event.target.checked })}/> Case sensitive</label><label><input type="checkbox" checked={searchOptions.wholeWord} onChange={(event) => setSearchOptions({ ...searchOptions, wholeWord: event.target.checked })}/> Whole words</label><label><input type="checkbox" checked={searchOptions.regex} onChange={(event) => setSearchOptions({ ...searchOptions, regex: event.target.checked })}/> Regex</label></div>
          {searchError && <div className="write-inline-error">{searchError}</div>}
          <div className="search-actions"><span>{scope === "chapter" ? currentMatchCount + " matches" : (bookDocs ? "Book scanned" : "Book not scanned")}</span>{scope === "book" && <button className="write-small-button" disabled={searchBusy || !query} onClick={() => void bookMatches().then(setSearchHits)}>{searchBusy ? "Scanning…" : "Scan book"}</button>}<button className="write-small-button primary" disabled={searchBusy || !query || Boolean(searchError)} onClick={() => void replaceAll()}>Replace all</button></div>
        </div>
        <div className="search-hit-list">
          {searchHits.map((hit, index) => <button key={hit.sectionId + ":" + index} onClick={() => void props.onNavigateText(hit.sectionId, hit.text, hit.prefix, hit.suffix)}>
            <strong>{hit.title}</strong>
            <span className="search-preview-label">Before</span><span>{hit.snippet}</span>
            {replacement !== "" && <><span className="search-preview-label after">After</span><span className="search-preview-after">{hit.replacementSnippet}</span></>}
          </button>)}
          {searchHits.length >= 80 && <div className="search-result-cap">Showing first 80 matches.</div>}
          {scope === "book" && bookDocs && !searchHits.length && query && <div className="write-studio-empty">No matches in scanned sections.</div>}
        </div>
      </div>}

      {props.state && props.activeTab === "analysis" && <div className="write-studio-section">
        <div className="write-section-heading"><div><h3>Repetition analysis</h3><p>Diagnostics only. Folio never rewrites your prose.</p></div></div>
        <div className="search-scope analysis-scope"><button className={analysisScope === "chapter" ? "active" : ""} onClick={() => setAnalysisScope("chapter")}>Chapter</button><button className={analysisScope === "book" ? "active" : ""} onClick={() => { setAnalysisScope("book"); if (!bookDocs) void scanBook().catch((error) => props.onError(error instanceof Error ? error.message : String(error))); }}>Entire book</button></div>
        {analysisScope === "book" && !bookDocs ? <div className="write-studio-empty">{searchBusy ? "Scanning manuscript…" : "Open Entire Book to scan the manuscript."}</div> : <>
          <h4>Repeated words</h4>
          <div className="analysis-list">{repeated.map((item) => <button key={item.word} onClick={() => void inspectAnalysisWord(item.word)}><span>{item.word}</span><strong>{item.count}</strong></button>)}{!repeated.length && <div className="write-studio-empty">No notable repetitions in this scope.</div>}</div>
          <div className="analysis-window"><label>Nearby window <input type="range" min="30" max="180" step="10" value={analysisWindow} onChange={(event) => setAnalysisWindow(Number(event.target.value))}/><span>{analysisWindow} words</span></label></div>
          <h4>Nearby repetitions</h4>
          <div className="analysis-list nearby">{nearby.map((item) => <button key={item.word} onClick={() => void inspectAnalysisWord(item.word)}><span>{item.word}</span><strong>{item.count}× / {item.windowWords}</strong></button>)}{!nearby.length && <div className="write-studio-empty">Nothing repeated three times inside this window.</div>}</div>
        </>}
      </div>}
    </div>
  </aside>;
}

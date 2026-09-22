import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { markdownToEditorHtml, richTextToMarkdown, richTextToMarkdownCooperative } from "./rich-text";
import { centerTypewriterCaret, scheduleTypewriterCaret } from "./typewriter";
import type { ProjectSummary, SectionDocument } from "./types";

type SplitSaveState = "idle" | "saving" | "saved" | "error";

type WritingSplitPaneProps = {
  project: ProjectSummary;
  primarySectionId: string | null;
  ornament: string;
  typewriterMode: boolean;
  spellcheckEnabled: boolean;
  writeZoom: number;
  onClose: () => void;
  onError: (message: string) => void;
  onRegisterFlush: (flush: (() => Promise<boolean>) | null) => void;
};

function sectionFallback(project: ProjectSummary, primarySectionId: string | null, preferred?: string | null): string | null {
  if (preferred && preferred !== primarySectionId && project.sections.some((section) => section.id === preferred)) return preferred;
  return project.sections.find((section) => section.id !== primarySectionId && section.kind === "chapter")?.id
    ?? project.sections.find((section) => section.id !== primarySectionId)?.id
    ?? null;
}

export default function WritingSplitPane(props: WritingSplitPaneProps) {
  const [selectedId, setSelectedId] = useState<string | null>(() => sectionFallback(props.project, props.primarySectionId));
  const [document, setDocument] = useState<SectionDocument | null>(null);
  const [saveState, setSaveState] = useState<SplitSaveState>("idle");
  const editorRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<SectionDocument | null>(null);
  const dirtyRef = useRef(false);
  const generationRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const loadingRef = useRef(0);

  const sections = useMemo(
    () => props.project.sections.filter((section) => section.id !== props.primarySectionId),
    [props.project.sections, props.primarySectionId],
  );

  useEffect(() => {
    const fallback = sectionFallback(props.project, props.primarySectionId, selectedId);
    if (fallback !== selectedId) setSelectedId(fallback);
  }, [props.project.projectId, props.project.sections, props.primarySectionId]);

  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  useEffect(() => {
    if (!props.typewriterMode) return;
    scheduleTypewriterCaret(editorRef.current);
  }, [props.typewriterMode, selectedId, document?.id]);

  useEffect(() => {
    if (!selectedId) {
      setDocument(null);
      documentRef.current = null;
      return;
    }
    const request = ++loadingRef.current;
    setDocument(null);
    setSaveState("idle");
    dirtyRef.current = false;
    api.section(props.project.projectId, selectedId)
      .then((next) => {
        if (request !== loadingRef.current) return;
        setDocument(next);
        documentRef.current = next;
      })
      .catch((error) => props.onError(error instanceof Error ? error.message : String(error)));
  }, [props.project.projectId, selectedId]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !document) return;
    if (editor.dataset.sectionId === document.id && dirtyRef.current) return;
    editor.innerHTML = document.editable
      ? markdownToEditorHtml(
          document.markdown,
          props.ornament,
          (asset) => `/api/projects/${encodeURIComponent(props.project.projectId)}/asset?path=${encodeURIComponent(asset)}`,
        )
      : document.markdown;
    editor.dataset.sectionId = document.id;
    editor.dataset.markdown = document.markdown;
    dirtyRef.current = false;
  }, [document?.id, document?.markdown, document?.editable, props.ornament, props.project.projectId]);

  async function flush(): Promise<boolean> {
    const editor = editorRef.current;
    const current = documentRef.current;
    if (!editor || !current?.editable || !dirtyRef.current) return true;

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const generation = generationRef.current;
    const html = editor.innerHTML;
    setSaveState("saving");
    try {
      const markdown = html.length >= 80_000
        ? await richTextToMarkdownCooperative(html)
        : richTextToMarkdown(html);
      if (generation !== generationRef.current) return flush();
      if (markdown === current.markdown) {
        dirtyRef.current = false;
        setSaveState("saved");
        return true;
      }
      const saved = await api.saveSection(props.project.projectId, current.id, markdown);
      if (generation === generationRef.current) {
        editor.dataset.markdown = saved.markdown;
        dirtyRef.current = false;
        setDocument(saved);
        documentRef.current = saved;
        setSaveState("saved");
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSaveState("error");
      props.onError(message);
      return false;
    }
  }

  useEffect(() => {
    props.onRegisterFlush(flush);
    return () => props.onRegisterFlush(null);
  });

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
  }, []);

  function recordInput() {
    if (!documentRef.current?.editable) return;
    dirtyRef.current = true;
    generationRef.current += 1;
    setSaveState("saving");
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void flush();
    }, 700);
    if (props.typewriterMode) scheduleTypewriterCaret(editorRef.current);
  }

  function runCommand(command: string, value?: string) {
    const editor = editorRef.current;
    if (!editor || !documentRef.current?.editable) return;
    editor.focus();
    window.document.execCommand("styleWithCSS", false, "true");
    window.document.execCommand(command, false, value);
    requestAnimationFrame(recordInput);
  }

  async function changeSection(nextId: string) {
    if (nextId === selectedId) return;
    if (!(await flush())) return;
    setSelectedId(nextId);
  }

  return <section className="writing-split-pane" aria-label="Split writing editor" data-write-zoom={Math.round(props.writeZoom * 100)}>
    <header className="writing-split-header">
      <div className="writing-split-title">
        <span>Split editor</span>
        <select
          aria-label="Split editor section"
          value={selectedId ?? ""}
          onChange={(event) => void changeSection(event.target.value)}
        >
          {sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
        </select>
      </div>
      <div className="writing-split-status">
        <span>{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : ""}</span>
      </div>
    </header>

    <div className="writing-split-toolbar" aria-label="Split editor formatting">
      <button type="button" disabled={!document?.editable} title="Undo" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("undo")}>↶</button>
      <button type="button" disabled={!document?.editable} title="Redo" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("redo")}>↷</button>
      <span className="writing-toolbar-rule"/>
      <button type="button" disabled={!document?.editable} title="Bold" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("bold")}><strong>B</strong></button>
      <button type="button" disabled={!document?.editable} title="Italic" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("italic")}><em>I</em></button>
      <button type="button" disabled={!document?.editable} title="Underline" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("underline")}><u>U</u></button>
      <button type="button" disabled={!document?.editable} title="Strikethrough" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("strikeThrough")}><s>S</s></button>
      <span className="writing-toolbar-rule"/>
      <label className="writing-color-control" title="Text color">
        <span>A</span>
        <input type="color" defaultValue="#b42318" disabled={!document?.editable} onChange={(event) => runCommand("foreColor", event.target.value)}/>
      </label>
      <label className="writing-color-control writing-highlight-control" title="Highlight color">
        <span>H</span>
        <input type="color" defaultValue="#d8f2d0" disabled={!document?.editable} onChange={(event) => runCommand("hiliteColor", event.target.value)}/>
      </label>
      <button type="button" className="writing-clear-format" disabled={!document?.editable} title="Clear inline formatting" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("removeFormat")}>Clear</button>
    </div>

    <div className="writing-split-paper">
      {selectedId
        ? document
          ? <div
              ref={editorRef}
              className={`writing-split-editor rich-editor ${props.typewriterMode ? "typewriter-active" : ""}`}
              style={{ "--folio-write-font-size": `${16 * props.writeZoom}px` } as React.CSSProperties}
              contentEditable={document.editable}
              suppressContentEditableWarning
              spellCheck={props.spellcheckEnabled}
              data-placeholder="Start writing…"
              onInput={recordInput}
              onClick={() => { if (props.typewriterMode) centerTypewriterCaret(editorRef.current); }}
              onKeyUp={() => { if (props.typewriterMode) scheduleTypewriterCaret(editorRef.current); }}
              onFocus={() => { if (props.typewriterMode) scheduleTypewriterCaret(editorRef.current); }}
              aria-label={`Edit ${document.title} in split view`}
            />
          : <div className="writing-split-loading">Loading section…</div>
        : <div className="writing-split-loading">Choose another section to open split view.</div>}
    </div>
  </section>;
}

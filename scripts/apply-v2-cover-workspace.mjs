import { promises as fs } from "node:fs";

const file = "web/src/App.tsx";
let source = await fs.readFile(file, "utf8");

function replaceOnce(before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Patch anchor missing: ${label}`);
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`Patch anchor is not unique: ${label}`);
  source = source.slice(0, index) + after + source.slice(index + before.length);
}

replaceOnce(
  'const defaultPrint: PrintOptions = { trim: "6x9", binding: "paperback", startChaptersRecto: true, layout: "author-title-bottom" };',
  'const defaultPrint: PrintOptions = { trim: "6x9", binding: "paperback", startChaptersRecto: true, layout: "author-title-bottom" };\nconst COVER_ID = "__folio_cover__";',
  "cover id",
);

replaceOnce(
  '    const bookPath = new URLSearchParams(window.location.search).get("book")?.trim();\n    if (bookPath) void openFolder(bookPath);',
  '    const params = new URLSearchParams(window.location.search);\n    const bookPath = params.get("book")?.trim();\n    if (bookPath) void openFolder(bookPath);\n    else if (params.get("sample") === "1") void loadSample();',
  "startup routing",
);

replaceOnce(
  '  const selectedSection = project?.sections.find((s) => s.id === selectedId) ?? null;\n  const previewProfile = getPreviewProfile(previewMode);',
  '  const selectedSection = project?.sections.find((s) => s.id === selectedId) ?? null;\n  const coverSelected = selectedId === COVER_ID;\n  const previewProfile = getPreviewProfile(previewMode);',
  "cover selected state",
);

replaceOnce(
  '    if (!project || !selectedId) return;\n    // Renaming can change a chapter slug/id.',
  '    if (!project || !selectedId || selectedId === COVER_ID) return;\n    // Renaming can change a chapter slug/id.',
  "skip cover document fetch",
);

replaceOnce(
  '    if (!project || !meta || !selectedId || document?.id !== selectedId || previewMode === "print") return;',
  '    if (!project || !meta || !selectedId || selectedId === COVER_ID || document?.id !== selectedId || previewMode === "print") return;',
  "skip cover reader preview request",
);

replaceOnce(
  '    if (!project || !meta || !selectedId || document?.id !== selectedId || previewMode !== "print") return;',
  '    if (!project || !meta || !selectedId || selectedId === COVER_ID || document?.id !== selectedId || previewMode !== "print") return;',
  "skip cover print preview request",
);

replaceOnce(
  '    if (previewMode === "print" || !selectedId || document?.id !== selectedId || !document.editable) return "none";',
  '    if (previewMode === "print" || !selectedId || selectedId === COVER_ID || document?.id !== selectedId || !document.editable) return "none";',
  "skip cover live draft",
);

replaceOnce(
  '  const selectedPosition = project?.sections.findIndex((section) => section.id === selectedId) ?? -1;\n  const previousSection = selectedPosition > 0 ? project?.sections[selectedPosition - 1] : null;\n  const nextSection = project && selectedPosition >= 0 && selectedPosition < project.sections.length - 1\n    ? project.sections[selectedPosition + 1]\n    : null;',
  '  const navigationIds = project ? [COVER_ID, ...project.sections.map((section) => section.id)] : [];\n  const selectedPosition = selectedId ? navigationIds.indexOf(selectedId) : -1;\n  const previousId = selectedPosition > 0 ? navigationIds[selectedPosition - 1] : null;\n  const nextId = selectedPosition >= 0 && selectedPosition < navigationIds.length - 1\n    ? navigationIds[selectedPosition + 1]\n    : null;',
  "cover navigation",
);

replaceOnce(
  '        <nav className="contents-list" aria-label="Book contents">\n          {frontMatter.map((section) => <button key={section.id} className={`contents-row ${selectedId === section.id ? "selected" : ""}`} onClick={() => void selectSection(section.id)}><span>{section.title}</span></button>)}',
  '        <nav className="contents-list" aria-label="Book contents">\n          <button className={`contents-row cover-row ${coverSelected ? "selected" : ""}`} onClick={() => void selectSection(COVER_ID)}><span>Cover</span><small>{project.hasCover ? "" : "Add"}</small></button>\n          {frontMatter.map((section) => <button key={section.id} className={`contents-row ${selectedId === section.id ? "selected" : ""}`} onClick={() => void selectSection(section.id)}><span>{section.title}</span></button>)}',
  "cover contents row",
);

replaceOnce(
  '<div className="section-titlebar"><ChapterHeading title={selectedSection?.title ?? document?.title ?? ""} subtitle={document?.subtitle ?? ""} index={chapterIndex} editable={selectedSection?.kind === "chapter"} busy={busy} onTitle={(title) => void updateCurrentChapterHeading({ title })} onSubtitle={(subtitle) => void updateCurrentChapterHeading({ subtitle })}/><div className="section-actions">',
  '<div className="section-titlebar">{coverSelected ? <div className="section-title-wrap cover-workspace-heading"><span className="section-title">Cover</span></div> : <ChapterHeading title={selectedSection?.title ?? document?.title ?? ""} subtitle={document?.subtitle ?? ""} index={chapterIndex} editable={selectedSection?.kind === "chapter"} busy={busy} onTitle={(title) => void updateCurrentChapterHeading({ title })} onSubtitle={(subtitle) => void updateCurrentChapterHeading({ subtitle })}/>}<div className="section-actions">',
  "cover editor heading",
);

replaceOnce(
  '<div className="format-toolbar">',
  '<div className={`format-toolbar ${coverSelected ? "cover-toolbar" : ""}`}>',
  "cover toolbar",
);

replaceOnce(
  '<div className="editor-paper">{pastePreparing && <div className="paste-progress" role="status">Preparing pasted manuscript…</div>}{selectedId ? (document ? <div ref={editorRef} autoFocus className="manuscript-editor rich-editor" contentEditable={document.editable} suppressContentEditableWarning spellCheck data-placeholder="Start writing…" onPaste={editorPaste} onInput={recordEditorDom} onClick={editorClick} onKeyDown={editorKeyDown} aria-label={"Edit " + document.title}/> : <div className="editor-loading">Loading section…</div>) : <div className="empty-project-editor"><strong>This book has no chapters.</strong><span>Add the first chapter to start writing.</span><button className="native-button primary" onClick={() => setShowContent(true)}>Add Chapter</button></div>}{document && !document.editable && <div className="readonly-note">This page is generated from Book Details. <button onClick={() => setShowBookDetails(true)}>Edit Book Details</button></div>}</div>',
  '<div className="editor-paper">{coverSelected ? <CoverEditor projectId={project.projectId} hasCover={project.hasCover} coverVersion={coverVersion} busy={busy} onCover={(file) => void uploadCover(file)}/> : <>{pastePreparing && <div className="paste-progress" role="status">Preparing pasted manuscript…</div>}{selectedId ? (document ? <div ref={editorRef} autoFocus className="manuscript-editor rich-editor" contentEditable={document.editable} suppressContentEditableWarning spellCheck data-placeholder="Start writing…" onPaste={editorPaste} onInput={recordEditorDom} onClick={editorClick} onKeyDown={editorKeyDown} aria-label={"Edit " + document.title}/> : <div className="editor-loading">Loading section…</div>) : <div className="empty-project-editor"><strong>This book has no chapters.</strong><span>Add the first chapter to start writing.</span><button className="native-button primary" onClick={() => setShowContent(true)}>Add Chapter</button></div>}{document && !document.editable && <div className="readonly-note">This page is generated from Book Details. <button onClick={() => setShowBookDetails(true)}>Edit Book Details</button></div>}</>}</div>',
  "cover editor body",
);

replaceOnce(
  '<div className="device-nav"><button disabled={!previousSection} title="Previous section" aria-label="Previous section" onClick={() => previousSection && void selectSection(previousSection.id)}><UiIcon name="previous"/></button><span>{selectedPosition >= 0 ? selectedPosition + 1 : 0} / {project.sections.length}</span><button disabled={!nextSection} title="Next section" aria-label="Next section" onClick={() => nextSection && void selectSection(nextSection.id)}><UiIcon name="next"/></button></div>',
  '<div className="device-nav"><button disabled={!previousId} title="Previous section" aria-label="Previous section" onClick={() => previousId && void selectSection(previousId)}><UiIcon name="previous"/></button><span>{selectedPosition >= 0 ? selectedPosition + 1 : 0} / {navigationIds.length}</span><button disabled={!nextId} title="Next section" aria-label="Next section" onClick={() => nextId && void selectSection(nextId)}><UiIcon name="next"/></button></div>',
  "cover preview navigation",
);

replaceOnce(
  '{selectedId ? <iframe key={`${project.projectId}:${selectedId}`} ref={previewRef} className="preview-frame" title="Book preview" srcDoc={previewHtml} onLoad={() => onPreviewLoad()}/> : <div className="preview-empty">Add a chapter to see its live preview.</div>}',
  '{coverSelected ? (project.hasCover ? <div className="cover-preview-surface"><img src={`/api/projects/${project.projectId}/cover?v=${coverVersion}`} alt={`${meta.title} cover`}/></div> : <div className="cover-preview-empty"><strong>No cover yet</strong><span>Add a PNG or JPEG from the Cover workspace.</span></div>) : selectedId ? <iframe key={`${project.projectId}:${selectedId}`} ref={previewRef} className="preview-frame" title="Book preview" srcDoc={previewHtml} onLoad={() => onPreviewLoad()}/> : <div className="preview-empty">Add a chapter to see its live preview.</div>}',
  "cover device preview",
);

replaceOnce(
  'function DialogShell(props: { title: string; children: React.ReactNode; footer: React.ReactNode; onClose: () => void }) {',
  `function CoverEditor(props: { projectId: string; hasCover: boolean; coverVersion: number; busy: boolean; onCover: (file: File) => void }) {\n  return <div className="cover-editor-panel"><div className="cover-editor-card"><div className="cover-editor-art">{props.hasCover ? <img src={\`/api/projects/\${props.projectId}/cover?v=\${props.coverVersion}\`} alt="Book cover"/> : <div className="cover-editor-empty"><strong>No cover yet</strong><span>Add the finished front-cover image for this book.</span></div>}</div><label className="native-button primary cover-upload-button">{props.hasCover ? "Replace Cover…" : "Add Cover…"}<input type="file" accept="image/png,image/jpeg" disabled={props.busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onCover(file); event.currentTarget.value = ""; }}/></label><p className="cover-editor-copy">The cover is embedded in EPUB and Reading PDF exports. Print PDF remains an interior file for print-on-demand services.</p></div></div>;\n}\n\nfunction DialogShell(props: { title: string; children: React.ReactNode; footer: React.ReactNode; onClose: () => void }) {`,
  "cover editor component",
);

await fs.writeFile(file, source, "utf8");
console.log("Applied Folio 2.0 cover workspace patch.");

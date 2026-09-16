import { promises as fs } from "node:fs";

async function patch(file, fn) {
  const before = await fs.readFile(file, "utf8");
  const after = fn(before);
  if (after === before) throw new Error(`Patch made no changes: ${file}`);
  await fs.writeFile(file, after, "utf8");
}

function once(text, from, to, label) {
  const index = text.indexOf(from);
  if (index < 0) throw new Error(`Missing anchor: ${label}`);
  if (text.indexOf(from, index + from.length) >= 0) throw new Error(`Anchor is not unique: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

await patch("server/api.ts", (text) => {
  text = once(
    text,
    'import { registerImagePageApi } from "./image-page-api.ts";\n',
    'import { registerImagePageApi } from "./image-page-api.ts";\nimport { registerIllustrationApi } from "./illustration-api.ts";\n',
    "server illustration import",
  );
  return once(
    text,
    'export function registerApi(app: Express): void {\n  registerImagePageApi(app);\n',
    'export function registerApi(app: Express): void {\n  registerImagePageApi(app);\n  registerIllustrationApi(app);\n',
    "server illustration registration",
  );
});

await patch("web/src/api.ts", (text) => once(
  text,
  '  addImagePage: (projectId: string, file: File, title: string, alt: string, fit: "contain" | "cover" = "contain") => {\n    const fd = new FormData();\n    fd.append("image", file, file.name);\n    fd.append("title", title);\n    fd.append("alt", alt);\n    fd.append("fit", fit);\n    return fetch(`/api/projects/${projectId}/image-page`, { method: "POST", body: fd })\n      .then((r) => json<{ ok: true; entry: string; asset: string }>(r));\n  },\n\n',
  '  addImagePage: (projectId: string, file: File, title: string, alt: string, fit: "contain" | "cover" = "contain") => {\n    const fd = new FormData();\n    fd.append("image", file, file.name);\n    fd.append("title", title);\n    fd.append("alt", alt);\n    fd.append("fit", fit);\n    return fetch(`/api/projects/${projectId}/image-page`, { method: "POST", body: fd })\n      .then((r) => json<{ ok: true; entry: string; asset: string }>(r));\n  },\n\n  uploadIllustration: (projectId: string, file: File) => {\n    const fd = new FormData();\n    fd.append("image", file, file.name);\n    return fetch(`/api/projects/${projectId}/illustration`, { method: "POST", body: fd })\n      .then((r) => json<{ ok: true; asset: string; url: string }>(r));\n  },\n\n',
  "web illustration api",
));

await patch("web/src/rich-text.ts", (text) => {
  text = once(
    text,
    'function wrapInline(marker: string, value: string): string {\n',
    'function escapeMarkdownAlt(value: string): string {\n  return value.replace(/([\\\\\\]])/g, "\\\\$1");\n}\n\nfunction wrapInline(marker: string, value: string): string {\n',
    "markdown alt helper",
  );
  text = once(
    text,
    '  if (element.hasAttribute("data-scene-break")) return "\\n\\n---\\n\\n";\n\n',
    '  if (element.hasAttribute("data-scene-break")) return "\\n\\n---\\n\\n";\n  if (element.hasAttribute("data-folio-illustration")) {\n    const image = element.querySelector<HTMLImageElement>("img[data-folio-asset]");\n    const asset = image?.dataset.folioAsset?.trim();\n    if (!asset) return "";\n    const alt = escapeMarkdownAlt(image.alt.trim() || "Illustration");\n    return `\\n\\n![${alt}](${asset}){.folio-illustration}\\n\\n`;\n  }\n\n',
    "rich text illustration serialization",
  );
  text = once(
    text,
    '  if (tag === "IMG") return element.getAttribute("alt")?.trim() || "";\n',
    '  if (tag === "IMG" && element.hasAttribute("data-folio-asset")) {\n    const asset = element.getAttribute("data-folio-asset")?.trim();\n    const alt = escapeMarkdownAlt(element.getAttribute("alt")?.trim() || "Illustration");\n    return asset ? `![${alt}](${asset}){.folio-illustration}` : alt;\n  }\n  if (tag === "IMG") return element.getAttribute("alt")?.trim() || "";\n',
    "rich text image fallback",
  );
  text = once(
    text,
    'export function markdownToEditorHtml(markdown: string, ornament = "❦"): string {\n',
    'export function markdownToEditorHtml(markdown: string, ornament = "❦", resolveAsset?: (asset: string) => string): string {\n',
    "editor renderer signature",
  );
  text = once(
    text,
    '  for (const line of lines) {\n    if (/^\\s*(?:---|\\* \\* \\*)\\s*$/.test(line)) {\n',
    '  for (const line of lines) {\n    const image = line.trim().match(/^!\\[([^\\]]*)\\]\\(([^)]+)\\)(?:\\{[^}]*\\})?$/);\n    if (image) {\n      flush();\n      const alt = image[1].trim() || "Illustration";\n      const asset = image[2].trim();\n      const src = resolveAsset ? resolveAsset(asset) : asset;\n      blocks.push(`<figure class="editor-illustration" data-folio-illustration="true" contenteditable="false"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" data-folio-asset="${escapeHtml(asset)}"><figcaption>${escapeHtml(alt)}</figcaption><button type="button" class="editor-illustration-remove" aria-label="Remove illustration" title="Remove illustration">×</button></figure>`);\n      continue;\n    }\n    if (/^\\s*(?:---|\\* \\* \\*)\\s*$/.test(line)) {\n',
    "editor renderer image block",
  );
  return text;
});

await patch("web/src/App.tsx", (text) => {
  text = once(
    text,
    '  const editorRef = useRef<HTMLDivElement>(null);\n  const previewRef = useRef<HTMLIFrameElement>(null);\n',
    '  const editorRef = useRef<HTMLDivElement>(null);\n  const illustrationInputRef = useRef<HTMLInputElement>(null);\n  const illustrationRangeRef = useRef<Range | null>(null);\n  const previewRef = useRef<HTMLIFrameElement>(null);\n',
    "illustration refs",
  );
  text = once(
    text,
    '    editor.innerHTML = document.editable\n      ? markdownToEditorHtml(draft, ornament)\n      : generatedMatterToEditorHtml(draft);\n',
    '    editor.innerHTML = document.editable\n      ? markdownToEditorHtml(draft, ornament, (asset) => project ? `/api/projects/${encodeURIComponent(project.projectId)}/asset?path=${encodeURIComponent(asset)}` : asset)\n      : generatedMatterToEditorHtml(draft);\n',
    "editor asset resolver",
  );
  text = once(
    text,
    '  }, [document?.id, draft, typography.sceneOrnament, meta?.theme, themes]);\n',
    '  }, [document?.id, draft, typography.sceneOrnament, meta?.theme, themes, project?.projectId]);\n',
    "editor asset effect deps",
  );
  text = once(
    text,
    '  async function uploadCover(file: File) {\n',
    `  function rememberIllustrationCaret() {\n    const editor = editorRef.current;\n    const selection = window.getSelection();\n    if (!editor || !selection?.rangeCount || !selection.anchorNode || !editor.contains(selection.anchorNode)) {\n      illustrationRangeRef.current = null;\n      return;\n    }\n    illustrationRangeRef.current = selection.getRangeAt(0).cloneRange();\n  }\n\n  async function insertIllustration(file: File) {\n    if (!project || !document?.editable || selectedSection?.kind !== "frontmatter") return;\n    const editor = editorRef.current;\n    if (!editor) return;\n    setBusy(true); setError(null);\n    try {\n      const uploaded = await api.uploadIllustration(project.projectId, file);\n      const alt = file.name.replace(/\\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Illustration";\n      const figure = window.document.createElement("figure");\n      figure.className = "editor-illustration";\n      figure.setAttribute("data-folio-illustration", "true");\n      figure.contentEditable = "false";\n      const image = window.document.createElement("img");\n      image.src = uploaded.url;\n      image.alt = alt;\n      image.dataset.folioAsset = uploaded.asset;\n      const caption = window.document.createElement("figcaption");\n      caption.textContent = alt;\n      const remove = window.document.createElement("button");\n      remove.type = "button";\n      remove.className = "editor-illustration-remove";\n      remove.setAttribute("aria-label", "Remove illustration");\n      remove.title = "Remove illustration";\n      remove.textContent = "×";\n      figure.append(image, caption, remove);\n\n      const savedRange = illustrationRangeRef.current;\n      if (savedRange && editor.contains(savedRange.commonAncestorContainer)) {\n        savedRange.deleteContents();\n        savedRange.insertNode(figure);\n      } else {\n        editor.appendChild(figure);\n      }\n      const spacer = window.document.createElement("p");\n      spacer.innerHTML = "<br>";\n      figure.after(spacer);\n      illustrationRangeRef.current = null;\n      recordEditorDom();\n    } catch (e) {\n      setError(e instanceof Error ? e.message : String(e));\n    } finally {\n      setBusy(false);\n      if (illustrationInputRef.current) illustrationInputRef.current.value = "";\n    }\n  }\n\n  async function uploadCover(file: File) {\n`,
    "illustration insertion",
  );
  text = once(
    text,
    '  function editorClick(event: React.MouseEvent<HTMLDivElement>) {\n    const remove = (event.target as HTMLElement).closest(".editor-scene-break-remove");\n    if (remove) {\n      event.preventDefault();\n      remove.closest(".editor-scene-break")?.remove();\n      recordEditorDom();\n      return;\n    }\n    window.requestAnimationFrame(syncEditorClickToPreview);\n  }\n',
    '  function editorClick(event: React.MouseEvent<HTMLDivElement>) {\n    const target = event.target as HTMLElement;\n    const sceneRemove = target.closest(".editor-scene-break-remove");\n    if (sceneRemove) {\n      event.preventDefault();\n      sceneRemove.closest(".editor-scene-break")?.remove();\n      recordEditorDom();\n      return;\n    }\n    const illustrationRemove = target.closest(".editor-illustration-remove");\n    if (illustrationRemove) {\n      event.preventDefault();\n      illustrationRemove.closest(".editor-illustration")?.remove();\n      recordEditorDom();\n      return;\n    }\n    window.requestAnimationFrame(syncEditorClickToPreview);\n  }\n',
    "illustration removal",
  );
  text = once(
    text,
    '<div className="toolbar-group"><button disabled={!document?.editable} onMouseDown={(e) => e.preventDefault()} onClick={() => applyInlineFormat("bold", "bold text")} title="Bold (Ctrl+B)"><strong>B</strong></button><button disabled={!document?.editable} onMouseDown={(e) => e.preventDefault()} onClick={() => applyInlineFormat("italic", "italic text")} title="Italic (Ctrl+I)"><em>I</em></button><button disabled={!document?.editable} onMouseDown={(e) => e.preventDefault()} onClick={() => applyInlineFormat("underline", "underlined text")} title="Underline (Ctrl+U)"><u>U</u></button><button className="scene-break-button" disabled={!document?.editable} onMouseDown={(e) => e.preventDefault()} onClick={insertSceneBreak} title="Insert ornamental scene break">❦ <span>Break</span></button></div>',
    '<div className="toolbar-group"><button disabled={!document?.editable} onMouseDown={(e) => e.preventDefault()} onClick={() => applyInlineFormat("bold", "bold text")} title="Bold (Ctrl+B)"><strong>B</strong></button><button disabled={!document?.editable} onMouseDown={(e) => e.preventDefault()} onClick={() => applyInlineFormat("italic", "italic text")} title="Italic (Ctrl+I)"><em>I</em></button><button disabled={!document?.editable} onMouseDown={(e) => e.preventDefault()} onClick={() => applyInlineFormat("underline", "underlined text")} title="Underline (Ctrl+U)"><u>U</u></button><button className="scene-break-button" disabled={!document?.editable} onMouseDown={(e) => e.preventDefault()} onClick={insertSceneBreak} title="Insert ornamental scene break">❦ <span>Break</span></button><button className="illustration-button" disabled={busy || !document?.editable || selectedSection?.kind !== "frontmatter"} onMouseDown={(e) => { e.preventDefault(); rememberIllustrationCaret(); }} onClick={() => illustrationInputRef.current?.click()} title="Insert illustration into front matter">▧ <span>Image</span></button><input ref={illustrationInputRef} className="illustration-input" type="file" accept="image/png,image/jpeg" disabled={busy || !document?.editable || selectedSection?.kind !== "frontmatter"} onChange={(event) => { const file = event.target.files?.[0]; if (file) void insertIllustration(file); }}/></div>',
    "front matter illustration toolbar",
  );
  return text;
});

await patch("web/src/main.tsx", (text) => once(
  text,
  'import "./ui-polish.css";\n',
  'import "./ui-polish.css";\nimport "./v203-polish.css";\n',
  "v203 css import",
));

await patch("themes/base.css", (text) => once(
  text,
  'img {\n  max-width: 100%;\n  height: auto;\n}\n',
  'img {\n  max-width: 100%;\n  height: auto;\n}\n\nimg.folio-illustration,\n.folio-illustration img {\n  display: block;\n  width: auto;\n  max-width: 100%;\n  height: auto;\n  max-height: 76vh;\n  margin: 1.4em auto;\n  object-fit: contain;\n  break-inside: avoid;\n}\n',
  "published illustration styling",
));

console.log("Applied Folio 2.0.3 UI/front-matter/cover patch.");

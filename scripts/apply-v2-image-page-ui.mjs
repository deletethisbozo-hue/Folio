import { promises as fs } from "node:fs";

function patchFile(file, edits) {
  return fs.readFile(file, "utf8").then(async (original) => {
    let source = original;
    for (const [label, before, after] of edits) {
      const index = source.indexOf(before);
      if (index < 0) throw new Error(`${file}: patch anchor missing: ${label}`);
      if (source.indexOf(before, index + before.length) >= 0) throw new Error(`${file}: patch anchor not unique: ${label}`);
      source = source.slice(0, index) + after + source.slice(index + before.length);
    }
    await fs.writeFile(file, source, "utf8");
  });
}

await patchFile("server/api.ts", [
  [
    "image page API import",
    'import { normalizeThemeFontStack } from "./pipeline/theme-fonts.ts";',
    'import { normalizeThemeFontStack } from "./pipeline/theme-fonts.ts";\nimport { registerImagePageApi } from "./image-page-api.ts";',
  ],
  [
    "image page API registration",
    'export function registerApi(app: Express): void {\n  app.get("/theme-fonts/:file", (req, res) =>',
    'export function registerApi(app: Express): void {\n  registerImagePageApi(app);\n  app.get("/theme-fonts/:file", (req, res) =>',
  ],
]);

await patchFile("web/src/api.ts", [
  [
    "image page client method",
    '  updateCover: (projectId: string, file: File) => {\n    const fd = new FormData();\n    fd.append("cover", file, file.name);\n    return fetch(`/api/projects/${projectId}/cover`, { method: "POST", body: fd }).then((r) => json<ProjectSummary>(r));\n  },',
    '  updateCover: (projectId: string, file: File) => {\n    const fd = new FormData();\n    fd.append("cover", file, file.name);\n    return fetch(`/api/projects/${projectId}/cover`, { method: "POST", body: fd }).then((r) => json<ProjectSummary>(r));\n  },\n\n  addImagePage: (projectId: string, file: File, title: string, alt: string, fit: "contain" | "cover" = "contain") => {\n    const fd = new FormData();\n    fd.append("image", file, file.name);\n    fd.append("title", title);\n    fd.append("alt", alt);\n    fd.append("fit", fit);\n    return fetch(`/api/projects/${projectId}/image-page`, { method: "POST", body: fd })\n      .then((r) => json<{ ok: true; entry: string; asset: string }>(r));\n  },',
  ],
]);

await patchFile("web/src/App.tsx", [
  [
    "image page action",
    '  async function deleteCurrentSection() {',
    '  async function addImagePage(file: File) {\n    if (!project || !meta || !(await saveCurrent())) return;\n    const title = file.name.replace(/\\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Map";\n    const before = new Set(project.sections.map((section) => section.id));\n    setBusy(true); setError(null);\n    try {\n      await api.addImagePage(project.projectId, file, title, title, "contain");\n      const summary = await api.reload(project.projectId);\n      const created = summary.sections.find((section) => !before.has(section.id));\n      adopt(summary, created?.id);\n      setShowContent(false);\n    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }\n    finally { setBusy(false); }\n  }\n\n  async function deleteCurrentSection() {',
  ],
  [
    "content dialog call",
    '{showContent && <ContentDialog matterTypes={matterTypes} title={contentTitle} setTitle={setContentTitle} busy={busy} onAddChapter={() => void addChapter()} onAddMatter={(type) => void addMatterSection(type)} onClose={() => setShowContent(false)}/>}' ,
    '{showContent && <ContentDialog matterTypes={matterTypes} title={contentTitle} setTitle={setContentTitle} busy={busy} onAddChapter={() => void addChapter()} onAddMatter={(type) => void addMatterSection(type)} onAddImagePage={(file) => void addImagePage(file)} onClose={() => setShowContent(false)}/>}' ,
  ],
  [
    "content dialog component",
    'function ContentDialog(props: { matterTypes: MatterType[]; title: string; setTitle: (title: string) => void; busy: boolean; onAddChapter: () => void; onAddMatter: (type: MatterType) => void; onClose: () => void }) {\n  const front = props.matterTypes.filter((type) => type.placement === "frontmatter");\n  const back = props.matterTypes.filter((type) => type.placement === "backmatter");\n  const group = (label: string, items: MatterType[]) => <div className="content-kind-group"><h3>{label}</h3>{items.map((type) => <button key={type.key} disabled={props.busy} onClick={() => props.onAddMatter(type)}><span>{type.label}</span><small>Add editable page</small></button>)}</div>;\n  return <DialogShell title="Add Content" onClose={props.onClose} footer={<button className="native-button" onClick={props.onClose}>Close</button>}><div className="add-chapter-box"><h3>Chapter</h3><div><input autoFocus value={props.title} onChange={(e) => props.setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && props.title.trim()) props.onAddChapter(); }}/><button className="native-button primary" disabled={props.busy || !props.title.trim()} onClick={props.onAddChapter}>Add Chapter</button></div></div><div className="content-kind-columns">{group("Front Matter", front)}{group("Back Matter", back)}</div></DialogShell>;\n}',
    'function ContentDialog(props: { matterTypes: MatterType[]; title: string; setTitle: (title: string) => void; busy: boolean; onAddChapter: () => void; onAddMatter: (type: MatterType) => void; onAddImagePage: (file: File) => void; onClose: () => void }) {\n  const front = props.matterTypes.filter((type) => type.placement === "frontmatter");\n  const back = props.matterTypes.filter((type) => type.placement === "backmatter");\n  const group = (label: string, items: MatterType[], imagePage = false) => <div className="content-kind-group"><h3>{label}</h3>{imagePage && <label className="content-image-kind"><span>Full-page Image</span><small>Map, family tree or illustration</small><input type="file" accept="image/png,image/jpeg" disabled={props.busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onAddImagePage(file); event.currentTarget.value = ""; }}/></label>}{items.map((type) => <button key={type.key} disabled={props.busy} onClick={() => props.onAddMatter(type)}><span>{type.label}</span><small>Add editable page</small></button>)}</div>;\n  return <DialogShell title="Add Content" onClose={props.onClose} footer={<button className="native-button" onClick={props.onClose}>Close</button>}><div className="add-chapter-box"><h3>Chapter</h3><div><input autoFocus value={props.title} onChange={(e) => props.setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && props.title.trim()) props.onAddChapter(); }}/><button className="native-button primary" disabled={props.busy || !props.title.trim()} onClick={props.onAddChapter}>Add Chapter</button></div></div><div className="content-kind-columns">{group("Front Matter", front, true)}{group("Back Matter", back)}</div></DialogShell>;\n}',
  ],
]);

console.log("Applied Folio 2.0 full-page image API and UI patch.");

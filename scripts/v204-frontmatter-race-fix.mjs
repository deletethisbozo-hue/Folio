import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s);
function replaceOnce(path, from, to) {
  const source = read(path);
  if (!source.includes(from)) throw new Error(`Missing anchor in ${path}: ${from.slice(0, 160)}`);
  write(path, source.replace(from, to));
}

// Do not enable Image while React is still showing the previous section's editor.
// That race let uploads target a detached chapter DOM when the user had already
// selected newly-created front matter. It explains both the CI timeout and the
// real report that illustrations sometimes never appear.
replaceOnce(
  'web/src/App.tsx',
  'disabled={busy || !document?.editable || selectedSection?.kind !== "frontmatter"} onMouseDown={(e) => { e.preventDefault(); rememberIllustrationCaret(); }}',
  'disabled={busy || !document?.editable || document.id !== selectedSection?.id || selectedSection?.kind !== "frontmatter"} onMouseDown={(e) => { e.preventDefault(); rememberIllustrationCaret(); }}',
);
replaceOnce(
  'web/src/App.tsx',
  'disabled={busy || !document?.editable || selectedSection?.kind !== "frontmatter"} onChange={(event) => { const file = event.target.files?.[0]; if (file) void insertIllustration(file); }}',
  'disabled={busy || !document?.editable || document.id !== selectedSection?.id || selectedSection?.kind !== "frontmatter"} onChange={(event) => { const file = event.target.files?.[0]; if (file) void insertIllustration(file); }}',
);

replaceOnce(
  'web/src/App.tsx',
  '  async function insertIllustration(file: File) {\n    if (!project || !document?.editable || selectedSection?.kind !== "frontmatter") return;\n    const editor = editorRef.current;\n    if (!editor) return;\n    setBusy(true); setError(null);\n    try {\n      const uploaded = await api.uploadIllustration(project.projectId, file);',
  '  async function insertIllustration(file: File) {\n    if (!project || !document?.editable || document.id !== selectedSection?.id || selectedSection?.kind !== "frontmatter") return;\n    const targetSectionId = selectedSection.id;\n    if (!editorRef.current) return;\n    setBusy(true); setError(null);\n    try {\n      const uploaded = await api.uploadIllustration(project.projectId, file);\n      if (selectedRef.current !== targetSectionId) throw new Error("The illustration target changed while the image was uploading. Select the front-matter page and insert it again.");\n      const editor = editorRef.current;\n      if (!editor) throw new Error("The front-matter editor is still loading. Try inserting the illustration again.");',
);

console.log('Applied Folio 2.0.4 front-matter editor race fix.');

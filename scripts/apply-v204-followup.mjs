import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s);
function replaceOnce(path, from, to) {
  const source = read(path);
  if (!source.includes(from)) throw new Error(`Missing anchor in ${path}: ${from.slice(0, 120)}`);
  write(path, source.replace(from, to));
}

// Keep old/default illustration Markdown byte-compatible. Extra attributes only
// appear after the user actually scales/crops an illustration.
replaceOnce(
  'web/src/rich-text.ts',
  '  const attrs = [...classes, `width=${Math.round(spec.scale)}%`];',
  '  if (!spec.crop && Math.round(spec.scale) === 100) return "{.folio-illustration}";\n  const attrs = [...classes, `width=${Math.round(spec.scale)}%`];',
);

// Resolve preview assets from the project explicitly. Depending on the editor DOM
// as an implicit URL cache was the reason illustrations could exist in the editor
// but still disappear in the device iframe.
replaceOnce(
  'web/src/rich-text.ts',
  'export function markdownToPreviewHtml(markdown: string, ornament = "❦"): string {',
  'export function markdownToPreviewHtml(markdown: string, ornament = "❦", resolveAsset?: (asset: string) => string): string {',
);
replaceOnce(
  'web/src/rich-text.ts',
  '  return markdownToEditorHtml(reflowed, ornament, liveIllustrationSource)\n',
  '  return markdownToEditorHtml(reflowed, ornament, resolveAsset ?? liveIllustrationSource)\n',
);
replaceOnce(
  'web/src/App.tsx',
  '    template.innerHTML = markdownToPreviewHtml(liveDraft, ornament);',
  '    template.innerHTML = markdownToPreviewHtml(liveDraft, ornament, (asset) => project ? `/api/projects/${encodeURIComponent(project.projectId)}/asset?path=${encodeURIComponent(asset)}` : asset);',
);

console.log('Applied Folio 2.0.4 follow-up fixes.');

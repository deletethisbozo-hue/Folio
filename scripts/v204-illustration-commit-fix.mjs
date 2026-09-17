import fs from 'node:fs';

const path = 'web/src/App.tsx';
let source = fs.readFileSync(path, 'utf8');
const from = `      figure.after(spacer);\n      illustrationRangeRef.current = null;\n      recordEditorDom();`;
const to = `      figure.after(spacer);\n      illustrationRangeRef.current = null;\n\n      // Commit the illustration synchronously from the live front-matter DOM.\n      // The generic editor input queue is deliberately lazy for huge chapters;\n      // using it for an uploaded image created a window where React could swap\n      // sections before the figure reached the draft. Image insertion is a\n      // discrete publishing action, so make the Markdown authoritative now.\n      const nextMarkdown = richTextToMarkdown(editor.innerHTML);\n      editor.dataset.markdown = nextMarkdown;\n      editorDomDirtyRef.current = false;\n      editorDomGenerationRef.current++;\n      recordDraft(nextMarkdown);`;
if (!source.includes(from)) throw new Error('Missing illustration commit anchor in App.tsx');
source = source.replace(from, to);
fs.writeFileSync(path, source);
console.log('Applied synchronous 2.0.4 illustration commit fix.');

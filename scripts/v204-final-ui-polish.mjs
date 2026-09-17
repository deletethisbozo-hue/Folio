import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s);

// Illustration pages are image-only. Do not expose the source filename as a
// caption and do not retain prose around the inserted image.
let app = read('web/src/App.tsx');
const insertStart = app.indexOf('  async function insertIllustration(file: File) {');
const insertEnd = app.indexOf('  async function uploadCover(file: File) {', insertStart);
if (insertStart < 0 || insertEnd < 0) throw new Error('Cannot locate insertIllustration in App.tsx');
let insert = app.slice(insertStart, insertEnd);
insert = insert.replace(
  '      const alt = file.name.replace(/\\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Illustration";',
  '      const alt = "Illustration";',
);
// Handle both the original DOM and the crop/scale-transformed DOM. The latter
// can rearrange the append call before this finalizer runs.
insert = insert.replace(/\n\s*const caption = window\.document\.createElement\("figcaption"\);\n\s*caption\.textContent = alt;/g, '');
insert = insert.replace(/,\s*caption\s*,/g, ', ');
insert = insert.replace(/\bcaption\s*,\s*/g, '');
insert = insert.replace(/,\s*caption\b/g, '');
const insertionBlock = `      const savedRange = illustrationRangeRef.current;\n      if (savedRange && editor.contains(savedRange.commonAncestorContainer)) {\n        savedRange.deleteContents();\n        savedRange.insertNode(figure);\n      } else {\n        editor.appendChild(figure);\n      }\n      const spacer = window.document.createElement("p");\n      spacer.innerHTML = "<br>";\n      figure.after(spacer);`;
if (!insert.includes(insertionBlock)) throw new Error('Missing illustration insertion block in App.tsx');
insert = insert.replace(insertionBlock, '      editor.replaceChildren(figure);');
app = app.slice(0, insertStart) + insert + app.slice(insertEnd);
write('web/src/App.tsx', app);

// Existing manuscripts may still carry alt text for accessibility, but that alt
// text must not become visible typography. Remove generated figcaptions from the
// helper used by both editor hydration and Page Preview.
let rich = read('web/src/rich-text.ts');
rich = rich.replaceAll('<figcaption>${escapeHtml(alt)}</figcaption>', '');
write('web/src/rich-text.ts', rich);

// Focused regression checks: the real upload flow must not leak a source
// filename/caption into either the editor page or the device iframe.
for (const path of ['tests/illustration-ui.test.ts', 'tests/illustration-preview-ui.test.ts']) {
  let test = read(path);
  const marker = '  await page.waitForSelector(".editor-illustration img", { timeout: 12000 });';
  if (test.includes(marker) && !test.includes('filename/caption leaked')) {
    test = test.replace(marker, `${marker}\n  const leakedCaption = await page.evaluate(() => Boolean(document.querySelector('.editor-illustration figcaption')) || /illustration[-_ ]?fixture/i.test(document.querySelector('.rich-editor')?.textContent ?? ''));\n  if (leakedCaption) throw new Error('Illustration filename/caption leaked into the page');`);
  }
  if (path.endsWith('illustration-preview-ui.test.ts')) {
    const previewMarker = '  const previewImage = await waitForPreviewImage(page);';
    if (test.includes(previewMarker) && !test.includes('previewCaption')) {
      test = test.replace(previewMarker, `${previewMarker}\n  const previewCaption = await page.evaluate(() => {\n    const frame = document.querySelector('iframe.preview-frame');\n    const doc = frame?.contentDocument;\n    return Boolean(doc?.querySelector('figcaption')) || /illustration[-_ ]?fixture/i.test(doc?.body?.textContent ?? '');\n  });\n  if (previewCaption) throw new Error('Illustration caption leaked into Page Preview');`);
    }
  }
  write(path, test);
}

console.log('Applied final 2.0.4 UI typography and image-only illustration-page polish.');

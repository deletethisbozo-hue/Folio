import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s);
function replaceOnce(path, from, to) {
  const src = read(path);
  if (!src.includes(from)) throw new Error(`Missing anchor in ${path}: ${from.slice(0, 120)}`);
  write(path, src.replace(from, to));
}

// Keep one icon source for builder + BrowserWindow. electron-builder accepts PNG
// on Windows and this avoids pointing at a non-existent folio.ico.
const pkg = JSON.parse(read('package.json'));
pkg.build.files = (pkg.build.files ?? []).filter((item) => item !== 'assets/folio.ico');
pkg.build.win.icon = 'assets/folio-icon.png';
write('package.json', JSON.stringify(pkg, null, 2) + '\n');

let oldTest = read('tests/illustration-ui.test.ts');
oldTest = oldTest.replaceAll('includes("{.folio-illustration}")', 'includes("{.folio-illustration")');
oldTest = oldTest.replace(
  '/!\\[[^\\]]+\\]\\(assets\\/[a-z0-9._-]+\\.png\\)\\{\\.folio-illustration\\}/i',
  '/!\\[[^\\]]+\\]\\(assets\\/[a-z0-9._-]+\\.png\\)\\{\\.folio-illustration\\b[^}]*\\}/i',
);
write('tests/illustration-ui.test.ts', oldTest);

replaceOnce(
  'web/src/App.tsx',
  '      figure.setAttribute("data-folio-illustration", "true");\n      figure.contentEditable = "false";',
  '      figure.setAttribute("data-folio-illustration", "true");\n      figure.dataset.folioScale = "100";\n      figure.dataset.folioCrop = "false";\n      figure.dataset.folioRatio = "4-3";\n      figure.dataset.folioX = "50";\n      figure.dataset.folioY = "50";\n      figure.contentEditable = "false";',
);
replaceOnce(
  'web/src/App.tsx',
  '      figure.append(image, caption, remove);',
  '      const controls = window.document.createElement("div");\n      controls.className = "editor-illustration-controls";\n      controls.contentEditable = "false";\n      controls.innerHTML = `<label><span>Size</span><input data-folio-control="scale" type="range" min="25" max="100" step="5" value="100"></label><button type="button" data-folio-control="crop" aria-pressed="false">Crop</button><select data-folio-control="ratio" aria-label="Crop ratio" disabled><option value="1-1">1:1</option><option value="4-3" selected>4:3</option><option value="3-2">3:2</option><option value="2-3">2:3</option><option value="16-9">16:9</option></select><label class="crop-axis"><span>X</span><input data-folio-control="x" type="range" min="0" max="100" step="5" value="50" disabled></label><label class="crop-axis"><span>Y</span><input data-folio-control="y" type="range" min="0" max="100" step="5" value="50" disabled></label>`;\n      figure.append(image, caption, controls, remove);',
);

let rich = read('web/src/rich-text.ts');
const oldFigureTail = '<figcaption>${escapeHtml(alt)}</figcaption><button type="button" class="editor-illustration-remove" aria-label="Remove illustration" title="Remove illustration">×</button></figure>';
const controlsMarkup = '<figcaption>${escapeHtml(alt)}</figcaption><div class="editor-illustration-controls" contenteditable="false"><label><span>Size</span><input data-folio-control="scale" type="range" min="25" max="100" step="5" value="${spec.scale}"></label><button type="button" data-folio-control="crop" aria-pressed="${spec.crop}">${spec.crop ? "Crop on" : "Crop"}</button><select data-folio-control="ratio" aria-label="Crop ratio" ${spec.crop ? "" : "disabled"}><option value="1-1" ${spec.ratio === "1-1" ? "selected" : ""}>1:1</option><option value="4-3" ${spec.ratio === "4-3" ? "selected" : ""}>4:3</option><option value="3-2" ${spec.ratio === "3-2" ? "selected" : ""}>3:2</option><option value="2-3" ${spec.ratio === "2-3" ? "selected" : ""}>2:3</option><option value="16-9" ${spec.ratio === "16-9" ? "selected" : ""}>16:9</option></select><label class="crop-axis"><span>X</span><input data-folio-control="x" type="range" min="0" max="100" step="5" value="${spec.x}" ${spec.crop ? "" : "disabled"}></label><label class="crop-axis"><span>Y</span><input data-folio-control="y" type="range" min="0" max="100" step="5" value="${spec.y}" ${spec.crop ? "" : "disabled"}></label></div><button type="button" class="editor-illustration-remove" aria-label="Remove illustration" title="Remove illustration">×</button></figure>';
if (!rich.includes(oldFigureTail)) throw new Error('Could not find patched illustration figure renderer.');
rich = rich.replace(oldFigureTail, controlsMarkup);

const previewAnchor = '    .replace(/<button\\b[^>]*class="editor-illustration-remove"[^>]*>.*?<\\/button>/g, "")';
if (!rich.includes(previewAnchor)) throw new Error('Could not find illustration preview cleanup anchor.');
rich = rich.replace(previewAnchor, '    .replace(/<div\\b[^>]*class="editor-illustration-controls"[^>]*>[\\s\\S]*?<\\/div>/g, "")\n' + previewAnchor);
write('web/src/rich-text.ts', rich);

// Turn the two opaque timeouts into useful assertions. If an asset fails to
// load, CI prints its URL, HTTP status, editor Markdown and visible error text.
const oldWait = `  await page.waitForFunction(() => {\n    const figure = document.querySelector<HTMLElement>(".editor-illustration");\n    const image = figure?.querySelector<HTMLImageElement>("img[data-folio-asset]");\n    const remove = figure?.querySelector<HTMLButtonElement>(".editor-illustration-remove");\n    const markdown = (document.querySelector(".rich-editor") as HTMLElement | null)?.dataset.markdown ?? "";\n    return Boolean(image?.complete && image.naturalWidth > 0 && remove && image.dataset.folioAsset?.startsWith("assets/") && markdown.includes("{.folio-illustration"));\n  });`;
const oldDiag = `  await page.waitForSelector(".editor-illustration", { timeout: 8000 });\n  await new Promise((resolve) => setTimeout(resolve, 350));\n  const inserted = await page.evaluate(async () => {\n    const figure = document.querySelector<HTMLElement>(".editor-illustration");\n    const image = figure?.querySelector<HTMLImageElement>("img[data-folio-asset]");\n    const remove = figure?.querySelector<HTMLButtonElement>(".editor-illustration-remove");\n    const markdown = (document.querySelector(".rich-editor") as HTMLElement | null)?.dataset.markdown ?? "";\n    let status = 0; let body = "";\n    if (image?.src) { try { const response = await fetch(image.src); status = response.status; if (!response.ok) body = (await response.text()).slice(0, 240); } catch (error) { body = String(error); } }\n    return { ok: Boolean(image?.complete && image.naturalWidth > 0 && remove && image.dataset.folioAsset?.startsWith("assets/") && markdown.includes("{.folio-illustration")), src: image?.src ?? "", complete: image?.complete ?? false, naturalWidth: image?.naturalWidth ?? 0, asset: image?.dataset.folioAsset ?? "", hasRemove: Boolean(remove), markdown, status, body, error: document.querySelector(".global-error")?.textContent ?? "" };\n  });\n  if (!inserted.ok) throw new Error("illustration insert diagnostic: " + JSON.stringify(inserted));`;
if (!oldTest.includes(oldWait)) throw new Error('Could not find legacy illustration wait for diagnostics.');
oldTest = oldTest.replace(oldWait, oldDiag);
write('tests/illustration-ui.test.ts', oldTest);

let previewTest = read('tests/illustration-preview-ui.test.ts');
const previewWait = `  await page.waitForFunction(() => {\n    const figure = document.querySelector<HTMLElement>(".editor-illustration");\n    return Boolean(\n      figure?.querySelector(".editor-illustration-controls") &&\n      figure.querySelector<HTMLImageElement>("img[data-folio-asset]")?.naturalWidth\n    );\n  });`;
const previewDiag = `  await page.waitForSelector(".editor-illustration", { timeout: 8000 });\n  await new Promise((resolve) => setTimeout(resolve, 350));\n  const first = await page.evaluate(async () => {\n    const figure = document.querySelector<HTMLElement>(".editor-illustration");\n    const image = figure?.querySelector<HTMLImageElement>("img[data-folio-asset]");\n    let status = 0; let body = "";\n    if (image?.src) { try { const response = await fetch(image.src); status = response.status; if (!response.ok) body = (await response.text()).slice(0, 240); } catch (error) { body = String(error); } }\n    return { ok: Boolean(figure?.querySelector(".editor-illustration-controls") && image?.complete && image.naturalWidth > 0), controls: Boolean(figure?.querySelector(".editor-illustration-controls")), src: image?.src ?? "", complete: image?.complete ?? false, naturalWidth: image?.naturalWidth ?? 0, asset: image?.dataset.folioAsset ?? "", markdown: (document.querySelector(".rich-editor") as HTMLElement | null)?.dataset.markdown ?? "", status, body, error: document.querySelector(".global-error")?.textContent ?? "" };\n  });\n  if (!first.ok) throw new Error("illustration preview diagnostic: " + JSON.stringify(first));`;
if (!previewTest.includes(previewWait)) throw new Error('Could not find preview illustration wait for diagnostics.');
previewTest = previewTest.replace(previewWait, previewDiag);
write('tests/illustration-preview-ui.test.ts', previewTest);

console.log('Applied Folio 2.0.4 illustration follow-up.');

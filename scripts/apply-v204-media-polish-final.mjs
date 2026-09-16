import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (p) => fs.readFile(path.join(ROOT, p), "utf8");
const write = (p, v) => fs.writeFile(path.join(ROOT, p), v, "utf8");

function replaceOne(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing patch anchor: ${label}`);
  return text.replace(from, to);
}

async function patchJson() {
  const packagePath = "package.json";
  const pkg = JSON.parse(await read(packagePath));
  pkg.version = "2.0.4";
  pkg.build.files = Array.from(new Set([...(pkg.build.files ?? []), "assets/**/*"]));
  pkg.build.win = { ...(pkg.build.win ?? {}), icon: "assets/folio.ico" };
  pkg.build.nsis = {
    ...(pkg.build.nsis ?? {}),
    installerIcon: "assets/folio.ico",
    uninstallerIcon: "assets/folio.ico",
    installerHeaderIcon: "assets/folio.ico",
  };
  await write(packagePath, JSON.stringify(pkg, null, 2) + "\n");

  const lockPath = "package-lock.json";
  const lock = JSON.parse(await read(lockPath));
  lock.version = "2.0.4";
  if (lock.packages?.[""]) lock.packages[""].version = "2.0.4";
  await write(lockPath, JSON.stringify(lock, null, 2) + "\n");
}

async function patchStartScreen() {
  let text = await read("web/src/StartScreen.tsx");
  text = replaceOne(text, '<div className="start-version">2.0.3</div>', '<div className="start-version">2.0.4</div>', "start version");
  await write("web/src/StartScreen.tsx", text);
}

async function patchElectron() {
  let text = await read("electron/main.cjs");
  text = replaceOne(
    text,
    '  mainWindow = new BrowserWindow({\n    title: "Folio",',
    '  const windowIcon = path.join(appRoot, "assets", "folio-icon.png");\n  mainWindow = new BrowserWindow({\n    title: "Folio",\n    icon: fs.existsSync(windowIcon) ? windowIcon : undefined,',
    "BrowserWindow icon",
  );
  await write("electron/main.cjs", text);
}

async function patchRichText() {
  let text = await read("web/src/rich-text.ts");

  const helperAnchor = 'function renderNode(node: Node): string {';
  const helpers = `type IllustrationCrop = "none" | "1:1" | "4:3" | "3:2" | "2:3" | "16:9";\n\nconst illustrationCrops = new Set<IllustrationCrop>(["none", "1:1", "4:3", "3:2", "2:3", "16:9"]);\n\nfunction illustrationNumber(value: string | undefined, fallback: number, min: number, max: number): number {\n  const parsed = Number(value);\n  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;\n}\n\nfunction illustrationCrop(value: string | undefined): IllustrationCrop {\n  return illustrationCrops.has(value as IllustrationCrop) ? value as IllustrationCrop : "none";\n}\n\nfunction readImageAttribute(attrs: string, name: string): string | undefined {\n  const quoted = attrs.match(new RegExp(String.raw\`(?:^|\\s)\${name}="([^"]*)"\`, "i"));\n  if (quoted) return quoted[1];\n  const bare = attrs.match(new RegExp(String.raw\`(?:^|\\s)\${name}=([^\\s}]+)\`, "i"));\n  return bare?.[1];\n}\n\nfunction imageSettingsFromAttributes(attrs: string): { scale: number; crop: IllustrationCrop; x: number; y: number } {\n  return {\n    scale: illustrationNumber(readImageAttribute(attrs, "data-folio-scale"), 100, 25, 100),\n    crop: illustrationCrop(readImageAttribute(attrs, "data-folio-crop")),\n    x: illustrationNumber(readImageAttribute(attrs, "data-folio-x"), 50, 0, 100),\n    y: illustrationNumber(readImageAttribute(attrs, "data-folio-y"), 50, 0, 100),\n  };\n}\n\nfunction imageSettingsFromFigure(figure: Element): { scale: number; crop: IllustrationCrop; x: number; y: number } {\n  const el = figure as HTMLElement;\n  return {\n    scale: illustrationNumber(el.dataset.folioScale, 100, 25, 100),\n    crop: illustrationCrop(el.dataset.folioCrop),\n    x: illustrationNumber(el.dataset.folioX, 50, 0, 100),\n    y: illustrationNumber(el.dataset.folioY, 50, 0, 100),\n  };\n}\n\nfunction imageStyle(settings: { scale: number; crop: IllustrationCrop; x: number; y: number }): string {\n  const base = \`display:block;width:\${settings.scale}%;max-width:100%;margin:1.4em auto;\`;\n  if (settings.crop === "none") return base + "height:auto;object-fit:contain;";\n  const ratio = settings.crop.replace(":", "/");\n  return base + \`aspect-ratio:\${ratio};object-fit:cover;object-position:\${settings.x}% \${settings.y}%;\`;\n}\n\nfunction illustrationControlsHtml(settings: { scale: number; crop: IllustrationCrop; x: number; y: number }): string {\n  const crops: IllustrationCrop[] = ["none", "1:1", "4:3", "3:2", "2:3", "16:9"];\n  const options = crops.map((crop) => \`<option value="\${crop}"\${crop === settings.crop ? " selected" : ""}>\${crop === "none" ? "Original" : crop}</option>\`).join("");\n  return \`<div class="editor-illustration-controls" contenteditable="false"><label><span>Scale</span><input class="illustration-scale" type="range" min="25" max="100" step="1" value="\${settings.scale}"></label><label><span>Crop</span><select class="illustration-crop">\${options}</select></label><label class="illustration-position"><span>X</span><input class="illustration-x" type="range" min="0" max="100" step="1" value="\${settings.x}"></label><label class="illustration-position"><span>Y</span><input class="illustration-y" type="range" min="0" max="100" step="1" value="\${settings.y}"></label></div>\`;\n}\n\nfunction illustrationFigureHtml(alt: string, asset: string, src: string, settings: { scale: number; crop: IllustrationCrop; x: number; y: number }): string {\n  const cropStyle = settings.crop === "none"\n    ? ""\n    : \`aspect-ratio:\${settings.crop.replace(":", "/")};\`;\n  const imagePresentation = settings.crop === "none"\n    ? "width:auto;height:auto;max-width:100%;max-height:100%;object-fit:contain;"\n    : \`width:100%;height:100%;object-fit:cover;object-position:\${settings.x}% \${settings.y}%;\`;\n  return \`<figure class="editor-illustration" data-folio-illustration="true" data-folio-scale="\${settings.scale}" data-folio-crop="\${settings.crop}" data-folio-x="\${settings.x}" data-folio-y="\${settings.y}" style="width:\${settings.scale}%" contenteditable="false"><div class="editor-illustration-viewport" data-folio-crop="\${settings.crop}" style="\${cropStyle}"><img class="folio-illustration" src="\${escapeHtml(src)}" alt="\${escapeHtml(alt)}" data-folio-asset="\${escapeHtml(asset)}" style="\${imagePresentation}"></div><figcaption>\${escapeHtml(alt)}</figcaption>\${illustrationControlsHtml(settings)}<button type="button" class="editor-illustration-remove" aria-label="Remove illustration" title="Remove illustration">×</button></figure>\`;\n}\n\n` + helperAnchor;
  text = replaceOne(text, helperAnchor, helpers, "illustration helpers");

  const oldRender = `  if (element.hasAttribute("data-folio-illustration")) {\n    const image = element.querySelector<HTMLImageElement>("img[data-folio-asset]");\n    if (!image) return "";\n    const asset = image.dataset.folioAsset?.trim();\n    if (!asset) return "";\n    const alt = escapeMarkdownAlt(image.alt.trim() || "Illustration");\n    return \`\\n\\n![\${alt}](\${asset}){.folio-illustration}\\n\\n\`;\n  }`;
  const newRender = `  if (element.hasAttribute("data-folio-illustration")) {\n    const image = element.querySelector<HTMLImageElement>("img[data-folio-asset]");\n    if (!image) return "";\n    const asset = image.dataset.folioAsset?.trim();\n    if (!asset) return "";\n    const alt = escapeMarkdownAlt(image.alt.trim() || "Illustration");\n    const settings = imageSettingsFromFigure(element);\n    const style = imageStyle(settings);\n    return \`\\n\\n![\${alt}](\${asset}){.folio-illustration data-folio-scale="\${settings.scale}" data-folio-crop="\${settings.crop}" data-folio-x="\${settings.x}" data-folio-y="\${settings.y}" style="\${style}"}\\n\\n\`;\n  }`;
  text = replaceOne(text, oldRender, newRender, "serialize illustration settings");

  const oldImageBlock = `    const image = line.trim().match(/^!\\[([^\\]]*)\\]\\(([^)]+)\\)(?:\\{[^}]*\\})?$/);\n    if (image) {\n      flush();\n      const alt = image[1].trim() || "Illustration";\n      const asset = image[2].trim();\n      const src = resolveAsset ? resolveAsset(asset) : asset;\n      blocks.push(\`<figure class="editor-illustration" data-folio-illustration="true" contenteditable="false"><img src="\${escapeHtml(src)}" alt="\${escapeHtml(alt)}" data-folio-asset="\${escapeHtml(asset)}"><figcaption>\${escapeHtml(alt)}</figcaption><button type="button" class="editor-illustration-remove" aria-label="Remove illustration" title="Remove illustration">×</button></figure>\`);\n      continue;\n    }`;
  const newImageBlock = `    const image = line.trim().match(/^!\\[([^\\]]*)\\]\\(([^)]+)\\)(?:\\{([^}]*)\\})?$/);\n    if (image) {\n      flush();\n      const alt = image[1].trim() || "Illustration";\n      const asset = image[2].trim();\n      const src = resolveAsset ? resolveAsset(asset) : asset;\n      const settings = imageSettingsFromAttributes(image[3] ?? "");\n      blocks.push(illustrationFigureHtml(alt, asset, src, settings));\n      continue;\n    }`;
  text = replaceOne(text, oldImageBlock, newImageBlock, "rehydrate illustration settings");

  text = replaceOne(
    text,
    'export function markdownToPreviewHtml(markdown: string, ornament = "❦"): string {',
    'export function markdownToPreviewHtml(markdown: string, ornament = "❦", resolveAsset?: (asset: string) => string): string {',
    "preview resolver signature",
  );
  text = replaceOne(
    text,
    '  return markdownToEditorHtml(reflowed, ornament)\n    .replace(/<button\\b[^>]*class="editor-scene-break-remove"[^>]*>.*?<\\/button>/g, "")',
    '  return markdownToEditorHtml(reflowed, ornament, resolveAsset)\n    .replace(/<div\\b[^>]*class="editor-illustration-controls"[^>]*>[\\s\\S]*?<\\/div>/g, "")\n    .replace(/<button\\b[^>]*class="editor-illustration-remove"[^>]*>.*?<\\/button>/g, "")\n    .replace(/<button\\b[^>]*class="editor-scene-break-remove"[^>]*>.*?<\\/button>/g, "")',
    "preview strips editor controls",
  );

  await write("web/src/rich-text.ts", text);
}

async function patchApp() {
  let text = await read("web/src/App.tsx");

  const wordCount = `function wordCount(text: string): number {\n  return text.trim().match(/\\S+/g)?.length ?? 0;\n}`;
  const helpers = wordCount + `\n\nfunction illustrationInt(value: string | undefined, fallback: number, min: number, max: number): number {\n  const parsed = Number(value);\n  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;\n}\n\nfunction syncIllustrationPresentation(target: EventTarget | null): boolean {\n  if (!(target instanceof Element)) return false;\n  const figure = target.closest<HTMLElement>(".editor-illustration");\n  if (!figure) return false;\n  const scale = illustrationInt(figure.querySelector<HTMLInputElement>(".illustration-scale")?.value ?? figure.dataset.folioScale, 100, 25, 100);\n  const cropControl = figure.querySelector<HTMLSelectElement>(".illustration-crop");\n  const crop = cropControl?.value && ["none", "1:1", "4:3", "3:2", "2:3", "16:9"].includes(cropControl.value) ? cropControl.value : (figure.dataset.folioCrop || "none");\n  const x = illustrationInt(figure.querySelector<HTMLInputElement>(".illustration-x")?.value ?? figure.dataset.folioX, 50, 0, 100);\n  const y = illustrationInt(figure.querySelector<HTMLInputElement>(".illustration-y")?.value ?? figure.dataset.folioY, 50, 0, 100);\n  figure.dataset.folioScale = String(scale);\n  figure.dataset.folioCrop = crop;\n  figure.dataset.folioX = String(x);\n  figure.dataset.folioY = String(y);\n  figure.style.width = \`\${scale}%\`;\n  const viewport = figure.querySelector<HTMLElement>(".editor-illustration-viewport");\n  const image = figure.querySelector<HTMLImageElement>("img[data-folio-asset]");\n  if (viewport) {\n    viewport.dataset.folioCrop = crop;\n    viewport.style.aspectRatio = crop === "none" ? "auto" : crop.replace(":", " / ");\n  }\n  if (image) {\n    if (crop === "none") {\n      image.style.width = "auto"; image.style.height = "auto"; image.style.maxWidth = "100%"; image.style.maxHeight = "100%"; image.style.objectFit = "contain"; image.style.objectPosition = "50% 50%";\n    } else {\n      image.style.width = "100%"; image.style.height = "100%"; image.style.maxWidth = "none"; image.style.maxHeight = "none"; image.style.objectFit = "cover"; image.style.objectPosition = \`\${x}% \${y}%\`;\n    }\n  }\n  return true;\n}\n\nfunction illustrationControlsMarkup(): string {\n  return '<div class="editor-illustration-controls" contenteditable="false"><label><span>Scale</span><input class="illustration-scale" type="range" min="25" max="100" step="1" value="100"></label><label><span>Crop</span><select class="illustration-crop"><option value="none">Original</option><option value="1:1">1:1</option><option value="4:3">4:3</option><option value="3:2">3:2</option><option value="2:3">2:3</option><option value="16:9">16:9</option></select></label><label class="illustration-position"><span>X</span><input class="illustration-x" type="range" min="0" max="100" step="1" value="50"></label><label class="illustration-position"><span>Y</span><input class="illustration-y" type="range" min="0" max="100" step="1" value="50"></label></div>';\n}`;
  text = replaceOne(text, wordCount, helpers, "App illustration helpers");

  text = replaceOne(
    text,
    '      figure.contentEditable = "false";\n      const image = window.document.createElement("img");',
    '      figure.contentEditable = "false";\n      figure.dataset.folioScale = "100";\n      figure.dataset.folioCrop = "none";\n      figure.dataset.folioX = "50";\n      figure.dataset.folioY = "50";\n      figure.style.width = "100%";\n      const viewport = window.document.createElement("div");\n      viewport.className = "editor-illustration-viewport";\n      viewport.dataset.folioCrop = "none";\n      const image = window.document.createElement("img");',
    "new illustration defaults",
  );
  text = replaceOne(
    text,
    '      image.alt = alt;\n      image.dataset.folioAsset = uploaded.asset;',
    '      image.alt = alt;\n      image.className = "folio-illustration";\n      image.dataset.folioAsset = uploaded.asset;\n      viewport.appendChild(image);',
    "illustration viewport",
  );
  text = replaceOne(
    text,
    '      remove.textContent = "×";\n      figure.append(image, caption, remove);',
    '      remove.textContent = "×";\n      const controls = window.document.createElement("div");\n      controls.innerHTML = illustrationControlsMarkup();\n      const controlsPanel = controls.firstElementChild as HTMLElement;\n      figure.append(viewport, caption, controlsPanel, remove);',
    "illustration controls DOM",
  );

  text = replaceOne(
    text,
    '  function editorClick(event: React.MouseEvent<HTMLDivElement>) {',
    '  function editorInput(event: React.FormEvent<HTMLDivElement>) {\n    syncIllustrationPresentation(event.target);\n    recordEditorDom();\n  }\n\n  function editorClick(event: React.MouseEvent<HTMLDivElement>) {',
    "editor input handler",
  );

  text = replaceOne(
    text,
    '    template.innerHTML = markdownToPreviewHtml(liveDraft, ornament);',
    '    template.innerHTML = markdownToPreviewHtml(liveDraft, ornament, (asset) => project ? `/api/projects/${encodeURIComponent(project.projectId)}/asset?path=${encodeURIComponent(asset)}` : asset);',
    "live preview asset resolver",
  );

  text = replaceOne(
    text,
    'onPaste={editorPaste} onInput={recordEditorDom} onClick={editorClick}',
    'onPaste={editorPaste} onInput={editorInput} onChange={editorInput} onClick={editorClick}',
    "editor illustration events",
  );

  text = text.replaceAll('"Replace Cover…"', '"Replace cover"').replaceAll('"Add Cover…"', '"Add cover"').replaceAll('"Replace cover…"', '"Replace cover"').replaceAll('"Add cover…"', '"Add cover"');
  await write("web/src/App.tsx", text);
}

async function patchIllustrationTest() {
  let text = await read("tests/illustration-ui.test.ts");
  text = text.replaceAll('markdown.includes("{.folio-illustration}")', 'markdown.includes("{.folio-illustration")');
  text = text.replace('/!\\[[^\\]]+\\]\\(assets\\/[a-z0-9._-]+\\.png\\)\\{\\.folio-illustration\\}/i', '/!\\[[^\\]]+\\]\\(assets\\/[a-z0-9._-]+\\.png\\)\\{\\.folio-illustration\\b[^}]*\\}/i');

  const anchor = '  check("choosing a PNG inserts a visible illustration and semantic Markdown", true);';
  const addition = anchor + `\n\n  await page.waitForFunction(() => {\n    const frame = document.querySelector<HTMLIFrameElement>(".preview-frame");\n    const image = frame?.contentDocument?.querySelector<HTMLImageElement>("img.folio-illustration, .folio-illustration img");\n    return Boolean(image?.complete && image.naturalWidth > 0);\n  }, { timeout: 30000 });\n  check("front-matter illustration is visible in the live reader preview", true);\n\n  await page.$eval(".illustration-scale", (input) => {\n    (input as HTMLInputElement).value = "68";\n    input.dispatchEvent(new Event("input", { bubbles: true }));\n  });\n  await page.$eval(".illustration-crop", (select) => {\n    (select as HTMLSelectElement).value = "4:3";\n    select.dispatchEvent(new Event("change", { bubbles: true }));\n  });\n  await page.$eval(".illustration-x", (input) => {\n    (input as HTMLInputElement).value = "35";\n    input.dispatchEvent(new Event("input", { bubbles: true }));\n  });\n  await page.$eval(".illustration-y", (input) => {\n    (input as HTMLInputElement).value = "65";\n    input.dispatchEvent(new Event("input", { bubbles: true }));\n  });\n  await page.waitForFunction(() => {\n    const editor = document.querySelector<HTMLElement>(".rich-editor");\n    const figure = document.querySelector<HTMLElement>(".editor-illustration");\n    const markdown = editor?.dataset.markdown ?? "";\n    return figure?.dataset.folioScale === "68"\n      && figure.dataset.folioCrop === "4:3"\n      && figure.dataset.folioX === "35"\n      && figure.dataset.folioY === "65"\n      && markdown.includes('data-folio-scale="68"')\n      && markdown.includes('data-folio-crop="4:3"')\n      && markdown.includes('data-folio-x="35"')\n      && markdown.includes('data-folio-y="65"');\n  });\n  check("illustration scale, crop and focal position are serialized", true);`;
  text = replaceOne(text, anchor, addition, "illustration live-preview test");

  const reloadAnchor = '  check("saved front-matter illustration survives a real project reload", true);';
  const reloadAdd = `  const restoredSettings = await page.$eval(".editor-illustration", (figure) => ({\n    scale: (figure as HTMLElement).dataset.folioScale,\n    crop: (figure as HTMLElement).dataset.folioCrop,\n    x: (figure as HTMLElement).dataset.folioX,\n    y: (figure as HTMLElement).dataset.folioY,\n  }));\n  check("illustration crop and scale survive project reload", restoredSettings.scale === "68" && restoredSettings.crop === "4:3" && restoredSettings.x === "35" && restoredSettings.y === "65", JSON.stringify(restoredSettings));\n\n  await page.waitForFunction(() => {\n    const frame = document.querySelector<HTMLIFrameElement>(".preview-frame");\n    const image = frame?.contentDocument?.querySelector<HTMLImageElement>("img.folio-illustration, .folio-illustration img");\n    return Boolean(image?.complete && image.naturalWidth > 0 && image.style.width.includes("68"));\n  }, { timeout: 30000 });\n  check("restored illustration is still visible and scaled in preview", true);\n\n` + reloadAnchor;
  text = replaceOne(text, reloadAnchor, reloadAdd, "illustration reload settings test");
  await write("tests/illustration-ui.test.ts", text);
}

async function patchCss() {
  const css = `/* Folio 2.0.4: media editing and publishing-control polish. */\n\n.folio-shell[data-ui-tone] .generate-button {\n  height: 34px !important;\n  min-width: 94px !important;\n  padding: 0 13px !important;\n  border: 1px solid var(--studio-rule-strong) !important;\n  border-radius: 5px !important;\n  background: var(--studio-surface) !important;\n  color: var(--studio-ink) !important;\n  box-shadow: 0 1px 0 color-mix(in srgb, var(--studio-surface) 75%, transparent), 0 1px 3px rgba(28,24,20,.08) !important;\n  font: 700 12.5px/1 Georgia, "Times New Roman", serif !important;\n  letter-spacing: -.015em;\n}\n\n.folio-shell[data-ui-tone] .generate-button::after {\n  margin-left: 3px;\n  color: var(--studio-muted);\n  font: 600 11px/1 "Segoe UI", sans-serif;\n}\n\n.folio-shell[data-ui-tone] .generate-button:hover,\n.folio-shell[data-ui-tone] .generate-wrap:has(.generate-menu) .generate-button {\n  border-color: var(--studio-ink) !important;\n  background: color-mix(in srgb, var(--studio-surface) 88%, var(--studio-accent-soft)) !important;\n}\n\n.folio-shell[data-ui-tone] .cover-upload-button,\n.folio-shell[data-ui-tone] .cover-button {\n  min-height: 35px !important;\n  padding: 0 15px !important;\n  border: 1px solid var(--studio-rule-strong) !important;\n  border-radius: 5px !important;\n  background: var(--studio-surface) !important;\n  color: var(--studio-ink) !important;\n  box-shadow: 0 1px 3px rgba(28,24,20,.07) !important;\n  font: 700 12px/1 Georgia, "Times New Roman", serif !important;\n  letter-spacing: -.01em;\n}\n\n.folio-shell[data-ui-tone] .cover-upload-button:hover,\n.folio-shell[data-ui-tone] .cover-button:hover {\n  border-color: var(--studio-ink) !important;\n  background: color-mix(in srgb, var(--studio-surface) 88%, var(--studio-accent-soft)) !important;\n}\n\n/* A cover is artwork, not scrolling prose. Give every preview family exactly\n * the same full-surface contain fit with no family-dependent inset. */\n.folio-shell[data-ui-tone] .reader-screen > .cover-preview-surface {\n  inset: 0 !important;\n  padding: 0 !important;\n  background: #f4f0e8 !important;\n}\n\n.folio-shell[data-ui-tone] .cover-preview-surface img {\n  display: block !important;\n  width: 100% !important;\n  height: 100% !important;\n  max-width: 100% !important;\n  max-height: 100% !important;\n  object-fit: contain !important;\n  object-position: center center !important;\n  margin: 0 !important;\n  background: transparent !important;\n  box-shadow: none !important;\n}\n\n.folio-shell[data-ui-tone] .editor-illustration {\n  max-width: 100% !important;\n  min-width: 25%;\n  box-sizing: border-box;\n  transition: width 90ms ease;\n}\n\n.folio-shell[data-ui-tone] .editor-illustration-viewport {\n  width: 100%;\n  min-height: 40px;\n  display: grid;\n  place-items: center;\n  overflow: hidden;\n  border-radius: 2px;\n  background: color-mix(in srgb, var(--studio-paper) 90%, var(--studio-editor-canvas));\n}\n\n.folio-shell[data-ui-tone] .editor-illustration-viewport img {\n  display: block;\n  margin: 0 auto;\n}\n\n.folio-shell[data-ui-tone] .editor-illustration-controls {\n  margin-top: 10px;\n  padding-top: 10px;\n  display: grid;\n  grid-template-columns: minmax(125px, 1.25fr) minmax(92px, .75fr) minmax(90px, 1fr) minmax(90px, 1fr);\n  gap: 10px;\n  border-top: 1px solid var(--studio-rule);\n  text-align: left;\n}\n\n.folio-shell[data-ui-tone] .editor-illustration-controls label {\n  min-width: 0;\n  display: grid;\n  grid-template-columns: auto minmax(0, 1fr);\n  align-items: center;\n  gap: 6px;\n  color: var(--studio-muted);\n  font: 10px/1 "Segoe UI", sans-serif;\n}\n\n.folio-shell[data-ui-tone] .editor-illustration-controls select {\n  min-width: 0;\n  height: 25px;\n  border: 1px solid var(--studio-rule-strong);\n  border-radius: 3px;\n  background: var(--studio-surface);\n  color: var(--studio-ink);\n  font-size: 10px;\n}\n\n.folio-shell[data-ui-tone] .editor-illustration-controls input[type="range"] {\n  min-width: 0;\n  width: 100%;\n}\n\n@media (max-width: 1220px) {\n  .folio-shell[data-ui-tone] .editor-illustration-controls {\n    grid-template-columns: 1fr 1fr;\n  }\n}\n`;
  await write("web/src/v204-polish.css", css);
  let main = await read("web/src/main.tsx");
  if (!main.includes('import "./v204-polish.css";')) {
    main = replaceOne(main, 'import "./v203-polish.css";', 'import "./v203-polish.css";\nimport "./v204-polish.css";', "v204 css import");
  }
  await write("web/src/main.tsx", main);
}

async function patchReleaseWorkflow() {
  const p = ".github/workflows/windows-release.yml";
  let text = await read(p);
  text = text.replaceAll("2.0.3", "2.0.4");
  text = text.replace(
    "Folio 2.0.4 is a visual and front-matter quality release. The studio has a stronger hierarchy and a clearly branded Folio wordmark, cover controls are cleaned up, and cover artwork is shown with the same complete contain-fit treatment across every preview profile. Editable front matter can now insert, persist, reload and remove PNG/JPEG illustrations as real book assets instead of dropping images during rich-text conversion.",
    "Folio 2.0.4 fixes the remaining media-preview regressions from 2.0.3. Front-matter illustrations now resolve in the live reader, persist scale/crop/focal-position controls, and survive reload with the same presentation. Cover artwork uses one full-surface contain fit across every device preview, Export and cover replacement controls are visually normalized, and Windows packaging uses Folio's explicit app icon assets.",
  );
  await write(p, text);
}

async function patchSmokeVersion() {
  const p = "scripts/packaged-ui-smoke.mjs";
  let text = await read(p);
  text = text.replaceAll("Folio 2.0.3", "Folio 2.0.4");
  await write(p, text);
}

await patchJson();
await patchStartScreen();
await patchElectron();
await patchRichText();
await patchApp();
await patchIllustrationTest();
await patchCss();
await patchReleaseWorkflow();
await patchSmokeVersion();

// Qualification-only files remove themselves so the branch contains only product changes.
await fs.rm(path.join(ROOT, "scripts", "apply-v204-media-polish-final.mjs"), { force: true });
await fs.rm(path.join(ROOT, ".github", "workflows", "qualify-v204-media-polish.yml"), { force: true });

console.log("Folio 2.0.4 media-polish patch applied.");

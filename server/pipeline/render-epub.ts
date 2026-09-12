import path from "node:path";
import { promises as fs } from "node:fs";
import type { Book, PresetName } from "./types.ts";
import { assembleMarkdown } from "./build-doc.ts";
import { THEMES_DIR } from "./paths.ts";
import { cleanup, commonArgs, makeWorkspace, runPandoc } from "./pandoc.ts";
import { buildDocCss, epubFontFiles } from "./doc-css.ts";
import { buildThemeRuntimeCss } from "./theme-fonts.ts";
import { getPreset } from "../presets.ts";
import { readEpubEntries, writeEpub, reorderSpineToc } from "./epub-zip.ts";

export interface EpubResult {
  buffer: Buffer;
  bytes: number;
  preset: PresetName;
}

async function reorderToc(buffer: Buffer, book: Book): Promise<Buffer> {
  const sections = book.sections;
  const isCopyright = (s: (typeof sections)[number]) =>
    s.kind === "copyright" || s.className === "copyright" || /^copyright$/i.test(s.title.trim());
  const copyrightIdx = sections.findIndex(isCopyright);
  let leadingFront: number;
  if (copyrightIdx >= 0) {
    leadingFront = copyrightIdx + 1;
  } else {
    const tpIdx = sections.findIndex((s) => s.kind === "titlepage");
    leadingFront = tpIdx >= 0 ? tpIdx + 1 : 0;
  }
  try {
    const entries = await readEpubEntries(buffer);
    const opfEntry = entries.find((e) => e.name.endsWith(".opf"));
    if (!opfEntry) return buffer;
    const opf = Buffer.from(opfEntry.data).toString("utf8");
    const reordered = reorderSpineToc(opf, leadingFront);
    if (reordered === opf) return buffer;
    opfEntry.data = Buffer.from(reordered, "utf8");
    return Buffer.from(writeEpub(entries));
  } catch {
    return buffer;
  }
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function writeEpubMetadata(book: Book, dir: string): Promise<string | null> {
  const m = book.meta;
  const rights = m.rights || (m.copyright ? m.copyright.split("\n")[0].trim() : "");
  if (!rights) return null;
  const p = path.join(dir, "epub-metadata.xml");
  await fs.writeFile(p, `<dc:rights>${xmlEscape(rights)}</dc:rights>\n`, "utf8");
  return p;
}

/** Render an EPUB 3 file as a Buffer, applying the chosen distribution preset. */
export async function renderEpub(book: Book, presetName: PresetName): Promise<EpubResult> {
  const preset = getPreset(presetName);
  const ws = await makeWorkspace(book, "epub");
  const outPath = path.join(ws.dir, "book.epub");
  try {
    const md = assembleMarkdown(book, "epub");
    const runtimeTheme = await buildThemeRuntimeCss(book.meta.theme, "epub");
    const runtimeThemePath = path.join(ws.dir, "theme-runtime.css");
    await fs.writeFile(runtimeThemePath, runtimeTheme.css, "utf8");
    const cssFiles = [path.join(THEMES_DIR, "base.css"), runtimeThemePath];

    // Custom fonts + per-class style overrides.
    const docCss = await buildDocCss(book, "epub", { embedFonts: preset.embedFonts });
    if (docCss.trim()) {
      const docCssPath = path.join(ws.dir, "doc.css");
      await fs.writeFile(docCssPath, docCss, "utf8");
      cssFiles.push(docCssPath);
    }
    const args = [
      ...commonArgs(book, ws.metaPath),
      "--to=epub3",
      "--epub-title-page=false",
      "--toc",
      "--toc-depth=1",
      "--split-level=1",
      ...cssFiles.map((c) => `--css=${c}`),
      "-o",
      outPath,
    ];
    const epubMetaPath = await writeEpubMetadata(book, ws.dir);
    if (epubMetaPath) args.push(`--epub-metadata=${epubMetaPath}`);
    if (book.coverPath) args.push(`--epub-cover-image=${book.coverPath}`);

    // Built-in theme fonts are part of the selected design, so they are always
    // embedded. Otherwise a Decorative EPUB could silently become Georgia on a
    // reader that lacks desktop fonts. User-added custom fonts still respect the
    // distribution preset's embedFonts setting.
    for (const file of runtimeTheme.fontFiles) args.push(`--epub-embed-font=${file}`);
    if (preset.embedFonts) {
      for (const f of epubFontFiles(book)) args.push(`--epub-embed-font=${f}`);
    }

    await runPandoc(args, md);
    let buffer: Buffer = await fs.readFile(outPath);
    buffer = await reorderToc(buffer, book);
    return { buffer, bytes: buffer.length, preset: presetName };
  } finally {
    await cleanup(ws);
  }
}

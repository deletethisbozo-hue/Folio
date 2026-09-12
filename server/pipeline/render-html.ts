import type { Book } from "./types.ts";
import { assembleMarkdown, type Target } from "./build-doc.ts";
import { printCss, THEMES_DIR } from "./paths.ts";
import { BOOK_TEMPLATE, cleanup, commonArgs, makeWorkspace, runPandoc } from "./pandoc.ts";
import { buildDocCss } from "./doc-css.ts";
import { buildThemeRuntimeCss } from "./theme-fonts.ts";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Render the book's interior to a single self-contained HTML string.
 * Used for the live preview (shown in an iframe) and as the source for the PDF.
 * Live preview fonts come from Folio's local font endpoint so they are cached;
 * print HTML inlines the same files because Puppeteer renders from setContent().
 */
export async function renderHtml(book: Book, target: Target = "html"): Promise<string> {
  const ws = await makeWorkspace(book, target);
  try {
    const md = assembleMarkdown(book, target);
    const runtimeTheme = await buildThemeRuntimeCss(book.meta.theme, target === "print" ? "print" : "html");
    const runtimeThemePath = path.join(ws.dir, "theme-runtime.css");
    await fs.writeFile(runtimeThemePath, runtimeTheme.css, "utf8");
    const css = [path.join(THEMES_DIR, "base.css"), runtimeThemePath];
    if (target === "print" && (await fileExists(printCss(book.meta.theme)))) {
      css.push(printCss(book.meta.theme));
    }
    // Custom fonts + per-class style overrides (loaded last, so they win).
    const docCss = await buildDocCss(book, "html");
    if (docCss.trim()) {
      const docCssPath = path.join(ws.dir, "doc.css");
      await fs.writeFile(docCssPath, docCss, "utf8");
      css.push(docCssPath);
    }
    const args = [
      ...commonArgs(book, ws.metaPath),
      "--to=html5",
      "--standalone",
      "--embed-resources",
      "--section-divs",
      `--template=${BOOK_TEMPLATE}`,
      `--metadata=lang:${book.meta.language}`,
      ...css.map((c) => `--css=${c}`),
    ];
    return await runPandoc(args, md);
  } finally {
    await cleanup(ws);
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

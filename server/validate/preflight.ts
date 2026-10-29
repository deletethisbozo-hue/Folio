import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Book } from "../pipeline/types.ts";
import { assembleMarkdown } from "../pipeline/build-doc.ts";
import { PANDOC } from "../pipeline/pandoc.ts";
import { run } from "../pipeline/exec.ts";
import { buildThemeRuntimeCss } from "../pipeline/theme-fonts.ts";
import { TRIMS, LAYOUTS, type PrintOptions } from "../print.ts";

export interface PreflightIssue {
  code: string;
  severity: "error" | "warning";
  text: string;
  remedy: string;
  sectionId?: string;
  asset?: string;
}
export interface PreflightReport { ready: boolean; issues: PreflightIssue[]; }
export interface PreflightOptions { format: string; print?: PrintOptions; preset?: string; }

/** Explicit publishing boundary only. Pandoc resolves Markdown references/code semantics. */
export async function publishPreflight(book: Book, options: PreflightOptions): Promise<PreflightReport> {
  const issues: PreflightIssue[] = [];
  const add = (issue: PreflightIssue) => issues.push(issue);
  for (const field of ["title", "author", "language"] as const) {
    if (!book.meta[field]?.trim()) add({ code: "META_MISSING", severity: field === "title" ? "error" : "warning", text: `Book ${field} is missing.`, remedy: `Set ${field} in Book Details.` });
  }
  if (options.format === "epub" && !book.coverPath) add({ code: "COVER_MISSING", severity: "warning", text: "The EPUB has no cover.", remedy: "Add the finished front cover in Book Details." });
  for (const section of book.sections) {
    if (section.kind === "chapter" && !section.markdown.trim()) add({ code: "CHAPTER_EMPTY", severity: "warning", sectionId: section.id, text: `${section.title} is empty.`, remedy: "Add the chapter text or remove the unused chapter." });
  }
  if (options.format === "print" && options.print) {
    const print = options.print;
    if (print.bleedMm !== undefined && (!Number.isFinite(print.bleedMm) || print.bleedMm < 0 || print.bleedMm > 6)) add({ code: "PRINT_BLEED", severity: "error", text: "Bleed must be from 0 to 6 mm.", remedy: "Select a supported bleed value in Header & Footer settings." });
    if (print.spreadMode && !["single", "facing", "booklet"].includes(print.spreadMode)) add({ code: "PRINT_SPREAD", severity: "error", text: "The page arrangement is unavailable.", remedy: "Choose Single pages, Facing pages or Booklet sheets." });
    if (print.spreadMode === "booklet" && print.signaturePages !== undefined && (!Number.isInteger(print.signaturePages) || print.signaturePages < 4 || print.signaturePages > 64 || print.signaturePages % 4)) add({ code: "PRINT_SIGNATURE", severity: "error", text: "Booklet signatures must contain a multiple of four pages, from 4 to 64.", remedy: "Use the default 16-page signature." });
    if (!TRIMS.some((trim) => trim.key === print.trim)) add({ code: "PRINT_TRIM", severity: "error", text: "The selected paper profile is unavailable.", remedy: "Choose a supported paper profile in Print Preview." });
    if (!LAYOUTS.some((layout) => layout.key === print.layout)) add({ code: "PRINT_LAYOUT", severity: "error", text: "The running-head layout is unavailable.", remedy: "Choose a running-head layout in Print Preview." });
    if (print.gutter !== undefined && (!Number.isFinite(print.gutter) || print.gutter < 0.25 || print.gutter > 2)) add({ code: "PRINT_GUTTER", severity: "error", text: "The inner margin is outside the supported range.", remedy: "Use an inner margin from 0.25 to 2 inches, or select Auto." });
  }
  const runtimeFonts = await buildThemeRuntimeCss(book.meta.theme, "epub", [book.typography.bodyFont, book.typography.headingFont, book.typography.dropcapFont, book.typography.titlePageFont].filter((value): value is string => Boolean(value)));
  const fonts = [...book.fonts, ...runtimeFonts.fontFiles.map((file) => ({ file, family: path.basename(file) }))];
  for (const font of fonts) {
    try { if (!(await fs.stat(font.file)).isFile()) throw new Error(); }
    catch { add({ code: "FONT_MISSING", severity: "error", asset: font.file, text: `The font ${font.family} is missing.`, remedy: "Install this font again or choose an available family." }); }
  }

  const result = await run(PANDOC, ["--from=markdown", "--to=json"], { input: assembleMarkdown(book, "epub"), timeoutMs: 30_000, maxOutputBytes: 64 * 1024 * 1024 });
  if (result.code !== 0) throw new Error(`Publish Preflight could not parse the manuscript: ${result.stderr.slice(-2000)}`);
  const ast = JSON.parse(result.stdout) as { blocks: unknown[] };
  const ids = new Set<string>();
  const references: Array<{ target: string; image: boolean; sectionId?: string }> = [];
  let sectionId: string | undefined;
  const sectionIds = new Set(book.sections.map((section) => section.id));
  const readAttr = (value: unknown) => {
    if (Array.isArray(value) && typeof value[0] === "string" && value[0]) ids.add(value[0]);
  };
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== "object") return;
    const node = value as { t?: string; c?: unknown };
    const content = Array.isArray(node.c) ? node.c : [];
    if (node.t === "Header") readAttr(content[1]);
    if (["Div", "Span", "CodeBlock", "Code", "Image", "Link"].includes(node.t ?? "")) readAttr(content[0]);
    if ((node.t === "Image" || node.t === "Link") && Array.isArray(content[2]) && typeof content[2][0] === "string") references.push({ target: content[2][0], image: node.t === "Image", sectionId });
    if ((node.t === "RawBlock" || node.t === "RawInline") && content[0] === "html" && typeof content[1] === "string") {
      // Raw HTML remains raw in the AST. Inspect its explicit resource/anchor attributes.
      for (const match of content[1].matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)) ids.add(match[1]);
      for (const match of content[1].matchAll(/<(img|a)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) references.push({ target: match[2], image: match[1].toLowerCase() === "img", sectionId });
    }
    walk(node.c);
  };
  for (const block of ast.blocks) {
    const node = block as { t?: string; c?: unknown[] };
    if (node.t === "Header" && node.c?.[0] === 1 && Array.isArray(node.c[1]) && sectionIds.has(String(node.c[1][0]))) sectionId = String(node.c[1][0]);
    walk(block);
  }
  const seen = new Set<string>();
  for (const reference of references) {
    const { target, image, sectionId } = reference;
    const key = `${sectionId}\0${image}\0${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!image && target.startsWith("#")) {
      let anchor = target.slice(1);
      try { anchor = decodeURIComponent(anchor); } catch { /* report the original invalid anchor */ }
      if (anchor && !ids.has(anchor)) add({ code: "LINK_BROKEN", severity: "error", asset: target, sectionId, text: `Internal link ${target} has no destination.`, remedy: "Correct the heading/section anchor or remove this link." });
      continue;
    }
    if (!image || /^data:/i.test(target)) continue;
    if (/^https?:\/\//i.test(target)) { add({ code: "ASSET_REMOTE", severity: "warning", asset: target, sectionId, text: "An illustration uses an online resource.", remedy: "Import the image into the project for reliable offline publishing." }); continue; }
    try {
      const local = /^file:/i.test(target) ? fileURLToPath(target) : path.resolve(book.baseDir, decodeURIComponent(target.split(/[?#]/)[0]));
      if (!(await fs.stat(local)).isFile()) throw new Error();
    } catch { add({ code: "ASSET_MISSING", severity: "error", asset: target, sectionId, text: `Illustration ${target} is missing or unreadable.`, remedy: "Replace the illustration with a file stored in this project, or remove its reference." }); }
  }
  return { ready: !issues.some((issue) => issue.severity === "error"), issues };
}

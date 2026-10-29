import { promises as fs } from "node:fs";
import type { Book } from "./types.ts";
import { bookFontFamilies, buildDocCss } from "./doc-css.ts";
import { buildThemeRuntimeCss } from "./theme-fonts.ts";

export interface TypographyQaCheck {
  target: "Preview" | "PDF / PDF/X" | "EPUB";
  status: "pass" | "warning" | "error";
  details: string[];
}

export async function runThemeTypographyQa(book: Book): Promise<{ checks: TypographyQaCheck[] }> {
  const selected = bookFontFamilies(book);
  const [previewFonts, printFonts, epubFonts, previewDoc, epubDoc] = await Promise.all([
    buildThemeRuntimeCss(book.meta.theme, "html", selected),
    buildThemeRuntimeCss(book.meta.theme, "print", selected),
    buildThemeRuntimeCss(book.meta.theme, "epub", selected),
    buildDocCss(book, "html"),
    buildDocCss(book, "epub"),
  ]);
  const available = new Set(previewFonts.families);
  const unavailable = selected.filter((family) => !available.has(family));
  const hasFaces = (faces: string, families: readonly string[], source: string) =>
    families.every((family) => faces.includes(`font-family:${JSON.stringify(family)};`) && faces.includes(source));
  const packagedFamilies = selected.filter((family) => available.has(family));
  const previewFacesExist = hasFaces(previewFonts.fontCss, packagedFamilies, "url(");
  const printFacesExist = hasFaces(printFonts.fontCss, packagedFamilies, "data:font/");
  const epubFacesExist = hasFaces(epubFonts.fontCss, packagedFamilies, "../fonts/");
  const docStylesMatch = previewDoc.replace(/url\('[^']+'\)/g, "url('<font>')") === epubDoc.replace(/url\('[^']+'\)/g, "url('<font>')");
  const epubFilesExist = (await Promise.all(epubFonts.fontFiles.map(async (file) => {
    try { await fs.access(file); return true; } catch { return false; }
  }))).every(Boolean);
  const checks: TypographyQaCheck[] = [
    {
      target: "Preview",
      status: !previewFacesExist ? "error" : unavailable.length ? "warning" : "pass",
      details: unavailable.length
        ? [`Folio cannot package ${unavailable.join(", ")}; preview may use a locally installed fallback.`]
        : [previewFacesExist ? "Selected typefaces resolve to available preview font assets." : "A selected typeface has no usable preview font face."],
    },
    {
      target: "PDF / PDF/X",
      status: !printFacesExist || !docStylesMatch ? "error" : unavailable.length ? "warning" : "pass",
      details: [
        unavailable.length
          ? `These families may not be portable in print: ${unavailable.join(", ")}.`
          : printFacesExist ? "Selected Folio fonts are provided as embedded print font data." : "A selected typeface has no embedded print font face.",
        docStylesMatch
          ? "Theme typography declarations match the EPUB stylesheet."
          : "Print and EPUB typography declarations differ; correct the target-specific styles before publishing.",
      ],
    },
    {
      target: "EPUB",
      status: !epubFacesExist || !epubFilesExist ? "error" : unavailable.length ? "warning" : "pass",
      details: [
        unavailable.length
          ? `These families are not in the portable library: ${unavailable.join(", ")}.`
          : epubFacesExist ? "Selected Folio font files are scheduled for EPUB embedding." : "A selected typeface has no EPUB font face.",
        epubFilesExist
          ? `${epubFonts.fontFiles.length} selected font asset(s) are available for embedding in EPUB exports.`
          : "One or more selected font files are missing; fix this before publishing.",
      ],
    },
  ];
  return { checks };
}

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Book, StyleDef } from "./types.ts";

function fontFormat(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case ".otf":
      return "opentype";
    case ".woff2":
      return "woff2";
    case ".woff":
      return "woff";
    default:
      return "truetype";
  }
}

function fontMime(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case ".otf":
      return "font/otf";
    case ".woff2":
      return "font/woff2";
    case ".woff":
      return "font/woff";
    default:
      return "font/ttf";
  }
}

function familyValue(f: string): string {
  if (f.includes(",")) return f; // already a stack
  return /\s/.test(f) ? `"${f}"` : f; // quote single names with spaces
}

function styleDecls(s: StyleDef): string {
  const d: string[] = [];
  if (s.font) d.push(`font-family: ${familyValue(s.font)} !important;`);
  if (s.size) d.push(`font-size: ${s.size} !important;`);
  if (s.color) d.push(`color: ${s.color};`);
  if (s.align) d.push(`text-align: ${s.align};`);
  return d.join(" ");
}

function safeClass(c: string): string {
  return c.replace(/[^a-zA-Z0-9_-]/g, "");
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function safeColor(value: unknown, fallback: string): string {
  const v = typeof value === "string" ? value.trim() : "";
  return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?(?:[0-9a-f]{2})?$/i.test(v) ? v : fallback;
}

function safeFontFamily(value: unknown, fallback: string): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v || v.length > 180 || /[{};<>\r\n]/.test(v)) return familyValue(fallback);
  return familyValue(v);
}

function safeDataImage(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 32 || value.length > 18_000_000) return null;
  const match = value.match(/^data:image\/(png|jpeg|webp|svg\+xml);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) return null;
  if (match[1].toLowerCase() === "svg+xml") {
    try {
      const svg = Buffer.from(match[2], "base64").toString("utf8");
      if (/<(?:script|foreignObject|iframe|object|embed)\b/i.test(svg)) return null;
      if (/\son[a-z]+\s*=/i.test(svg) || /\b(?:https?:|file:|javascript:)/i.test(svg)) return null;
    } catch {
      return null;
    }
  }
  return value;
}

function safeLabel(value: unknown, fallback: string): string {
  const v = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  return (v || fallback).slice(0, 48);
}

/** Theme Lab is intentionally expressed as per-book CSS, so its output travels
 * with .folio projects and remains identical in preview, EPUB and print. */
function themeLabCss(book: Book): string {
  const lab = book.typography?.themeLab;
  if (!lab?.enabled) return "";

  const out: string[] = [];
  const paper = safeColor(lab.paper, "#fbfaf6");
  const ink = safeColor(lab.ink, "#242527");
  const accent = safeColor(lab.accent, "#856744");
  const headingColor = safeColor(lab.headingColor, ink);
  const labelColor = safeColor(lab.labelColor, accent);
  const subtitleColor = safeColor(lab.subtitleColor, ink);
  const sceneColor = safeColor(lab.sceneColor, accent);
  const ruleColor = safeColor(lab.ruleColor, accent);

  const bodyFont = safeFontFamily(lab.bodyFont, "Gelasio, serif");
  const headingFont = safeFontFamily(lab.headingFont, "Gelasio, serif");
  const dropcapFont = safeFontFamily(lab.dropcapFont || lab.headingFont || lab.bodyFont, "Gelasio, serif");
  const titlePageFont = safeFontFamily(lab.titlePageFont || lab.headingFont, "Gelasio, serif");

  const bodySize = clampNumber(lab.bodySize, .72, 1.5, 1);
  const lineHeight = clampNumber(lab.lineHeight, 1.2, 2.1, 1.5);
  const paragraphIndent = clampNumber(lab.paragraphIndent, 0, 4, 1.25);
  const paragraphSpacing = clampNumber(lab.paragraphSpacing, 0, 3, 0);

  out.push(`body { background:${paper}; color:${ink} !important; font-family:${bodyFont} !important; font-size:${bodySize}em !important; line-height:${lineHeight} !important; }`);
  out.push(`section.chapter > p:not(.scene-break), section.chapter > blockquote p, section.chapter li, section.backmatter > p:not(.scene-break), section.backmatter li { color:${ink}; }`);
  out.push(`section.chapter > p:not(.scene-break), section.chapter > blockquote p, section.backmatter > p:not(.scene-break) { text-indent:${paragraphIndent}em !important; margin-bottom:${paragraphSpacing}em !important; } section.chapter > p.folio-native-dropcap, section.chapter > p:has(.dropcap), .folio-native-dropcap { text-indent:0 !important; }`);
  if (lab.bodyAlign === "left") {
    out.push(`section.chapter > p:not(.scene-break), section.chapter > blockquote p, section.chapter li, section.backmatter > p:not(.scene-break), section.backmatter li { text-align:left !important; text-align-last:left !important; -webkit-hyphens:none; hyphens:none; }`);
  } else {
    out.push(`section.chapter > p:not(.scene-break), section.chapter > blockquote p, section.chapter li, section.backmatter > p:not(.scene-break), section.backmatter li { text-align:justify !important; text-align-last:left !important; }`);
  }

  const headingSize = clampNumber(lab.headingSize, .8, 4.5, 1.8);
  const headingWeight = [400,500,600,700,800,900].includes(Number(lab.headingWeight)) ? Number(lab.headingWeight) : 600;
  const headingTracking = clampNumber(lab.headingTracking, -.08, .5, 0);
  const headingTop = clampNumber(lab.headingTop, 0, 8, 1.2);
  const headingBottom = clampNumber(lab.headingBottom, .1, 8, 2);
  const headingAlign = lab.headingAlign === "left" || lab.headingAlign === "right" ? lab.headingAlign : "center";
  const headingStyle = lab.headingStyle === "italic" ? "italic" : "normal";
  const headingCase = lab.headingCase === "uppercase"
    ? "text-transform:uppercase;font-variant:normal;"
    : lab.headingCase === "smallcaps"
      ? "text-transform:none;font-variant:small-caps;"
      : "text-transform:none;font-variant:normal;";

  out.push(`section.chapter > h1, h1.chapter { box-sizing:border-box; color:${headingColor} !important; font-family:${headingFont} !important; font-size:${headingSize}em !important; font-weight:${headingWeight} !important; font-style:${headingStyle} !important; letter-spacing:${headingTracking}em !important; text-align:${headingAlign} !important; text-align-last:${headingAlign} !important; margin:${headingTop}em 0 ${headingBottom}em !important; ${headingCase} }`);

  const ruleWidth = clampNumber(lab.ruleWidth, .5, 8, 1);
  const ruleLength = clampNumber(lab.ruleLength, 35, 100, 100);
  const rulePadding = clampNumber(lab.rulePadding, 0, 3, .65);
  const ruleRadius = clampNumber(lab.ruleRadius, 0, 40, 0);
  const rule = lab.chapterRule ?? "none";
  const headingSelector = "section.chapter > h1, h1.chapter";
  const line = ruleWidth + "px solid " + ruleColor;
  const pushRule = (decls: string) => out.push(headingSelector + " { " + decls + " }");
  pushRule("border:none !important;outline:none !important;box-shadow:none !important;background-image:none !important;border-radius:" + ruleRadius + "px !important;width:" + ruleLength + "% !important;max-width:100% !important;margin-left:auto !important;margin-right:auto !important;padding:0 !important;");
  if (rule === "top") pushRule("border-top:" + line + " !important;padding:" + rulePadding + "em .4em 0 !important;");
  else if (rule === "bottom") pushRule("border-bottom:" + line + " !important;padding:0 .4em " + rulePadding + "em !important;");
  else if (rule === "top-bottom") pushRule("border-top:" + line + " !important;border-bottom:" + line + " !important;padding:" + rulePadding + "em .4em !important;");
  else if (rule === "left") pushRule("border-left:" + line + " !important;padding:.25em .4em .25em " + rulePadding + "em !important;");
  else if (rule === "right") pushRule("border-right:" + line + " !important;padding:.25em " + rulePadding + "em .25em .4em !important;");
  else if (["box", "double", "dashed", "dotted", "shadow"].includes(rule)) {
    const style = rule === "double" ? "double" : rule === "dashed" ? "dashed" : rule === "dotted" ? "dotted" : "solid";
    const thickness = rule === "double" ? Math.max(3, ruleWidth) : ruleWidth;
    const shadow = rule === "shadow" ? "box-shadow:5px 5px 0 rgba(0,0,0,.12) !important;" : "";
    pushRule("border:" + thickness + "px " + style + " " + ruleColor + " !important;padding:" + rulePadding + "em !important;" + shadow);
  } else if (rule === "corners") {
    const corner = "linear-gradient(" + ruleColor + "," + ruleColor + ")";
    pushRule("padding:" + rulePadding + "em !important;background-image:" + [corner,corner,corner,corner].join(",") + " !important;background-repeat:no-repeat !important;background-position:left top,right top,left bottom,right bottom !important;background-size:20% " + ruleWidth + "px,20% " + ruleWidth + "px,20% " + ruleWidth + "px,20% " + ruleWidth + "px !important;");
  }

  const labelVisible = lab.labelVisible !== false;
  if (!labelVisible) {
    out.push(`section.chapter > h1::before, h1.chapter::before { content:none !important; display:none !important; }`);
  } else {
    const label = safeLabel(lab.labelText, "CHAPTER");
    const labelSize = clampNumber(lab.labelSize, .24, 1.2, .45);
    const labelTracking = clampNumber(lab.labelTracking, 0, .7, .2);
    out.push(`section.chapter > h1::before, h1.chapter::before { display:block !important; margin-bottom:.8em !important; color:${labelColor} !important; font-family:${headingFont} !important; font-size:${labelSize}em !important; font-weight:600 !important; font-style:normal !important; letter-spacing:${labelTracking}em !important; line-height:1 !important; text-transform:uppercase !important; }`);
    const chapters = book.sections.filter((section) => section.kind === "chapter");
    for (const [index, section] of chapters.entries()) {
      const number = section.chapterNumber ?? index + 1;
      out.push(`section.chapter[id=${JSON.stringify(section.id)}] > h1::before { content:${JSON.stringify(`${label} ${number}`)} !important; }`);
    }
  }

  const subtitleSize = clampNumber(lab.subtitleSize, .5, 2, .92);
  const subtitleTracking = clampNumber(lab.subtitleTracking, -.05, .5, .04);
  const subtitleAlign = lab.subtitleAlign === "left" || lab.subtitleAlign === "right" ? lab.subtitleAlign : "center";
  const subtitleStyle = lab.subtitleStyle === "normal" ? "normal" : "italic";
  out.push(`.chapter-subtitle { text-align:${subtitleAlign} !important; } .chapter-subtitle p { color:${subtitleColor} !important; font-size:${subtitleSize}em !important; font-style:${subtitleStyle} !important; letter-spacing:${subtitleTracking}em !important; text-align:${subtitleAlign} !important; text-align-last:${subtitleAlign} !important; }`);

  if (lab.dropcap === false) {
    out.push(`.folio-native-dropcap { text-indent:${paragraphIndent}em !important; } .folio-native-dropcap .dropcap, .dropcap { float:none !important; display:inline !important; position:static !important; max-width:none !important; font-size:inherit !important; line-height:inherit !important; padding:0 !important; margin:0 !important; font-family:inherit !important; color:inherit !important; transform:none !important; }`);
  } else {
    const dc = lab.dropcapSize === "large" ? 4.35 : 3.05;
    out.push(`:root { --folio-dropcap-user-size:${dc}em; --folio-dropcap-lines:${lab.dropcapSize === "large" ? 3 : 2}; }`);
    out.push(`.folio-native-dropcap { text-indent:0 !important; overflow:visible !important; }`);
    out.push(`.folio-native-dropcap .dropcap, .dropcap { float:left !important; display:block !important; position:relative !important; box-sizing:border-box !important; max-width:38% !important; font-family:${dropcapFont} !important; color:${accent} !important; font-size:var(--folio-dropcap-user-size) !important; line-height:.9 !important; padding:0 .09em 0 0 !important; margin:0 0 0 0 !important; transform:none !important; white-space:nowrap !important; overflow:visible !important; }`);
  }

  const sceneSize = clampNumber(lab.sceneSize, .5, 3, 1.1);
  const sceneText = safeLabel(lab.sceneOrnament, "⁂");
  out.push(`.scene-break { color:${sceneColor} !important; font-size:${sceneSize}em !important; letter-spacing:.18em !important; }`);

  const titlePageAlign = lab.titlePageAlign === "left" || lab.titlePageAlign === "right" ? lab.titlePageAlign : "center";
  const titlePageSize = clampNumber(lab.titlePageSize, 1, 5, 2.4);
  out.push(`section.titlepage, section.titlepage * { text-align:${titlePageAlign} !important; text-align-last:${titlePageAlign} !important; } section.titlepage > h1 { color:${headingColor} !important; font-family:${titlePageFont} !important; font-size:${titlePageSize}em !important; } section.titlepage .tp-author { color:${accent} !important; }`);

  const chapterImage = safeDataImage(lab.chapterOrnament?.dataUrl);
  if (chapterImage) {
    const width = clampNumber(lab.chapterOrnament?.width, 6, 100, 34);
    const height = clampNumber(lab.chapterOrnament?.height, .6, 12, 3.2);
    const opacity = clampNumber(lab.chapterOrnament?.opacity, .1, 1, 1);
    const gap = clampNumber(lab.chapterOrnament?.gap, 0, 5, .7);
    const x = clampNumber(lab.chapterOrnament?.offsetX, -100, 100, 0);
    const y = clampNumber(lab.chapterOrnament?.offsetY, -60, 60, 0);
    const align = lab.chapterOrnament?.align === "left" ? "margin-left:0!important;margin-right:auto!important;" : lab.chapterOrnament?.align === "right" ? "margin-left:auto!important;margin-right:0!important;" : "";
    const imageRule = "background-image:url(" + JSON.stringify(chapterImage) + ");background-position:center;background-repeat:no-repeat;background-size:contain;transform:translate(" + x + "px," + y + "px);" + align;
    if (lab.chapterOrnament?.placement === "above") {
      out.push(`section.chapter::before { content:""; display:block; width:${width}%; height:${height}em; margin:0 auto ${gap}em; opacity:${opacity}; ${imageRule} }`);
      out.push(`section.chapter > h1::after, h1.chapter::after { content:none !important; display:none !important; }`);
    } else {
      out.push(`section.chapter > h1::after, h1.chapter::after { content:"" !important; display:block !important; width:${width}% !important; height:${height}em !important; margin:${gap}em auto 0 !important; opacity:${opacity} !important; ${imageRule} }`);
    }
  } else {
    out.push(`section.chapter::before { content:none !important; display:none !important; }`);
    out.push(`section.chapter > h1::after, h1.chapter::after { content:none !important; display:none !important; }`);
  }

  const sceneImage = safeDataImage(lab.sceneImage?.dataUrl);
  if (sceneImage) {
    const width = clampNumber(lab.sceneImage?.width, 4, 80, 18);
    const height = clampNumber(lab.sceneImage?.height, .4, 8, 1.8);
    const opacity = clampNumber(lab.sceneImage?.opacity, .1, 1, 1);
    const gap = clampNumber(lab.sceneImage?.gap, 0, 6, .2);
    const x = clampNumber(lab.sceneImage?.offsetX, -100, 100, 0);
    const y = clampNumber(lab.sceneImage?.offsetY, -60, 60, 0);
    const align = lab.sceneImage?.align === "left" ? "margin-left:0!important;margin-right:auto!important;" : lab.sceneImage?.align === "right" ? "margin-left:auto!important;margin-right:0!important;" : "";
    out.push(`.scene-break { font-size:0 !important; color:transparent !important; } .scene-break::before { content:"" !important; display:block !important; width:${width}% !important; height:${height}em !important; font-size:1rem !important; margin:${gap}em auto !important; opacity:${opacity} !important; transform:translate(${x}px,${y}px) !important; ${align} background-image:url(${JSON.stringify(sceneImage)}); background-position:center; background-repeat:no-repeat; background-size:contain; }`);
    out.push(`.scene-break::after { content:none !important; display:none !important; }`);
  } else {
    out.push(`.scene-break::before { content:none !important; display:none !important; } .scene-break { font-size:0 !important; color:transparent !important; } .scene-break::after { content:${JSON.stringify(sceneText)} !important; display:inline !important; color:${sceneColor} !important; font-size:${sceneSize}rem !important; }`);
  }

  return out.join("\n");
}


/**
 * Build CSS for the book's custom fonts + per-class style overrides.
 * - html/print: fonts are inlined as base64 data URIs (self-contained).
 * - epub: fonts are referenced by filename (Pandoc embeds them via --epub-embed-font).
 *
 * `embedFonts: false` (the KDP preset) drops the @font-face blocks entirely. It
 * has to be decided here, not just at the Pandoc flag: emitting @font-face while
 * skipping --epub-embed-font would leave every src pointing at a file that isn't
 * in the archive. The per-class font-family rules are left alone — an unavailable
 * family falls back to the reader's default, which is what that preset wants.
 */
export async function buildDocCss(
  book: Book,
  target: "html" | "epub",
  opts: { embedFonts?: boolean } = {},
): Promise<string> {
  const parts: string[] = [];
  const embedFonts = opts.embedFonts ?? true;

  for (const f of embedFonts ? book.fonts : []) {
    let src: string;
    if (target === "epub") {
      // Pandoc embeds fonts under EPUB/fonts/ and writes our CSS to EPUB/styles/,
      // so the @font-face src must be relative to the stylesheet: ../fonts/<file>.
      src = `url('../fonts/${path.basename(f.file)}') format('${fontFormat(f.file)}')`;
    } else {
      const data = await fs.readFile(f.file);
      src = `url('data:${fontMime(f.file)};base64,${data.toString("base64")}') format('${fontFormat(f.file)}')`;
    }
    parts.push(
      `@font-face { font-family: "${f.family.replace(/"/g, '\\"')}"; ` +
        `font-weight: ${f.weight ?? "normal"}; font-style: ${f.style ?? "normal"}; src: ${src}; }`,
    );
  }

  for (const [cls, s] of Object.entries(book.styles)) {
    const decls = styleDecls(s);
    if (decls) parts.push(`.${safeClass(cls)} { ${decls} }`);
  }

  parts.push(typographyCss(book));

  return parts.filter(Boolean).join("\n");
}

/** Per-book typography overrides (body/heading font, chapter-title style). */
function typographyCss(book: Book): string {
  const ty = book.typography ?? {};
  const out: string[] = [];

  const dropcapSizes = {
    small: { screen: "3em", print: "5em" },
    large: { screen: "4.5em", print: "7em" },
  } as const;
  if (ty.dropcapSize) {
    const size = dropcapSizes[ty.dropcapSize];
    out.push(`:root { --folio-dropcap-user-size: ${size.screen}; --folio-dropcap-print-size: ${size.print}; }`);
  }
  if (ty.dropcapFont) {
    out.push(`.dropcap { font-family: ${familyValue(ty.dropcapFont)} !important; }`);
  }

  const bodyDecls: string[] = [];
  if (ty.bodyFont) bodyDecls.push(`font-family: ${familyValue(ty.bodyFont)} !important;`);
  // !important so the author's size/leading survive the print path, where
  // print-base.css (body { font-size: 11pt; line-height: 1.4 }) is injected AFTER
  // this stylesheet and would otherwise win at equal specificity. See
  // reviews/2026-07-02-creative-lens-fable5.md issue #2.
  if (ty.fontSize) bodyDecls.push(`font-size: ${ty.fontSize} !important;`);
  if (ty.lineHeight) bodyDecls.push(`line-height: ${ty.lineHeight} !important;`);
  if (bodyDecls.length) out.push(`body { ${bodyDecls.join(" ")} }`);
  if (ty.bodyAlign === "justify") {
    out.push(`
.book-formatter section.chapter > p:not(.scene-break),
.book-formatter section.chapter > blockquote p,
.book-formatter section.chapter li,
.book-formatter section.backmatter > p:not(.scene-break),
.book-formatter section.backmatter li {
  text-align: justify !important;
  text-align-last: left !important;
  text-justify: inter-word;
  -webkit-hyphens: manual;
  hyphens: manual;
  hyphenate-limit-chars: 7 3 3;
  hyphenate-limit-lines: 2;
  overflow-wrap: normal;
  word-break: normal;
}`);
  } else if (ty.bodyAlign === "left") {
    out.push(`
.book-formatter section.chapter > p:not(.scene-break),
.book-formatter section.chapter > blockquote p,
.book-formatter section.chapter li,
.book-formatter section.backmatter > p:not(.scene-break),
.book-formatter section.backmatter li {
  text-align: left !important;
  text-align-last: left !important;
  -webkit-hyphens: none;
  hyphens: none;
  text-wrap: pretty;
}`);
  }
  out.push(`.scene-break { text-align: center !important; text-align-last: center !important; word-spacing: normal !important; letter-spacing: normal !important; }`);
  if (ty.paragraphIndent !== undefined) out.push(`p { text-indent: ${ty.paragraphIndent} !important; }`);
  if (ty.paragraphSpacing !== undefined) out.push(`p { margin-bottom: ${ty.paragraphSpacing} !important; }`);
  if (ty.paragraphAfterBreakIndent !== undefined) {
    out.push(`.scene-break + p, hr + p { text-indent: ${ty.paragraphAfterBreakIndent} !important; }`);
  }
  if (ty.titlePageFont) {
    out.push(`section.titlepage, section.titlepage > h1 { font-family: ${familyValue(ty.titlePageFont)} !important; }`);
  }

  if (ty.headingFont) {
    out.push(`h1, h2, h3, section.chapter > h1, h1.chapter { font-family: ${familyValue(ty.headingFont)} !important; }`);

    // Jena Gotisch has unusually generous swashes/overhangs and very tight
    // built-in spacing. Theme heading rules written for ordinary display faces
    // (notably Grimoire's 500 weight + 1.05 leading) make it collide with itself
    // and visibly escape decorative frames. Keep the theme's size/alignment,
    // but give this face sane optical metrics and disable synthetic medium bold.
    if (ty.headingFont === "Jena Gotisch" || ty.headingFont === "Folio Jena Gotisch") {
      out.push(`
h1, h2, h3, section.chapter > h1, h1.chapter {
  font-weight: 400 !important;
  font-kerning: none;
  letter-spacing: 0.055em !important;
  line-height: 1.16 !important;
}
section.chapter > h1, h1.chapter {
  box-sizing: border-box;
  padding-left: 1em !important;
  padding-right: 1em !important;
  text-wrap: balance;
}`);
    }
  }

  const ct = ty.chapterTitle;
  if (ct) {
    const d: string[] = [];
    if (ct.size) d.push(`font-size: ${ct.size};`);
    if (ct.align) d.push(`text-align: ${ct.align};`);
    if (ct.style) d.push(`font-style: ${ct.style};`);
    if (ct.case === "smallcaps") d.push(`font-variant: small-caps; text-transform: none;`);
    else if (ct.case === "uppercase") d.push(`text-transform: uppercase; font-variant: normal;`);
    else if (ct.case === "normal") d.push(`text-transform: none; font-variant: normal;`);
    if (d.length) out.push(`section.chapter > h1, h1.chapter { ${d.join(" ")} }`);
    if (ct.showLabel === false) {
      out.push(`section.chapter > h1::before, h1.chapter::before { content: none !important; display: none !important; }`);
    } else if (ct.labelText?.trim()) {
      const chapters = book.sections.filter((section) => section.kind === "chapter");
      for (const [index, section] of chapters.entries()) {
        const number = section.chapterNumber ?? index + 1;
        out.push(`section.chapter[id=${JSON.stringify(section.id)}] > h1::before { content: ${JSON.stringify(`${ct.labelText.trim()} ${number}`)} !important; }`);
      }
    }
  }

  const labCss = themeLabCss(book);
  if (labCss) out.push(labCss);

  return out.join("\n");
}

/** The font files to embed into the EPUB (for --epub-embed-font). */
export function epubFontFiles(book: Book): string[] {
  return book.fonts.map((f) => f.file);
}

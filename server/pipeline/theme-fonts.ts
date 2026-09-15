import { promises as fs } from "node:fs";
import path from "node:path";
import type { ThemeName } from "./types.ts";
import { THEME_FONTS_DIR, themeCss } from "./paths.ts";

type FontTarget = "html" | "print" | "epub";
type FontFace = { file: string; weight: string; style: "normal" | "italic" };
type FontSpec = { family: string; faces: FontFace[] };

const FONTS = {
  sourceSerif: { family: "Folio Source Serif 4", faces: [
    { file: "source-serif-4.ttf", weight: "200 900", style: "normal" },
    { file: "source-serif-4-italic.ttf", weight: "200 900", style: "italic" },
  ] },
  sourceSans: { family: "Folio Source Sans 3", faces: [
    { file: "source-sans-3.ttf", weight: "200 900", style: "normal" },
    { file: "source-sans-3-italic.ttf", weight: "200 900", style: "italic" },
  ] },
  garamond: { family: "Folio EB Garamond", faces: [
    { file: "eb-garamond.ttf", weight: "400 800", style: "normal" },
    { file: "eb-garamond-italic.ttf", weight: "400 800", style: "italic" },
  ] },
  caslon: { family: "Folio Libre Caslon Text", faces: [
    { file: "libre-caslon-text.ttf", weight: "400 700", style: "normal" },
    { file: "libre-caslon-text-italic.ttf", weight: "400 700", style: "italic" },
  ] },
  baskerville: { family: "Folio Libre Baskerville", faces: [
    { file: "libre-baskerville.ttf", weight: "400 700", style: "normal" },
    { file: "libre-baskerville-italic.ttf", weight: "400 700", style: "italic" },
  ] },
  newsreader: { family: "Folio Newsreader", faces: [
    { file: "newsreader.ttf", weight: "200 800", style: "normal" },
    { file: "newsreader-italic.ttf", weight: "200 800", style: "italic" },
  ] },
  vollkorn: { family: "Folio Vollkorn", faces: [
    { file: "vollkorn.ttf", weight: "400 900", style: "normal" },
    { file: "vollkorn-italic.ttf", weight: "400 900", style: "italic" },
  ] },
  condensed: { family: "Folio Barlow Condensed", faces: [
    { file: "barlow-condensed-regular.ttf", weight: "400", style: "normal" },
    { file: "barlow-condensed-bold.ttf", weight: "700", style: "normal" },
    { file: "barlow-condensed-black.ttf", weight: "900", style: "normal" },
  ] },
  bodoni: { family: "Folio Bodoni Moda", faces: [
    { file: "bodoni-moda.ttf", weight: "400 900", style: "normal" },
    { file: "bodoni-moda-italic.ttf", weight: "400 900", style: "italic" },
  ] },
  cinzel: { family: "Folio Cinzel", faces: [
    { file: "cinzel.ttf", weight: "400 900", style: "normal" },
  ] },
  gothic: { family: "Folio Grenze Gotisch", faces: [
    { file: "grenze-gotisch.ttf", weight: "100 900", style: "normal" },
  ] },
  slab: { family: "Folio Roboto Slab", faces: [
    { file: "roboto-slab.ttf", weight: "100 900", style: "normal" },
  ] },
} satisfies Record<string, FontSpec>;

type FontKey = keyof typeof FONTS;

/*
 * These body-only substitutions are deliberately theme-scoped. The original
 * display/decorative families stay available to headings and ornaments, while
 * body text and drop caps use the families that passed the v1.0.7 compositor
 * qualification matrix across PL, PL-dropcap and EN scenarios.
 */
const BODY_FONT_OVERRIDES: Partial<Record<ThemeName, FontKey>> = {
  decorative: "garamond",
  heritage: "garamond",
  nocturne: "garamond",
  obsidian: "garamond",
  cathedral: "garamond",
  revenant: "garamond",
  editorial: "vollkorn",
  scholar: "vollkorn",
  folio: "vollkorn",
  atlas: "vollkorn",
  ember: "vollkorn",
  solstice: "vollkorn",
  runestone: "vollkorn",
  cloister: "garamond",
  timber: "garamond",
  wyrmwood: "garamond",
  ironbound: "garamond",
};

const LEGACY_TO_BUILTIN: Array<[string, FontKey]> = [
  ["Folio Source Serif 4", "sourceSerif"], ["Folio Source Sans 3", "sourceSans"],
  ["Folio EB Garamond", "garamond"], ["Folio Libre Caslon Text", "caslon"],
  ["Folio Libre Baskerville", "baskerville"], ["Folio Newsreader", "newsreader"],
  ["Folio Vollkorn", "vollkorn"], ["Folio Barlow Condensed", "condensed"],
  ["Folio Bodoni Moda", "bodoni"], ["Folio Cinzel", "cinzel"],
  ["Folio Grenze Gotisch", "gothic"], ["Folio Roboto Slab", "slab"],

  ["Libre Caslon Text", "caslon"], ["Libre Baskerville", "baskerville"],
  ["EB Garamond", "garamond"], ["Newsreader", "newsreader"], ["Vollkorn", "vollkorn"],
  ["Barlow Condensed", "condensed"], ["Bodoni Moda", "bodoni"], ["Cinzel", "cinzel"],
  ["Grenze Gotisch", "gothic"], ["Roboto Slab", "slab"], ["Source Serif 4", "sourceSerif"],
  ["Source Sans 3", "sourceSans"],

  ["Old English Text MT", "gothic"], ["Palatino Linotype", "vollkorn"],
  ["Helvetica Neue", "sourceSans"], ["Times New Roman", "sourceSerif"],
  ["Arial Narrow", "condensed"], ["Arial Black", "sourceSans"],
  ["Bodoni MT", "bodoni"], ["Trajan Pro", "cinzel"], ["Book Antiqua", "vollkorn"],
  ["Hoefler Text", "baskerville"], ["UnifrakturCook", "gothic"], ["Copperplate", "cinzel"],
  ["Baskerville", "baskerville"], ["Garamond", "garamond"], ["Palatino", "vollkorn"],
  ["Cambria", "newsreader"], ["Charter", "caslon"], ["Rockwell", "slab"],
  ["Georgia", "sourceSerif"], ["Avenir", "sourceSans"], ["Didot", "bodoni"],
  ["Arial", "sourceSans"], ["Segoe UI", "sourceSans"],
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/*
 * Normalize in three phases. Exact quoted family names are replaced first.
 * Every other quoted CSS string is then hidden while bare family aliases are
 * normalized, so `Baskerville` cannot corrupt `"Baskerville Old Face"`,
 * `Charter` cannot corrupt `"Bitstream Charter"`, and font-looking words in
 * generated `content:` strings are never touched. Font placeholders also stop
 * shorter aliases from cascading into already-normalized Folio family names.
 */
export function normalizeThemeFontFamilies(css: string): { css: string; used: Set<FontKey> } {
  let normalized = css;
  const used = new Set<FontKey>();
  const fontPlaceholders = new Map<string, FontKey>();

  LEGACY_TO_BUILTIN.forEach(([legacy, key], index) => {
    const escaped = escapeRegExp(legacy);
    const quoted = new RegExp(`(["'])${escaped}\\1`, "g");
    const token = `__FOLIO_THEME_FONT_${index}__`;
    const before = normalized;
    normalized = normalized.replace(quoted, token);
    if (normalized !== before) {
      used.add(key);
      fontPlaceholders.set(token, key);
    }
  });

  const stringPlaceholders = new Map<string, string>();
  normalized = normalized.replace(/(["'])(?:\\.|(?!\1)[^\\\r\n])*\1/g, (value) => {
    const token = `__FOLIO_CSS_STRING_${stringPlaceholders.size}__`;
    stringPlaceholders.set(token, value);
    return token;
  });

  LEGACY_TO_BUILTIN.forEach(([legacy, key], index) => {
    const escaped = escapeRegExp(legacy);
    const bare = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "g");
    const token = `__FOLIO_THEME_FONT_${index}__`;
    const before = normalized;
    normalized = normalized.replace(bare, token);
    if (normalized !== before) {
      used.add(key);
      fontPlaceholders.set(token, key);
    }
  });

  for (const [token, value] of stringPlaceholders) {
    normalized = normalized.replaceAll(token, value);
  }
  for (const [token, key] of fontPlaceholders) {
    normalized = normalized.replaceAll(token, JSON.stringify(FONTS[key].family));
  }

  return { css: normalized, used };
}

function fontMime(file: string): string {
  return file.endsWith(".otf") ? "font/otf" : "font/ttf";
}

async function faceSource(file: string, target: FontTarget): Promise<string> {
  if (target === "html") return `url('/theme-fonts/${file}') format('truetype')`;
  if (target === "epub") return `url('../fonts/${file}') format('truetype')`;
  const data = await fs.readFile(path.join(THEME_FONTS_DIR, file));
  return `url('data:${fontMime(file)};base64,${data.toString("base64")}') format('truetype')`;
}

async function fontFaceCss(spec: FontSpec, target: FontTarget): Promise<string> {
  const rules: string[] = [];
  for (const face of spec.faces) {
    rules.push(
      `@font-face{font-family:${JSON.stringify(spec.family)};src:${await faceSource(face.file, target)};` +
      `font-weight:${face.weight};font-style:${face.style};font-display:block;}`,
    );
  }
  return rules.join("\n");
}

export async function buildThemeRuntimeCss(
  theme: ThemeName,
  target: FontTarget,
): Promise<{ css: string; themeCss: string; fontCss: string; fontFiles: string[]; families: string[] }> {
  const source = await fs.readFile(themeCss(theme), "utf8");
  const normalized = normalizeThemeFontFamilies(source);
  const bodyFontOverride = BODY_FONT_OVERRIDES[theme];
  if (bodyFontOverride) {
    const family = JSON.stringify(FONTS[bodyFontOverride].family);
    normalized.css += `\nbody{font-family:${family},serif;}\n.dropcap{font-family:${family},serif;}\n`;
    normalized.used.add(bodyFontOverride);
  }
  const keys = [...normalized.used];
  const faces = await Promise.all(keys.map((key) => fontFaceCss(FONTS[key], target)));
  const fontCss = faces.join("\n");
  const fontFiles = [...new Set(keys.flatMap((key) => FONTS[key].faces.map((face) => path.join(THEME_FONTS_DIR, face.file))))];
  return {
    css: `${fontCss}\n${normalized.css}`,
    themeCss: normalized.css,
    fontCss,
    fontFiles,
    families: keys.map((key) => FONTS[key].family),
  };
}

export function normalizeThemeFontStack(stack: string): string {
  return normalizeThemeFontFamilies(stack).css;
}

export function builtinThemeFontFamilies(): string[] {
  return Object.values(FONTS).map((font) => font.family);
}

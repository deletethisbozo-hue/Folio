import { promises as fs } from "node:fs";
import path from "node:path";
import type { ThemeName } from "./types.ts";
import { THEME_FONTS_DIR, themeCss } from "./paths.ts";

type FontTarget = "html" | "print" | "epub";
type FontFace = { file: string; weight: string; style: "normal" | "italic" };
type FontSpec = { family: string; faces: FontFace[] };

const FONTS = {
  sourceSerif: {
    family: "Folio Source Serif 4",
    faces: [
      { file: "source-serif-4.ttf", weight: "200 900", style: "normal" },
      { file: "source-serif-4-italic.ttf", weight: "200 900", style: "italic" },
    ],
  },
  sourceSans: {
    family: "Folio Source Sans 3",
    faces: [
      { file: "source-sans-3.ttf", weight: "200 900", style: "normal" },
      { file: "source-sans-3-italic.ttf", weight: "200 900", style: "italic" },
    ],
  },
  garamond: {
    family: "Folio EB Garamond",
    faces: [
      { file: "eb-garamond.ttf", weight: "400 800", style: "normal" },
      { file: "eb-garamond-italic.ttf", weight: "400 800", style: "italic" },
    ],
  },
  caslon: {
    family: "Folio Libre Caslon Text",
    faces: [
      { file: "libre-caslon-text.ttf", weight: "400 700", style: "normal" },
      { file: "libre-caslon-text-italic.ttf", weight: "400 700", style: "italic" },
    ],
  },
  baskerville: {
    family: "Folio Libre Baskerville",
    faces: [
      { file: "libre-baskerville.ttf", weight: "400 700", style: "normal" },
      { file: "libre-baskerville-italic.ttf", weight: "400 700", style: "italic" },
    ],
  },
  newsreader: {
    family: "Folio Newsreader",
    faces: [
      { file: "newsreader.ttf", weight: "200 800", style: "normal" },
      { file: "newsreader-italic.ttf", weight: "200 800", style: "italic" },
    ],
  },
  vollkorn: {
    family: "Folio Vollkorn",
    faces: [
      { file: "vollkorn.ttf", weight: "400 900", style: "normal" },
      { file: "vollkorn-italic.ttf", weight: "400 900", style: "italic" },
    ],
  },
  condensed: {
    family: "Folio Barlow Condensed",
    faces: [
      { file: "barlow-condensed-regular.ttf", weight: "400", style: "normal" },
      { file: "barlow-condensed-bold.ttf", weight: "700", style: "normal" },
      { file: "barlow-condensed-black.ttf", weight: "900", style: "normal" },
    ],
  },
  bodoni: {
    family: "Folio Bodoni Moda",
    faces: [
      { file: "bodoni-moda.ttf", weight: "400 900", style: "normal" },
      { file: "bodoni-moda-italic.ttf", weight: "400 900", style: "italic" },
    ],
  },
  cinzel: {
    family: "Folio Cinzel",
    faces: [{ file: "cinzel.ttf", weight: "400 900", style: "normal" }],
  },
  gothic: {
    family: "Folio Grenze Gotisch",
    faces: [{ file: "grenze-gotisch.ttf", weight: "100 900", style: "normal" }],
  },
  slab: {
    family: "Folio Roboto Slab",
    faces: [{ file: "roboto-slab.ttf", weight: "100 900", style: "normal" }],
  },
} satisfies Record<string, FontSpec>;

type FontKey = keyof typeof FONTS;

// Theme CSS predates the bundled-font system and deliberately uses familiar
// desktop family names. Normalize those names at render time so every platform
// receives the same actual typeface without forcing thirty theme files to carry
// duplicated @font-face boilerplate.
const LEGACY_TO_BUILTIN: Array<[string, FontKey]> = [
  ["Old English Text MT", "gothic"],
  ["Palatino Linotype", "vollkorn"],
  ["Helvetica Neue", "sourceSans"],
  ["Libre Baskerville", "baskerville"],
  ["Times New Roman", "sourceSerif"],
  ["Barlow Condensed", "condensed"],
  ["Arial Narrow", "condensed"],
  ["Arial Black", "sourceSans"],
  ["Bodoni MT", "bodoni"],
  ["Trajan Pro", "cinzel"],
  ["Book Antiqua", "vollkorn"],
  ["Hoefler Text", "baskerville"],
  ["UnifrakturCook", "gothic"],
  ["Copperplate", "cinzel"],
  ["Baskerville", "baskerville"],
  ["Garamond", "garamond"],
  ["Palatino", "vollkorn"],
  ["Cambria", "newsreader"],
  ["Charter", "caslon"],
  ["Rockwell", "slab"],
  ["Georgia", "sourceSerif"],
  ["Avenir", "sourceSans"],
  ["Didot", "bodoni"],
  ["Arial", "sourceSans"],
  ["Segoe UI", "sourceSans"],
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeThemeFontFamilies(css: string): { css: string; used: Set<FontKey> } {
  let normalized = css;
  const used = new Set<FontKey>();
  for (const [legacy, key] of LEGACY_TO_BUILTIN) {
    const spec = FONTS[key];
    const escaped = escapeRegExp(legacy);
    const quoted = new RegExp(`(["'])${escaped}\\1`, "g");
    const bare = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "g");
    const before = normalized;
    normalized = normalized.replace(quoted, `"${spec.family}"`).replace(bare, `"${spec.family}"`);
    if (normalized !== before) used.add(key);
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
): Promise<{ css: string; fontFiles: string[]; families: string[] }> {
  const source = await fs.readFile(themeCss(theme), "utf8");
  const normalized = normalizeThemeFontFamilies(source);
  const keys = [...normalized.used];
  const faces = await Promise.all(keys.map((key) => fontFaceCss(FONTS[key], target)));
  const fontFiles = [...new Set(keys.flatMap((key) => FONTS[key].faces.map((face) => path.join(THEME_FONTS_DIR, face.file))))];
  return {
    css: `${faces.join("\n")}\n${normalized.css}`,
    fontFiles,
    families: keys.map((key) => FONTS[key].family),
  };
}

export function builtinThemeFontFamilies(): string[] {
  return Object.values(FONTS).map((font) => font.family);
}

import { promises as fs } from "node:fs";
import path from "node:path";
import type { ThemeName } from "./types.ts";
import { THEME_FONTS_DIR, themeCss } from "./paths.ts";

type FontTarget = "html" | "print" | "epub";
type FontFace = { file: string; weight: string; style: "normal" | "italic" };
type FontSpec = { family: string; faces: FontFace[] };

const FONTS = {
  sourceSerif: { family: "Source Serif 4", faces: [
    { file: "source-serif-4.ttf", weight: "200 900", style: "normal" },
    { file: "source-serif-4-italic.ttf", weight: "200 900", style: "italic" },
  ] },
  sourceSans: { family: "Source Sans 3", faces: [
    { file: "source-sans-3.ttf", weight: "200 900", style: "normal" },
    { file: "source-sans-3-italic.ttf", weight: "200 900", style: "italic" },
  ] },
  garamond: { family: "EB Garamond", faces: [
    { file: "eb-garamond.ttf", weight: "400 800", style: "normal" },
    { file: "eb-garamond-italic.ttf", weight: "400 800", style: "italic" },
  ] },
  caslon: { family: "Libre Caslon Text", faces: [
    { file: "libre-caslon-text.ttf", weight: "400 700", style: "normal" },
    { file: "libre-caslon-text-italic.ttf", weight: "400 700", style: "italic" },
  ] },
  baskerville: { family: "Libre Baskerville", faces: [
    { file: "libre-baskerville.ttf", weight: "400 700", style: "normal" },
    { file: "libre-baskerville-italic.ttf", weight: "400 700", style: "italic" },
  ] },
  newsreader: { family: "Newsreader", faces: [
    { file: "newsreader.ttf", weight: "200 800", style: "normal" },
    { file: "newsreader-italic.ttf", weight: "200 800", style: "italic" },
  ] },
  gelasio: { family: "Gelasio", faces: [
    { file: "gelasio.ttf", weight: "400 700", style: "normal" },
    { file: "gelasio-italic.ttf", weight: "400 700", style: "italic" },
  ] },
  vollkorn: { family: "Vollkorn", faces: [
    { file: "vollkorn.ttf", weight: "400 900", style: "normal" },
    { file: "vollkorn-italic.ttf", weight: "400 900", style: "italic" },
  ] },
  condensed: { family: "Barlow Condensed", faces: [
    { file: "barlow-condensed-regular.ttf", weight: "400", style: "normal" },
    { file: "barlow-condensed-bold.ttf", weight: "700", style: "normal" },
    { file: "barlow-condensed-black.ttf", weight: "900", style: "normal" },
  ] },
  bodoni: { family: "Bodoni Moda", faces: [
    { file: "bodoni-moda.ttf", weight: "400 900", style: "normal" },
    { file: "bodoni-moda-italic.ttf", weight: "400 900", style: "italic" },
  ] },
  cinzel: { family: "Cinzel", faces: [
    { file: "cinzel.ttf", weight: "400 900", style: "normal" },
  ] },
  gothic: { family: "Grenze Gotisch", faces: [
    { file: "grenze-gotisch.ttf", weight: "100 900", style: "normal" },
  ] },
  fruktur: { family: "Fruktur", faces: [
    { file: "fruktur.ttf", weight: "400", style: "normal" },
  ] },
  grenze: { family: "Grenze", faces: [
    { file: "grenze.ttf", weight: "100 900", style: "normal" },
  ] },
  jacquardaBastarda9: { family: "Jacquarda Bastarda 9", faces: [
    { file: "jacquarda-bastarda-9.ttf", weight: "400", style: "normal" },
  ] },
  rakkas: { family: "Rakkas", faces: [
    { file: "rakkas.ttf", weight: "400", style: "normal" },
  ] },
  jainiPurva: { family: "Jaini Purva", faces: [
    { file: "jaini-purva.ttf", weight: "400", style: "normal" },
  ] },
  jaini: { family: "Jaini", faces: [
    { file: "jaini.ttf", weight: "400", style: "normal" },
  ] },
  jimNightshade: { family: "Jim Nightshade", faces: [
    { file: "jim-nightshade.ttf", weight: "400", style: "normal" },
  ] },
  risque: { family: "Risque", faces: [
    { file: "risque.ttf", weight: "400", style: "normal" },
  ] },
  stellaMystica: { family: "GL-StellaMystica", faces: [
    { file: "gl-stella-mystica.ttf", weight: "400", style: "normal" },
  ] },
  starTaker: { family: "GL-StarTaker", faces: [
    { file: "gl-startaker.ttf", weight: "400", style: "normal" },
  ] },
  newspaperText: { family: "Newspaper Text", faces: [
    { file: "newspaper-text.ttf", weight: "400", style: "normal" },
  ] },
  blaka: { family: "Blaka", faces: [
    { file: "blaka.ttf", weight: "400", style: "normal" },
  ] },
  blakaHollow: { family: "Blaka Hollow", faces: [
    { file: "blaka-hollow.ttf", weight: "400", style: "normal" },
  ] },
  blakaInk: { family: "Blaka Ink", faces: [
    { file: "blaka-ink.ttf", weight: "400", style: "normal" },
  ] },
  gothicGumDrop: { family: "Gothic GumDrop", faces: [
    { file: "gothic-gumdrop.ttf", weight: "400", style: "normal" },
  ] },
  germanCursive: { family: "GL-GermanCursive", faces: [
    { file: "gl-german-cursive.ttf", weight: "400", style: "normal" },
  ] },
  morris: { family: "GL-Morris", faces: [
    { file: "gl-morris.ttf", weight: "400", style: "normal" },
  ] },
  kjv1611: { family: "KJV1611", faces: [
    { file: "kjv1611.otf", weight: "400", style: "normal" },
  ] },
  slab: { family: "Roboto Slab", faces: [
    { file: "roboto-slab.ttf", weight: "100 900", style: "normal" },
  ] },
  manufacturingConsent: { family: "Manufacturing Consent", faces: [
    { file: "manufacturing-consent.ttf", weight: "400", style: "normal" },
  ] },
  kings: { family: "Kings", faces: [
    { file: "kings.ttf", weight: "400", style: "normal" },
  ] },
  medievalSharp: { family: "MedievalSharp", faces: [
    { file: "medievalsharp.ttf", weight: "400", style: "normal" },
  ] },
  pirataOne: { family: "Pirata One", faces: [
    { file: "pirata-one.ttf", weight: "400", style: "normal" },
  ] },
  almendra: { family: "Almendra", faces: [
    { file: "almendra.ttf", weight: "400", style: "normal" },
    { file: "almendra-bold.ttf", weight: "700", style: "normal" },
  ] },
  metamorphous: { family: "Metamorphous", faces: [
    { file: "metamorphous.ttf", weight: "400", style: "normal" },
  ] },
  eagleLake: { family: "Eagle Lake", faces: [
    { file: "eagle-lake.ttf", weight: "400", style: "normal" },
  ] },
  newRocker: { family: "New Rocker", faces: [
    { file: "new-rocker.ttf", weight: "400", style: "normal" },
  ] },
  fondamento: { family: "Fondamento", faces: [
    { file: "fondamento.ttf", weight: "400", style: "normal" },
    { file: "fondamento-italic.ttf", weight: "400", style: "italic" },
  ] },
  cormorantUnicase: { family: "Cormorant Unicase", faces: [
    { file: "cormorant-unicase.ttf", weight: "400", style: "normal" },
    { file: "cormorant-unicase-bold.ttf", weight: "700", style: "normal" },
  ] },
  berkshireSwash: { family: "Berkshire Swash", faces: [
    { file: "berkshire-swash.ttf", weight: "400", style: "normal" },
  ] },
  texturina: { family: "Texturina", faces: [
    { file: "texturina.ttf", weight: "100 900", style: "normal" },
    { file: "texturina-italic.ttf", weight: "100 900", style: "italic" },
  ] },
  caudex: { family: "Caudex", faces: [
    { file: "caudex.ttf", weight: "400", style: "normal" },
    { file: "caudex-bold.ttf", weight: "700", style: "normal" },
    { file: "caudex-italic.ttf", weight: "400", style: "italic" },
  ] },
  sancreek: { family: "Sancreek", faces: [
    { file: "sancreek.ttf", weight: "400", style: "normal" },
  ] },
  novaCut: { family: "Nova Cut", faces: [
    { file: "nova-cut.ttf", weight: "400", style: "normal" },
  ] },
} satisfies Record<string, FontSpec>;

type FontKey = keyof typeof FONTS;

/*
 * v1.0.7 qualified body-only substitutions are deliberately theme-scoped.
 * The original display/decorative families stay available to headings and
 * ornaments, while body text and drop caps use the families that passed the
 * compositor qualification matrix across PL, PL-dropcap and EN scenarios.
 */
const LEGACY_TO_BUILTIN: Array<[string, FontKey]> = [
  ["Folio Source Serif 4", "sourceSerif"], ["Folio Source Sans 3", "sourceSans"],
  ["Folio EB Garamond", "garamond"], ["Folio Libre Caslon Text", "caslon"],
  ["Folio Libre Baskerville", "baskerville"], ["Folio Newsreader", "newsreader"],
  ["Folio Vollkorn", "vollkorn"], ["Folio Barlow Condensed", "condensed"],
  ["Folio Bodoni Moda", "bodoni"], ["Folio Cinzel", "cinzel"],
  ["Folio Grenze Gotisch", "gothic"], ["Folio Roboto Slab", "slab"],
  ["Folio Manufacturing Consent", "manufacturingConsent"], ["Folio Kings", "kings"],
  ["Source Serif 4", "sourceSerif"], ["Source Sans 3", "sourceSans"],
  ["EB Garamond", "garamond"], ["Libre Caslon Text", "caslon"],
  ["Libre Baskerville", "baskerville"], ["Newsreader", "newsreader"], ["Gelasio", "gelasio"],
  ["Vollkorn", "vollkorn"], ["Barlow Condensed", "condensed"],
  ["Bodoni Moda", "bodoni"], ["Cinzel", "cinzel"],
  ["Grenze Gotisch", "gothic"], ["Roboto Slab", "slab"],
  ["Fruktur", "fruktur"], ["Grenze", "grenze"], ["Jacquarda Bastarda 9", "jacquardaBastarda9"],
  ["Rakkas", "rakkas"], ["Jaini Purva", "jainiPurva"], ["Jaini", "jaini"],
  ["Jim Nightshade", "jimNightshade"], ["Risque", "risque"],
  ["GL-StellaMystica", "stellaMystica"], ["GL-StarTaker", "starTaker"],
  ["Newspaper Text", "newspaperText"], ["Blaka", "blaka"], ["Blaka Hollow", "blakaHollow"],
  ["Blaka Ink", "blakaInk"], ["Gothic GumDrop", "gothicGumDrop"],
  ["GL-GermanCursive", "germanCursive"], ["GL-Morris", "morris"], ["KJV1611", "kjv1611"],
  ["Folio Fruktur", "fruktur"], ["Folio Grenze", "grenze"], ["Folio Jacquarda Bastarda 9", "jacquardaBastarda9"],
  ["Folio Rakkas", "rakkas"], ["Folio Jaini Purva", "jainiPurva"], ["Folio Jaini", "jaini"],
  ["Folio Jim Nightshade", "jimNightshade"], ["Folio Risque", "risque"],
  ["Folio GL-StellaMystica", "stellaMystica"], ["Folio GL-StarTaker", "starTaker"],
  ["Folio Newspaper Text", "newspaperText"], ["Folio Blaka", "blaka"], ["Folio Blaka Hollow", "blakaHollow"],
  ["Folio Blaka Ink", "blakaInk"], ["Folio Gothic GumDrop", "gothicGumDrop"],
  ["Folio GL-GermanCursive", "germanCursive"], ["Folio GL-Morris", "morris"], ["Folio KJV1611", "kjv1611"],
  ["MedievalSharp", "medievalSharp"], ["Pirata One", "pirataOne"],
  ["Almendra", "almendra"],
  ["Metamorphous", "metamorphous"], ["Eagle Lake", "eagleLake"],
  ["New Rocker", "newRocker"],
  ["Fondamento", "fondamento"],
  ["Cormorant Unicase", "cormorantUnicase"], ["Berkshire Swash", "berkshireSwash"],
  ["Texturina", "texturina"], ["Caudex", "caudex"],
  ["Sancreek", "sancreek"], ["Nova Cut", "novaCut"],

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
  ["Georgia", "gelasio"], ["Avenir", "sourceSans"], ["Didot", "bodoni"],
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

function fontFormat(file: string): "opentype" | "truetype" {
  return file.toLowerCase().endsWith(".otf") ? "opentype" : "truetype";
}

async function faceSource(file: string, target: FontTarget): Promise<string> {
  const format = fontFormat(file);
  if (target === "html") return `url('/theme-fonts/${file}') format('${format}')`;
  if (target === "epub") return `url('../fonts/${file}') format('${format}')`;
  const data = await fs.readFile(path.join(THEME_FONTS_DIR, file));
  return `url('data:${fontMime(file)};base64,${data.toString("base64")}') format('${format}')`;
}

async function fontFaceCss(spec: FontSpec, target: FontTarget): Promise<string> {
  const rules: string[] = [];
  const legacyFamily = "Folio " + spec.family;
  for (const face of spec.faces) {
    const src = await faceSource(face.file, target);
    rules.push(
      `@font-face{font-family:${JSON.stringify(spec.family)};src:${src};` +
      `font-weight:${face.weight};font-style:${face.style};font-display:block;}`,
    );
    // Backward compatibility only: projects saved before 3.1 may contain the
    // old prefixed family name. New UI and new project data never emit it.
    rules.push(
      `@font-face{font-family:${JSON.stringify(legacyFamily)};src:${src};` +
      `font-weight:${face.weight};font-style:${face.style};font-display:block;}`,
    );
  }
  return rules.join("\n");
}

export async function buildThemeRuntimeCss(
  theme: ThemeName,
  target: FontTarget,
  requestedFamilies: string[] = [],
): Promise<{ css: string; themeCss: string; fontCss: string; fontFiles: string[]; families: string[] }> {
  const source = await fs.readFile(themeCss(theme), "utf8");
  const normalized = normalizeThemeFontFamilies(source);
  const requested = new Set<FontKey>();
  for (const family of requestedFamilies) {
    const direct = (Object.entries(FONTS) as Array<[FontKey, FontSpec]>)
      .find(([, spec]) => spec.family === family)?.[0];
    const legacy = LEGACY_TO_BUILTIN.find(([name]) => name === family)?.[1];
    const key = direct ?? legacy;
    if (key) requested.add(key);
  }
  const keys = [...new Set<FontKey>([...normalized.used, ...requested])];
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

import type { ThemeName } from "./types.ts";

export interface ThemeConfig {
  name: ThemeName;
  label: string;
  description: string;
  sceneOrnament: string; // glyph(s) used for "* * *" scene breaks
  dropcap: boolean; // large initial letter on the first paragraph of a chapter
  chapterLabel: string;
  previewFont: string;
  previewHeadingFont: string;
  previewAccent: string;
  previewPaper: string;
}

export const THEMES: Record<ThemeName, ThemeConfig> = {
  classic: {
    name: "classic",
    label: "Classic",
    description: "Traditional serif body with understated centered chapter titles.",
    sceneOrnament: "* * *",
    dropcap: false,
    chapterLabel: "Chapter One",
    previewFont: "Georgia, serif",
    previewHeadingFont: "Georgia, serif",
    previewAccent: "#33312e",
    previewPaper: "#fbfaf6",
  },
  modern: {
    name: "modern",
    label: "Modern",
    description: "Clean sans-serif headings, generous spacing, minimalist scene breaks.",
    sceneOrnament: "•   •   •",
    dropcap: false,
    chapterLabel: "CHAPTER 01",
    previewFont: "Arial, sans-serif",
    previewHeadingFont: "Arial, sans-serif",
    previewAccent: "#20262c",
    previewPaper: "#ffffff",
  },
  decorative: {
    name: "decorative",
    label: "Decorative",
    description: "Serif body with drop caps and a floral ornament between scenes.",
    sceneOrnament: "❧",
    dropcap: true,
    chapterLabel: "Chapter One",
    previewFont: "Baskerville, Georgia, serif",
    previewHeadingFont: "Baskerville, Georgia, serif",
    previewAccent: "#9a6a32",
    previewPaper: "#fffdf7",
  },
  literary: {
    name: "literary", label: "Literary", description: "Quiet old-style typography with a restrained offset opening.",
    sceneOrnament: "⁂", dropcap: true, chapterLabel: "CHAPTER ONE", previewFont: "Garamond, Georgia, serif",
    previewHeadingFont: "Garamond, Georgia, serif", previewAccent: "#493f36", previewPaper: "#fbf8f0",
  },
  editorial: {
    name: "editorial", label: "Editorial", description: "High-contrast magazine typography with crisp rules and block openings.",
    sceneOrnament: "◆", dropcap: false, chapterLabel: "01 / CHAPTER", previewFont: "Georgia, serif",
    previewHeadingFont: "Arial, sans-serif", previewAccent: "#a52d2d", previewPaper: "#fff",
  },
  heritage: {
    name: "heritage", label: "Heritage", description: "Formal book typography with roman numerals and engraved ornaments.",
    sceneOrnament: "❦", dropcap: true, chapterLabel: "CHAPTER I", previewFont: "Baskerville, Georgia, serif",
    previewHeadingFont: "Baskerville, Georgia, serif", previewAccent: "#6f4930", previewPaper: "#faf5e8",
  },
  scholar: {
    name: "scholar", label: "Scholar", description: "Measured academic styling with clear hierarchy and compact notes.",
    sceneOrnament: "§", dropcap: false, chapterLabel: "CHAPTER 1", previewFont: "Cambria, Georgia, serif",
    previewHeadingFont: "Cambria, Georgia, serif", previewAccent: "#263d56", previewPaper: "#fcfcfb",
  },
  folio: {
    name: "folio", label: "Folio", description: "Folio's balanced signature style: warm serif text and precise openings.",
    sceneOrnament: "◇", dropcap: true, chapterLabel: "ONE", previewFont: "Palatino, Georgia, serif",
    previewHeadingFont: "Avenir, Arial, sans-serif", previewAccent: "#856744", previewPaper: "#fcfaf5",
  },
  ivory: {
    name: "ivory", label: "Ivory", description: "Airy cream-page design with delicate italics and generous margins.",
    sceneOrnament: "· · ·", dropcap: false, chapterLabel: "Chapter One", previewFont: "Garamond, Georgia, serif",
    previewHeadingFont: "Garamond, Georgia, serif", previewAccent: "#8c765b", previewPaper: "#fffaf0",
  },
  nocturne: {
    name: "nocturne", label: "Nocturne", description: "Elegant dark-ink drama with moonlike ornaments and narrow titles.",
    sceneOrnament: "☾", dropcap: true, chapterLabel: "NIGHT I", previewFont: "Baskerville, Georgia, serif",
    previewHeadingFont: "Didot, Georgia, serif", previewAccent: "#39445f", previewPaper: "#f5f5f3",
  },
  cloister: {
    name: "cloister", label: "Cloister", description: "Medieval restraint with rubric accents and manuscript proportions.",
    sceneOrnament: "✠", dropcap: true, chapterLabel: "CAPUT I", previewFont: "Garamond, Georgia, serif",
    previewHeadingFont: "Georgia, serif", previewAccent: "#7b2724", previewPaper: "#fbf3df",
  },
  blackletter: {
    name: "blackletter", label: "Blackletter", description: "Gothic display openings paired with a highly readable serif body.",
    sceneOrnament: "❧", dropcap: true, chapterLabel: "I", previewFont: "Georgia, serif",
    previewHeadingFont: "UnifrakturCook, Georgia, serif", previewAccent: "#251d1a", previewPaper: "#f4ecda",
  },
  parchment: {
    name: "parchment", label: "Parchment", description: "Warm historical pages with ink-brown type and hand-set character.",
    sceneOrnament: "~ ✦ ~", dropcap: true, chapterLabel: "The First Chapter", previewFont: "Palatino, Georgia, serif",
    previewHeadingFont: "Palatino, Georgia, serif", previewAccent: "#8a4f2d", previewPaper: "#f6ead0",
  },
  atlas: {
    name: "atlas", label: "Atlas", description: "Expedition-journal styling with utilitarian sans headings and maplike rules.",
    sceneOrnament: "— ◉ —", dropcap: false, chapterLabel: "FIELD 01", previewFont: "Georgia, serif",
    previewHeadingFont: "Arial Narrow, Arial, sans-serif", previewAccent: "#31594e", previewPaper: "#f4f2e8",
  },
  stanza: {
    name: "stanza", label: "Stanza", description: "Poetry-minded proportions, ragged text and lyrical centered openings.",
    sceneOrnament: "⁕", dropcap: false, chapterLabel: "I", previewFont: "Baskerville, Georgia, serif",
    previewHeadingFont: "Baskerville, Georgia, serif", previewAccent: "#6f5573", previewPaper: "#fff",
  },
  aubade: {
    name: "aubade", label: "Aubade", description: "Bright morning palette with graceful italic headings and open leading.",
    sceneOrnament: "✺", dropcap: true, chapterLabel: "DAWN ONE", previewFont: "Palatino, Georgia, serif",
    previewHeadingFont: "Baskerville, Georgia, serif", previewAccent: "#c47c36", previewPaper: "#fffaf1",
  },
  ember: {
    name: "ember", label: "Ember", description: "Forceful rust accents and muscular chapter openings for genre fiction.",
    sceneOrnament: "◆", dropcap: true, chapterLabel: "CHAPTER ONE", previewFont: "Georgia, serif",
    previewHeadingFont: "Arial Black, Arial, sans-serif", previewAccent: "#a33f25", previewPaper: "#fbf7f1",
  },
  cinder: {
    name: "cinder", label: "Cinder", description: "Cool monochrome minimalism with condensed headings and hard scene cuts.",
    sceneOrnament: "■", dropcap: false, chapterLabel: "01", previewFont: "Cambria, Georgia, serif",
    previewHeadingFont: "Arial Narrow, Arial, sans-serif", previewAccent: "#4b5055", previewPaper: "#f5f5f4",
  },
  solstice: {
    name: "solstice", label: "Solstice", description: "Geometric seasonal ornament, wide tracking and ceremonial openings.",
    sceneOrnament: "✦", dropcap: true, chapterLabel: "SOLSTICE I", previewFont: "Georgia, serif",
    previewHeadingFont: "Avenir, Arial, sans-serif", previewAccent: "#526b78", previewPaper: "#f8faf8",
  },
  timber: {
    name: "timber", label: "Timber", description: "Earthy, sturdy typography with slab-like headings and practical spacing.",
    sceneOrnament: "◆ ◆ ◆", dropcap: false, chapterLabel: "CHAPTER 1", previewFont: "Charter, Georgia, serif",
    previewHeadingFont: "Rockwell, Georgia, serif", previewAccent: "#59452f", previewPaper: "#f7f1e5",
  },
};

export function hasTheme(name: string): name is ThemeName {
  return Object.prototype.hasOwnProperty.call(THEMES, name);
}

export function getTheme(name: string): ThemeConfig {
  return THEMES[hasTheme(name) ? name : "classic"];
}

export function themeList(): ThemeConfig[] {
  return Object.values(THEMES);
}

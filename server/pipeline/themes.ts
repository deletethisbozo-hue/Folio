import type { ThemeName } from "./types.ts";

export interface ThemeConfig {
  name: ThemeName;
  label: string;
  description: string;
  sceneOrnament: string;
  dropcap: boolean;
  chapterLabel: string;
  previewFont: string;
  previewHeadingFont: string;
  previewAccent: string;
  previewPaper: string;
}

export const THEMES: Record<ThemeName, ThemeConfig> = {
  classic: {
    name: "classic", label: "Black Psalter",
    description: "Editorial dark-gothic codex: bone paper, cathedral-black opener, oxblood rubrication and engraved tracery.",
    sceneOrnament: "◆", dropcap: true, chapterLabel: "LIBER I",
    previewFont: "Garamond, serif", previewHeadingFont: "UnifrakturCook, serif",
    previewAccent: "#741b22", previewPaper: "#f4eddf",
  },
  modern: {
    name: "modern", label: "Modern", description: "Clean sans-serif headings, generous spacing, minimalist scene breaks.",
    sceneOrnament: "•   •   •", dropcap: false, chapterLabel: "CHAPTER 01", previewFont: "Arial, sans-serif",
    previewHeadingFont: "Arial, sans-serif", previewAccent: "#20262c", previewPaper: "#ffffff",
  },
  decorative: {
    name: "decorative", label: "Decorative", description: "Serif body with drop caps and a floral ornament between scenes.",
    sceneOrnament: "❧", dropcap: true, chapterLabel: "Chapter One", previewFont: "Baskerville, Georgia, serif",
    previewHeadingFont: "Baskerville, Georgia, serif", previewAccent: "#9a6a32", previewPaper: "#fffdf7",
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
    name: "cloister", label: "Mortuary Chronicle",
    description: "Funerary gothic annal: bone paper, soot-black woodcut rules, oxblood rubrication and grave archival hierarchy.",
    sceneOrnament: "◆", dropcap: true, chapterLabel: "CAPITVLVM I",
    previewFont: "Libre Caslon Text, serif", previewHeadingFont: "Cinzel, serif",
    previewAccent: "#721a21", previewPaper: "#f0e7d5",
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
  obsidian: {
    name: "obsidian", label: "Obsidian", description: "Razor-black fantasy typography with a faceted ceremonial opening.",
    sceneOrnament: "◆", dropcap: true, chapterLabel: "SHARD I", previewFont: "Baskerville, Georgia, serif",
    previewHeadingFont: "Didot, Georgia, serif", previewAccent: "#17171b", previewPaper: "#f1f0ed",
  },
  bloodmoon: {
    name: "bloodmoon", label: "Blood Moon", description: "Crimson lunar accents and dramatic high-contrast gothic chapter pages.",
    sceneOrnament: "◉", dropcap: true, chapterLabel: "MOON I", previewFont: "Garamond, Georgia, serif",
    previewHeadingFont: "Bodoni MT, Didot, Georgia, serif", previewAccent: "#771f26", previewPaper: "#f8f1ec",
  },
  grimoire: {
    name: "grimoire", label: "Grimoire", description: "Arcane manuscript proportions, double rules and sigil-like ornaments.",
    sceneOrnament: "☙ ❦ ❧", dropcap: true, chapterLabel: "BOOK I", previewFont: "Palatino, Georgia, serif",
    previewHeadingFont: "Book Antiqua, Palatino, serif", previewAccent: "#4b315d", previewPaper: "#f4eddc",
  },
  cathedral: {
    name: "cathedral", label: "Cathedral", description: "Tall architectural headings framed by restrained Gothic tracery.",
    sceneOrnament: "✠", dropcap: true, chapterLabel: "CHAPTER I", previewFont: "Baskerville, Georgia, serif",
    previewHeadingFont: "Old English Text MT, Georgia, serif", previewAccent: "#293543", previewPaper: "#f3f1e9",
  },
  necropolis: {
    name: "necropolis", label: "Necropolis", description: "Monumental Roman capitals and stone-cut rules for dark epic fiction.",
    sceneOrnament: "— ◈ —", dropcap: false, chapterLabel: "TABLET I", previewFont: "Cambria, Georgia, serif",
    previewHeadingFont: "Trajan Pro, Times New Roman, serif", previewAccent: "#44464b", previewPaper: "#f0efeb",
  },
  wyrmwood: {
    name: "wyrmwood", label: "Wyrmwood", description: "Woodcut-inspired forest fantasy with an asymmetric storybook opening.",
    sceneOrnament: "❧", dropcap: true, chapterLabel: "TALE ONE", previewFont: "Charter, Georgia, serif",
    previewHeadingFont: "Palatino, Georgia, serif", previewAccent: "#35503a", previewPaper: "#f2efe2",
  },
  runestone: {
    name: "runestone", label: "Runestone", description: "Angular Nordic display type and carved dividers with a clean reading face.",
    sceneOrnament: "◇ ◆ ◇", dropcap: false, chapterLabel: "RUNE 01", previewFont: "Georgia, serif",
    previewHeadingFont: "Copperplate, Arial Narrow, sans-serif", previewAccent: "#405868", previewPaper: "#f2f5f3",
  },
  witchlight: {
    name: "witchlight", label: "Witchlight", description: "Elegant occult fantasy with violet ink, star points and whispered italics.",
    sceneOrnament: "✦", dropcap: true, chapterLabel: "HEX I", previewFont: "Garamond, Georgia, serif",
    previewHeadingFont: "Baskerville, Georgia, serif", previewAccent: "#60446f", previewPaper: "#f7f3f6",
  },
  ironbound: {
    name: "ironbound", label: "Ironbound", description: "Heavy forged headings, boxed numerals and disciplined military-fantasy rhythm.",
    sceneOrnament: "■", dropcap: false, chapterLabel: "01", previewFont: "Charter, Georgia, serif",
    previewHeadingFont: "Rockwell, Arial Black, serif", previewAccent: "#333b3d", previewPaper: "#f4f1e9",
  },
  revenant: {
    name: "revenant", label: "Revenant", description: "Pale spectral restraint, narrow titles and a haunting offset chapter mark.",
    sceneOrnament: "☾", dropcap: true, chapterLabel: "RETURN I", previewFont: "Baskerville, Georgia, serif",
    previewHeadingFont: "Didot, Georgia, serif", previewAccent: "#52616b", previewPaper: "#f1f4f3",
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

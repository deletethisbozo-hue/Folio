// Core data model shared across the pipeline.

export type ThemeName =
  | "modern"
  | "decorative"
  | "literary"
  | "editorial"
  | "heritage"
  | "scholar"
  | "folio"
  | "ivory"
  | "nocturne"
  | "cloister"
  | "blackletter"
  | "parchment"
  | "atlas"
  | "stanza"
  | "aubade"
  | "ember"
  | "cinder"
  | "solstice"
  | "timber"
  | "obsidian"
  | "bloodmoon"
  | "grimoire"
  | "cathedral"
  | "necropolis"
  | "wyrmwood"
  | "runestone"
  | "witchlight"
  | "ironbound";
export type PresetName = "kdp" | "universal";

export interface BookMeta {
  title: string;
  subtitle?: string;
  author: string;
  series?: string;
  series_index?: number | string;
  publisher?: string;
  language: string;
  isbn?: string;
  description?: string;
  copyright?: string;
  rights?: string;
  cover?: string; // path relative to baseDir (as authored)
  theme: ThemeName;
}

export type SectionKind =
  | "titlepage"
  | "copyright"
  | "frontmatter"
  | "chapter"
  | "backmatter";

export interface Section {
  id: string; // unique slug, used as anchor / epub split id
  title: string; // used for the navigation TOC
  subtitle?: string; // optional second line under the title (e.g. POV name, tagline)
  kind: SectionKind;
  className?: string; // extra body class, e.g. "dedication", "epigraph"
  toc: boolean; // include in the navigation TOC
  showTitle: boolean; // render the title as a visible heading
  markdown: string; // body markdown (no leading H1, no YAML frontmatter)
  generated?: boolean; // produced from metadata (titlepage / copyright)
  /** Exact source retained during ingest; never exposed by the public API. */
  sourcePath?: string;
  /** H1 index when several editable sections live in one Markdown source. */
  sourceOrdinal?: number;
  /** Original chapter position retained when live preview renders one section. */
  chapterNumber?: number;
}

export interface FontDef {
  file: string; // absolute path to the font file
  family: string; // CSS font-family name to register
  weight?: string | number;
  style?: string;
}

export interface StyleDef {
  font?: string; // CSS font-family (a registered family or a stack)
  size?: string; // e.g. "1.05em"
  color?: string;
  align?: string; // left | center | right
}

export interface ChapterTitleStyle {
  size?: string; // e.g. "1.8em"
  case?: "normal" | "smallcaps" | "uppercase";
  align?: "left" | "center" | "right";
  style?: "normal" | "italic";
  showLabel?: boolean;
  labelText?: string;
}

export interface ThemeLabImage {
  dataUrl?: string;
  name?: string;
  width?: number; // percent of the text column
  height?: number; // em
  opacity?: number; // 0..1
  gap?: number; // em
  placement?: "above" | "below";
}

export interface ThemeLabConfig {
  enabled?: boolean;
  name?: string;
  paper?: string;
  ink?: string;
  accent?: string;
  bodyFont?: string;
  bodySize?: number; // em
  lineHeight?: number;
  bodyAlign?: "left" | "justify";
  paragraphIndent?: number; // em
  paragraphSpacing?: number; // em
  headingFont?: string;
  headingColor?: string;
  headingSize?: number; // em
  headingWeight?: 400 | 500 | 600 | 700 | 800 | 900;
  headingTracking?: number; // em
  headingAlign?: "left" | "center" | "right";
  headingCase?: "normal" | "smallcaps" | "uppercase";
  headingStyle?: "normal" | "italic";
  headingTop?: number; // em
  headingBottom?: number; // em
  subtitleSize?: number; // em
  subtitleAlign?: "left" | "center" | "right";
  subtitleStyle?: "normal" | "italic";
  subtitleTracking?: number; // em
  subtitleColor?: string;
  labelVisible?: boolean;
  labelText?: string;
  labelSize?: number; // em, relative to heading
  labelTracking?: number; // em
  labelColor?: string;
  dropcap?: boolean;
  dropcapSize?: "small" | "large";
  dropcapFont?: string;
  sceneOrnament?: string;
  sceneSize?: number; // em
  sceneColor?: string;
  chapterRule?: "none" | "top" | "bottom" | "left" | "box";
  ruleWidth?: number; // px
  ruleColor?: string;
  titlePageFont?: string;
  titlePageAlign?: "left" | "center" | "right";
  titlePageSize?: number; // em
  chapterOrnament?: ThemeLabImage;
  sceneImage?: ThemeLabImage;
}

export interface Typography {
  themeLab?: ThemeLabConfig;
  bodyFont?: string; // family name (registered custom or system stack)
  headingFont?: string;
  fontSize?: string; // base size, e.g. "12pt"
  lineHeight?: number | string;
  dropcap?: boolean; // override the theme default
  dropcapSize?: "small" | "large"; // explicit size override; undefined = theme default
  dropcapFont?: string; // built-in or custom font family for the opening initial
  sceneOrnament?: string; // override the theme ornament
  chapterTitle?: ChapterTitleStyle;
  bodyAlign?: "left" | "justify";
  paragraphIndent?: string;
  paragraphSpacing?: string;
  paragraphAfterBreakIndent?: string;
  titlePageFont?: string;
}

export interface Book {
  meta: BookMeta;
  sections: Section[];
  baseDir: string; // absolute folder the book was loaded from
  coverPath?: string; // absolute path to cover image, if any
  fonts: FontDef[]; // custom fonts to embed
  styles: Record<string, StyleDef>; // per-class style overrides (journal, letter, …)
  typography: Typography; // per-book typography overrides
}

export interface IngestWarning {
  message: string;
}

export interface IngestResult {
  book: Book;
  warnings: IngestWarning[];
}

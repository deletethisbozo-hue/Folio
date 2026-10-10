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
  cover?: string;
  theme: string;
}

export interface SectionSummary {
  id: string;
  title: string;
  kind: string;
  toc: boolean;
}

export interface SectionDocument {
  id: string;
  title: string;
  subtitle?: string;
  kind: string;
  markdown: string;
  editable: boolean;
}

export interface BookConfig {
  frontmatter: string[];
  backmatter: string[];
  chapters: string | null;
}

export interface ChapterTitleStyle {
  size?: string;
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
  align?: "left" | "center" | "right";
  offsetX?: number; // px; visual translation
  offsetY?: number; // px; visual translation
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
  chapterRule?: "none" | "top" | "bottom" | "top-bottom" | "left" | "right" | "box" | "double" | "dashed" | "dotted" | "shadow" | "corners";
  ruleWidth?: number; // px
  ruleLength?: number; // % of text width
  rulePadding?: number; // em
  ruleRadius?: number; // px
  ruleColor?: string;
  titlePageFont?: string;
  titlePageAlign?: "left" | "center" | "right";
  titlePageSize?: number; // em
  chapterOrnament?: ThemeLabImage;
  sceneImage?: ThemeLabImage;
}

export interface ThemeLibraryEntry {
  id: string;
  label: string;
  baseTheme: string;
  config: ThemeLabConfig;
  createdAt: number;
  updatedAt: number;
}

export interface CustomFontRecord {
  id: string;
  family: string;
  originalName: string;
  filename: string;
  format: "truetype" | "opentype";
  createdAt: number;
}

export interface Typography {
  themeLab?: ThemeLabConfig;
  bodyFont?: string;
  headingFont?: string;
  fontSize?: string;
  lineHeight?: number | string;
  dropcap?: boolean;
  dropcapSize?: "small" | "large";
  dropcapFont?: string;
  sceneOrnament?: string;
  chapterTitle?: ChapterTitleStyle;
  bodyAlign?: "left" | "justify";
  paragraphIndent?: string;
  paragraphSpacing?: string;
  paragraphAfterBreakIndent?: string;
  titlePageFont?: string;
}

export interface ProjectSummary {
  projectId: string;
  meta: BookMeta;
  sections: SectionSummary[];
  warnings: string[];
  hasCover: boolean;
  bodyChars: number;
  fontFamilies: string[];
  typography: Typography;
  source: "folio" | "folder" | "upload" | "sample";
  folder: string | null;
  projectFile?: string | null;
  editable: boolean;
  config: BookConfig | null;
  bluesOutput: string | null;
}

export interface MatterType {
  key: string;
  label: string;
  placement: "frontmatter" | "backmatter";
  file: string;
}

export interface Trim {
  key: string;
  label: string;
  w: number;
  h: number;
}

export interface PrintLayout {
  key: string;
  label: string;
}

export interface PrintOptions {
  trim: string;
  binding: "paperback" | "hardcover";
  startChaptersRecto: boolean;
  layout: string;
  gutter?: number;
}

export interface Theme {
  name: string;
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

export interface Preset {
  name: string;
  label: string;
  description: string;
  embedFonts: boolean;
  sizeWarnBytes: number;
}

export interface ValidationMessage {
  severity: "error" | "warning" | "info";
  text: string;
}

export interface ValidationReport {
  tool: "epubcheck" | "builtin";
  valid: boolean;
  messages: ValidationMessage[];
  note?: string;
}

export interface ExportResult {
  written?: boolean;
  needsConfirm?: boolean;
  message?: string;
  filename?: string;
  mime?: string;
  dataBase64?: string;
  bytes: number;
  path?: string;
  version?: number;
  archived?: string[];
  overwrote?: boolean;
  validation?: ValidationReport;
  pages?: number;
  gutter?: number;
  totalPages?: number;
  firstChapter?: number;
  lastChapter?: number;
  totalChapters?: number;
  round?: number;
  maxRounds?: number;
  roundWarning?: string | null;
}

export interface PrintPreviewResult {
  html: string;
  pages: number;
  gutter: number;
}

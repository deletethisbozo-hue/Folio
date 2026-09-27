export type WriteStudioTab = "session" | "research" | "comments" | "history" | "find" | "analysis";

export interface WritingTargets {
  book: number | null;
  daily: number | null;
  session: number | null;
  chapters: Record<string, number>;
}

export interface ResearchNote {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchImage {
  id: string;
  filename: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  storedName: string;
  createdAt: string;
}

export interface WritingComment {
  id: string;
  sectionId: string;
  quote: string;
  prefix?: string;
  suffix?: string;
  body: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RevisionSummary {
  id: string;
  sectionId: string;
  scope: "section" | "book";
  kind: "auto" | "snapshot";
  label?: string;
  sectionCount?: number;
  createdAt: string;
  wordCount: number;
  chars: number;
  hash: string;
}

export interface WriteStudioState {
  version: 1;
  targets: WritingTargets;
  dailyProgress: Record<string, number>;
  research: ResearchNote[];
  researchImages: ResearchImage[];
  comments: WritingComment[];
  revisions: RevisionSummary[];
}

export interface RevisionPayload {
  revision: RevisionSummary;
  markdown?: string;
  sections?: Array<{
    id: string;
    kind: string;
    title: string;
    subtitle?: string;
    source: string;
    sourceOrdinal?: number;
    markdown: string;
  }>;
}

export interface SelectionCapture {
  quote: string;
  prefix: string;
  suffix: string;
}

export interface SessionStats {
  startedAt: number;
  gross: number;
  deleted: number;
}

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface RepeatedWord {
  word: string;
  count: number;
}

export interface NearbyRepeat {
  word: string;
  count: number;
  windowWords: number;
}

const COMMON_EN = new Set("the a an and or but if then than of to in on at by for from with without into onto is are was were be been being it its this that these those i you he she they we me him her them us my your his their our as not no do does did have has had can could would should will just very so".split(" "));
const COMMON_PL = new Set("i a ale albo lub oraz że to ten ta te tego tej tych w we z ze do na o od po za dla przy przez bez pod nad jest są był była było były być nie tak jak co czy się ja ty on ona oni one my wy mi ci mu jej im mnie ciebie go ją nas was mój moja moje twój twoja twoje jego ich nasz wasz".split(" "));

export function wordCount(text: string): number {
  return text.trim().match(/\S+/g)?.length ?? 0;
}

export function todayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function tokenise(text: string): string[] {
  return (text.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu) ?? [])
    .map((word) => word.replace(/^[’'-]+|[’'-]+$/g, ""))
    .filter(Boolean);
}

export function repeatedWords(text: string, language = "en"): RepeatedWord[] {
  const stop = language.toLowerCase().startsWith("pl") ? COMMON_PL : COMMON_EN;
  const counts = new Map<string, number>();
  for (const word of tokenise(text)) {
    if (word.length < 3 || stop.has(word) || /^\d+$/.test(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, 80);
}

export function nearbyRepetitions(text: string, language = "en", windowWords = 80): NearbyRepeat[] {
  const stop = language.toLowerCase().startsWith("pl") ? COMMON_PL : COMMON_EN;
  const words = tokenise(text);
  const positions = new Map<string, number[]>();
  const best = new Map<string, number>();

  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (word.length < 3 || stop.has(word) || /^\d+$/.test(word)) continue;
    const queue = positions.get(word) ?? [];
    queue.push(index);
    while (queue.length && index - queue[0] > windowWords) queue.shift();
    positions.set(word, queue);
    if (queue.length >= 3) best.set(word, Math.max(best.get(word) ?? 0, queue.length));
  }

  return [...best.entries()]
    .map(([word, count]) => ({ word, count, windowWords }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, 60);
}

export function buildSearchRegex(query: string, options: SearchOptions, global = true): RegExp {
  if (!query) throw new Error("Enter text to find.");
  const source = options.regex ? query : query.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&");
  const wrapped = options.wholeWord ? "\\b(?:" + source + ")\\b" : source;
  return new RegExp(wrapped, (global ? "g" : "") + (options.caseSensitive ? "" : "i") + "u");
}

export function countMatches(text: string, query: string, options: SearchOptions): number {
  if (!query) return 0;
  const regex = buildSearchRegex(query, options, true);
  return [...text.matchAll(regex)].length;
}

export function replaceMatches(text: string, query: string, replacement: string, options: SearchOptions): string {
  return text.replace(buildSearchRegex(query, options, true), replacement);
}

export type DiffLine = { kind: "same" | "add" | "remove"; text: string };

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length > 350 || b.length > 350) {
    let prefix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
    let suffix = 0;
    while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
    return [
      ...a.slice(0, prefix).map((text) => ({ kind: "same" as const, text })),
      ...a.slice(prefix, a.length - suffix).map((text) => ({ kind: "remove" as const, text })),
      ...b.slice(prefix, b.length - suffix).map((text) => ({ kind: "add" as const, text })),
      ...a.slice(a.length - suffix).map((text) => ({ kind: "same" as const, text })),
    ];
  }

  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ kind: "same", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ kind: "remove", text: a[i++] }); }
    else { out.push({ kind: "add", text: b[j++] }); }
  }
  while (i < a.length) out.push({ kind: "remove", text: a[i++] });
  while (j < b.length) out.push({ kind: "add", text: b[j++] });
  return out;
}

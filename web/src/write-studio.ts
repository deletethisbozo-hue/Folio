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

export type SecondDraftBlockStatus = "active" | "rewritten" | "cut" | "later" | "keep" | "sent";
export type SecondDraftCarryStatus = "pending" | "used" | "dismissed";
export type SecondDraftIssueCategory = "pacing" | "continuity" | "dialogue" | "character" | "clarity" | "research" | "other";
export type SecondDraftReviewPassKey = "structure" | "continuity" | "pacing" | "character" | "dialogue" | "prose" | "facts";
export type SecondDraftRewriteIntent = "general" | "tighten" | "expand" | "clarify" | "voice" | "pacing" | "dialogue" | "emotion" | "continuity" | "description";

export interface SecondDraftPair {
  targetSectionId: string;
  sourceSectionId: string;
  sourceTextLength: number;
  sourceFingerprint: string;
  createdAt: string;
  updatedAt: string;
  sealedAt?: string;
  sealRevisionId?: string;
}

export interface SecondDraftBlock {
  id: string;
  targetSectionId: string;
  sourceSectionId: string;
  sourceStart: number;
  sourceEnd: number;
  sourceText: string;
  status: SecondDraftBlockStatus;
  targetStart?: number;
  targetEnd?: number;
  intent?: SecondDraftRewriteIntent;
  createdAt: string;
  updatedAt: string;
}

export interface SecondDraftCarryover {
  id: string;
  fromTargetSectionId: string;
  sourceSectionId: string;
  toTargetSectionId: string;
  sourceStart: number;
  sourceEnd: number;
  sourceText: string;
  status: SecondDraftCarryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SecondDraftIssue {
  id: string;
  targetSectionId: string;
  sourceSectionId: string;
  sourceStart: number;
  sourceEnd: number;
  sourceText: string;
  category: SecondDraftIssueCategory;
  note: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SecondDraftState {
  pairs: Record<string, SecondDraftPair>;
  blocks: SecondDraftBlock[];
  carryovers: SecondDraftCarryover[];
  issues: SecondDraftIssue[];
  reviews: Record<string, Partial<Record<SecondDraftReviewPassKey, boolean>>>;
  briefs: Record<string, string>;
}

export interface SecondDraftSealReveal {
  sourceWords: number;
  targetWords: number;
  rewritten: number;
  cut: number;
  kept: number;
  sentAhead: number;
  processedPercent: number;
}

export interface WriteStudioState {
  version: 2;
  targets: WritingTargets;
  dailyProgress: Record<string, number>;
  research: ResearchNote[];
  researchImages: ResearchImage[];
  comments: WritingComment[];
  revisions: RevisionSummary[];
  secondDraft: SecondDraftState;
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
  activeMs: number;
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

export type RepetitionSeverity = "low" | "medium" | "high";

export interface NearbyRepeat {
  word: string;
  count: number;
  windowWords: number;
  spanWords: number;
  severity: RepetitionSeverity;
}

export interface RepetitionOccurrence {
  word: string;
  start: number;
  end: number;
  count: number;
  spanWords: number;
  severity: RepetitionSeverity;
}

export interface NearbyPhraseRepeat {
  phrase: string;
  count: number;
  words: number;
  windowWords: number;
  spanWords: number;
}

export interface PhraseOccurrence {
  phrase: string;
  start: number;
  end: number;
  count: number;
  words: number;
  spanWords: number;
}

const COMMON_EN = new Set("the a an and or but if then than of to in on at by for from with without into onto is are was were be been being it its this that these those i you he she they we me him her them us my your his their our as not no do does did have has had can could would should will just very so".split(" "));
const COMMON_PL = new Set("i a ale albo lub oraz że to ten ta te tego tej tych w we z ze do na o od po za dla przy przez bez pod nad jest są był była było były być nie tak jak co czy się ja ty on ona oni one my wy mi ci mu jej im mnie ciebie go ją nas was mój moja moje twój twoja twoje jego ich nasz wasz".split(" "));
const COMMON_DE = new Set("der die das ein eine einer eines einen einem und oder aber wenn dann als von zu in im an auf bei für aus mit ohne ist sind war waren sein gewesen es dies diese dieser dieses ich du er sie wir ihr ihnen mein dein sein ihr unser euer nicht kein keine auch so wie was wer".split(" "));
const COMMON_FR = new Set("le la les un une des et ou mais si alors de du au aux en dans sur sous avec sans est sont était étaient être été ce cette ces ceci cela je tu il elle nous vous ils elles mon ma mes ton ta tes son sa ses notre votre leur ne pas".split(" "));
const COMMON_ES = new Set("el la los las un una unos unas y o pero si entonces de del al en sobre con sin por para desde es son era eran ser sido esto esta este estos estas yo tú tu él ella nosotros nosotras vosotros vosotras ellos ellas mi mis tu tus su sus nuestro nuestra no".split(" "));

function stopWords(language: string): Set<string> {
  const code = language.toLowerCase();
  if (code.startsWith("pl")) return COMMON_PL;
  if (code.startsWith("de")) return COMMON_DE;
  if (code.startsWith("fr")) return COMMON_FR;
  if (code.startsWith("es")) return COMMON_ES;
  return COMMON_EN;
}

export function wordCount(text: string): number {
  return text.trim().match(/\S+/g)?.length ?? 0;
}

export function todayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

interface LexicalToken {
  word: string;
  start: number;
  end: number;
  wordIndex: number;
  segment: number;
}

function normalizeAnalysisWord(word: string): string {
  return word
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/^[\-']+|[\-']+$/g, "");
}

function tokeniseWithOffsets(text: string): LexicalToken[] {
  const tokens: LexicalToken[] = [];
  const regex = /[\p{L}\p{N}][\p{L}\p{N}’'ʼ`-]*/gu;
  let match: RegExpExecArray | null;
  let previousEnd = 0;
  let segment = 0;
  while ((match = regex.exec(text))) {
    if (tokens.length) {
      const separator = text.slice(previousEnd, match.index);
      // Nearby phrases never bridge sentence/paragraph boundaries. Commas and
      // quotation marks are allowed so normal prose still behaves naturally.
      if (/[.!?;:\n\r]/u.test(separator)) segment++;
    }
    const word = normalizeAnalysisWord(match[0]);
    previousEnd = match.index + match[0].length;
    if (!word) continue;
    tokens.push({
      word,
      start: match.index,
      end: match.index + match[0].length,
      wordIndex: tokens.length,
      segment,
    });
  }
  return tokens;
}

function tokenise(text: string): string[] {
  return tokeniseWithOffsets(text).map((token) => token.word);
}

function eligibleAnalysisToken(token: LexicalToken, stop: Set<string>): boolean {
  return token.word.length >= 3 && !stop.has(token.word) && !/^\d+$/u.test(token.word);
}

function repetitionSeverity(count: number, spanWords: number, windowWords: number): RepetitionSeverity {
  if (
    count >= 5
    || (count >= 4 && spanWords <= Math.max(18, Math.round(windowWords * 0.7)))
    || (count >= 3 && spanWords <= Math.max(12, Math.round(windowWords * 0.35)))
  ) return "high";
  if (count >= 3 || spanWords <= 12) return "medium";
  return "low";
}

export function repetitionOccurrences(text: string, language = "en", windowWords = 80): RepetitionOccurrence[] {
  const safeWindow = Math.max(12, Math.min(500, Math.round(windowWords)));
  const tightPairWindow = Math.max(8, Math.min(28, Math.round(safeWindow * 0.3)));
  const stop = stopWords(language);
  const tokens = tokeniseWithOffsets(text);
  const grouped = new Map<string, LexicalToken[]>();

  for (const token of tokens) {
    if (!eligibleAnalysisToken(token, stop)) continue;
    const list = grouped.get(token.word) ?? [];
    list.push(token);
    grouped.set(token.word, list);
  }

  const marked = new Map<number, RepetitionOccurrence>();
  const rank: Record<RepetitionSeverity, number> = { low: 1, medium: 2, high: 3 };

  for (const [word, occurrences] of grouped) {
    if (occurrences.length < 2) continue;
    let right = 0;
    for (let left = 0; left < occurrences.length; left++) {
      if (right < left + 1) right = left + 1;
      while (
        right < occurrences.length
        && occurrences[right].wordIndex - occurrences[left].wordIndex + 1 <= safeWindow
      ) right++;

      const count = right - left;
      if (count < 2) continue;
      const spanWords = occurrences[right - 1].wordIndex - occurrences[left].wordIndex + 1;
      const notable = count >= 3 || (count === 2 && spanWords <= tightPairWindow);
      if (!notable) continue;

      const severity = repetitionSeverity(count, spanWords, safeWindow);
      for (let index = left; index < right; index++) {
        const token = occurrences[index];
        const next: RepetitionOccurrence = {
          word,
          start: token.start,
          end: token.end,
          count,
          spanWords,
          severity,
        };
        const previous = marked.get(token.start);
        if (
          !previous
          || rank[next.severity] > rank[previous.severity]
          || (rank[next.severity] === rank[previous.severity] && next.count > previous.count)
          || (rank[next.severity] === rank[previous.severity] && next.count === previous.count && next.spanWords < previous.spanWords)
        ) marked.set(token.start, next);
      }
    }
  }

  return [...marked.values()].sort((a, b) => a.start - b.start);
}


type PhraseBaseOccurrence = {
  start: number;
  end: number;
  startWord: number;
  endWord: number;
};

type PhraseAnalysisGroup = {
  summary: NearbyPhraseRepeat;
  occurrences: PhraseBaseOccurrence[];
  selected: Set<number>;
};

function phraseContainsPhrase(longer: string, shorter: string): boolean {
  return (" " + longer + " ").includes(" " + shorter + " ");
}

function collectNearbyPhraseAnalysis(text: string, language = "en", windowWords = 80): {
  summaries: NearbyPhraseRepeat[];
  occurrences: PhraseOccurrence[];
} {
  const safeWindow = Math.max(20, Math.min(500, Math.round(windowWords)));
  const stop = stopWords(language);
  const tokens = tokeniseWithOffsets(text);
  const groups = new Map<string, PhraseBaseOccurrence[]>();

  for (let words = 2; words <= 5; words++) {
    for (let start = 0; start + words <= tokens.length; start++) {
      const slice = tokens.slice(start, start + words);
      if (slice[0].segment !== slice[slice.length - 1].segment) continue;

      const contentWords = slice.filter((token) => eligibleAnalysisToken(token, stop));
      if (!contentWords.length) continue;

      const phrase = slice.map((token) => token.word).join(" ");
      const list = groups.get(phrase) ?? [];
      list.push({
        start: slice[0].start,
        end: slice[slice.length - 1].end,
        startWord: slice[0].wordIndex,
        endWord: slice[slice.length - 1].wordIndex,
      });
      groups.set(phrase, list);
    }
  }

  const analyzed: PhraseAnalysisGroup[] = [];
  for (const [phrase, occurrences] of groups) {
    if (occurrences.length < 2) continue;
    const words = phrase.split(" ").length;
    let bestCount = 0;
    let bestSpan = Number.POSITIVE_INFINITY;
    const selected = new Set<number>();
    let right = 0;

    for (let left = 0; left < occurrences.length; left++) {
      if (right < left + 1) right = left + 1;
      while (
        right < occurrences.length
        && occurrences[right].endWord - occurrences[left].startWord + 1 <= safeWindow
      ) right++;

      const count = right - left;
      if (count < 2) continue;
      const spanWords = occurrences[right - 1].endWord - occurrences[left].startWord + 1;
      if (count > bestCount || (count === bestCount && spanWords < bestSpan)) {
        bestCount = count;
        bestSpan = spanWords;
      }
      for (let index = left; index < right; index++) selected.add(index);
    }

    if (bestCount < 2 || !Number.isFinite(bestSpan)) continue;
    analyzed.push({
      summary: { phrase, count: bestCount, words, windowWords: safeWindow, spanWords: bestSpan },
      occurrences,
      selected,
    });
  }

  analyzed.sort((a, b) =>
    b.summary.words - a.summary.words
    || b.summary.count - a.summary.count
    || a.summary.spanWords - b.summary.spanWords
    || a.summary.phrase.localeCompare(b.summary.phrase));

  // Prefer the longest useful expression. If "he looked at her" repeats twice,
  // don't also flood the UI with "he looked", "looked at", etc. Keep a shorter
  // phrase only when it occurs more often than its longer parent.
  const accepted: PhraseAnalysisGroup[] = [];
  for (const candidate of analyzed) {
    const redundant = accepted.some((parent) =>
      parent.summary.words > candidate.summary.words
      && parent.summary.count >= candidate.summary.count
      && phraseContainsPhrase(parent.summary.phrase, candidate.summary.phrase)
    );
    if (!redundant) accepted.push(candidate);
    if (accepted.length >= 60) break;
  }

  const summaries = accepted
    .map((item) => item.summary)
    .sort((a, b) =>
      b.count - a.count
      || b.words - a.words
      || a.spanWords - b.spanWords
      || a.phrase.localeCompare(b.phrase));

  const occurrences: PhraseOccurrence[] = [];
  for (const group of accepted) {
    for (const index of group.selected) {
      const occurrence = group.occurrences[index];
      occurrences.push({
        phrase: group.summary.phrase,
        start: occurrence.start,
        end: occurrence.end,
        count: group.summary.count,
        words: group.summary.words,
        spanWords: group.summary.spanWords,
      });
    }
  }
  occurrences.sort((a, b) => a.start - b.start || b.words - a.words);

  return { summaries, occurrences };
}

export function nearbyPhrases(text: string, language = "en", windowWords = 80): NearbyPhraseRepeat[] {
  return collectNearbyPhraseAnalysis(text, language, windowWords).summaries;
}

export function nearbyPhraseOccurrences(text: string, language = "en", windowWords = 80): PhraseOccurrence[] {
  return collectNearbyPhraseAnalysis(text, language, windowWords).occurrences;
}

export function repeatedWords(text: string, language = "en"): RepeatedWord[] {
  const stop = stopWords(language);
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
  const rank: Record<RepetitionSeverity, number> = { low: 1, medium: 2, high: 3 };
  const best = new Map<string, NearbyRepeat>();

  for (const hit of repetitionOccurrences(text, language, windowWords)) {
    const next: NearbyRepeat = {
      word: hit.word,
      count: hit.count,
      windowWords: Math.max(12, Math.min(500, Math.round(windowWords))),
      spanWords: hit.spanWords,
      severity: hit.severity,
    };
    const previous = best.get(hit.word);
    if (
      !previous
      || rank[next.severity] > rank[previous.severity]
      || (rank[next.severity] === rank[previous.severity] && next.count > previous.count)
      || (rank[next.severity] === rank[previous.severity] && next.count === previous.count && next.spanWords < previous.spanWords)
    ) best.set(hit.word, next);
  }

  return [...best.values()]
    .sort((a, b) =>
      rank[b.severity] - rank[a.severity]
      || b.count - a.count
      || a.spanWords - b.spanWords
      || a.word.localeCompare(b.word))
    .slice(0, 60);
}

export function buildSearchRegex(query: string, options: SearchOptions, global = true): RegExp {
  if (!query) throw new Error("Enter text to find.");
  const source = options.regex ? query : query.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&");
  const wrapped = options.wholeWord ? "(?<![\\p{L}\\p{N}_])(?:" + source + ")(?![\\p{L}\\p{N}_])" : source;
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

export function replacementForMatch(source: string, match: RegExpMatchArray, replacement: string): string {
  const matched = match[0] ?? "";
  const position = match.index ?? 0;
  const captures = match.slice(1);
  const groups = match.groups;
  return replacement.replace(/\$([\$&`']|\d{1,2}|<[^>]+>)/g, (token, pattern: string) => {
    if (pattern === "$") return "$";
    if (pattern === "&") return matched;
    if (pattern === "`") return source.slice(0, position);
    if (pattern === "'") return source.slice(position + matched.length);
    if (pattern.startsWith("<") && pattern.endsWith(">")) {
      if (!groups) return token;
      const name = pattern.slice(1, -1);
      return Object.prototype.hasOwnProperty.call(groups, name) ? (groups[name] ?? "") : "";
    }
    if (/^\d{1,2}$/.test(pattern)) {
      let index = Number(pattern);
      if (index > 0 && index <= captures.length) return captures[index - 1] ?? "";
      if (pattern.length === 2) {
        index = Number(pattern[0]);
        if (index > 0 && index <= captures.length) return (captures[index - 1] ?? "") + pattern[1];
      }
      return token;
    }
    return token;
  });
}

export function markdownToReadableSnapshotText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*!\[([^\]]*)\]\([^)]+\)(?:\{[^}]*\})?\s*$/gm, (_match, alt: string) => alt?.trim() ? "[Illustration: " + alt.trim() + "]" : "[Illustration]")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)?[^)]+\)/g, "$1")
    .replace(/<\/?(?:u|span|mark|strong|em|s|code)(?:\s+[^>]*)?>/gi, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-+*]\s+/gm, "• ")
    .replace(/^\s*\d+[.)]\s+/gm, "• ")
    .replace(/^\s*(?:---|\* \* \*)\s*$/gm, "• • •")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/~~([^~\n]+)~~/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/(^|[^_])_([^_\n]+)_/g, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

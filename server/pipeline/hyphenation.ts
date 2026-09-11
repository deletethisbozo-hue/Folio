import type { Page } from "puppeteer";
import Hypher from "hypher";
import english from "hyphenation.en-us";
import polish from "hyphenation.pl";
import type { Book } from "./types.ts";

const engines = {
  en: new Hypher(english),
  pl: new Hypher(polish),
};
type HyphenationLanguage = keyof typeof engines;
type HyphenationLimits = { minimumWord: number; left: number; right: number };
const HYPHENATION_LIMITS: Record<HyphenationLanguage, HyphenationLimits> = {
  pl: { minimumWord: 4, left: 2, right: 2 },
  en: { minimumWord: 7, left: 3, right: 3 },
};
const WORD = /\p{L}(?:[\p{L}\u00ad]*\p{L})?/gu;

function languageKey(language: string): HyphenationLanguage {
  return /^pl(?:-|$)/i.test(language) ? "pl" : "en";
}

function engineFor(language: string): Hypher {
  return engines[languageKey(language)];
}

export function conservativeHyphenation(
  engine: Hypher,
  word: string,
  leftMinimum = HYPHENATION_LIMITS.en.left,
  rightMinimum = HYPHENATION_LIMITS.en.right,
  minimumWord = HYPHENATION_LIMITS.en.minimumWord,
): string {
  if (word.length < minimumWord) return word;
  const pieces = engine.hyphenate(word);
  if (pieces.length < 2) return word;
  const points: number[] = [];
  let offset = 0;
  for (let index = 0; index < pieces.length - 1; index++) {
    offset += pieces[index].length;
    if (offset >= leftMinimum && word.length - offset >= rightMinimum) points.push(offset);
  }
  if (!points.length) return word;
  let result = "";
  let start = 0;
  for (const point of points) {
    result += word.slice(start, point) + "\u00ad";
    start = point;
  }
  return result + word.slice(start);
}

function discretionaryWords(book: Book): Record<string, string> {
  const key = languageKey(book.meta.language);
  const engine = engineFor(book.meta.language);
  const limits = HYPHENATION_LIMITS[key];
  const words = new Set<string>();
  for (const section of book.sections) {
    if (section.kind !== "chapter" && section.kind !== "backmatter") continue;
    for (const match of section.markdown.matchAll(WORD)) {
      const word = match[0];
      if (word.includes("\u00ad") || word.length < limits.minimumWord) continue;
      words.add(word);
    }
  }
  const map: Record<string, string> = {};
  for (const word of words) {
    const hyphenated = conservativeHyphenation(engine, word, limits.left, limits.right, limits.minimumWord);
    if (hyphenated !== word) map[word] = hyphenated;
  }
  return map;
}

/** Deterministic language-aware hyphenation before Chromium/Paged.js lays out
 * print. Manual author soft hyphens survive untouched and protected inline
 * semantics are never rewritten. */
export async function applyProfessionalHyphenation(page: Page, book: Book): Promise<void> {
  if (book.typography.bodyAlign === "left") return;
  const key = languageKey(book.meta.language);
  const limits = HYPHENATION_LIMITS[key];
  const words = discretionaryWords(book);
  const polishBook = key === "pl";
  if (!Object.keys(words).length && !polishBook) return;
  await page.evaluate(({ map, polish, minimum }) => {
    const root = document.querySelector("main.book");
    if (!root) return;
    const selector = [
      "section.chapter > p:not(.scene-break)",
      "section.chapter > blockquote p",
      "section.chapter li",
      "section.backmatter > p:not(.scene-break)",
      "section.backmatter li",
    ].join(",");
    const protectedInline = "code,pre,a,em,strong,b,i,u,s,sup,sub,script,style,h1,h2,h3,h4,h5,h6,.scene-break,.dropcap,.math,[data-math]";

    for (const prose of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
      const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          return parent && !parent.closest(protectedInline)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      });
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      const capLetters = prose.querySelector<HTMLElement>(":scope > .dropcap")?.textContent?.match(/\p{L}/gu);
      const capLetter = capLetters?.[capLetters.length - 1] ?? "";
      const protectAfterDropcap = polish && /^[aAiIoOuUwWzZ]$/.test(capLetter);

      for (const [index, node] of nodes.entries()) {
        let text = node.data;
        if (polish) {
          if (protectAfterDropcap && index === 0) text = text.replace(/^[ \t]+(?=\p{L})/u, "\u00a0");
          text = text.replace(/(^|[\s\u00a0])([aAiIoOuUwWzZ]) (?=\p{L})/gu, "$1$2\u00a0");
        }
        node.data = text.replace(/\p{L}(?:[\p{L}\u00ad]*\p{L})?/gu, (candidate) => {
          if (candidate.includes("\u00ad")) return candidate;
          return candidate.length >= minimum ? (map[candidate] ?? candidate) : candidate;
        });
      }
    }
  }, { map: words, polish: polishBook, minimum: limits.minimumWord });
}

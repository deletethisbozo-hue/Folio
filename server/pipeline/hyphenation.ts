import type { Page } from "puppeteer";
import Hypher from "hypher";
import english from "hyphenation.en-us";
import polish from "hyphenation.pl";
import type { Book } from "./types.ts";

const engines = {
  en: new Hypher(english),
  pl: new Hypher(polish),
};

function engineFor(language: string): Hypher {
  return /^pl(?:-|$)/i.test(language) ? engines.pl : engines.en;
}

function conservativeHyphenation(engine: Hypher, word: string): string {
  const pieces = engine.hyphenate(word);
  if (pieces.length < 2) return word;
  const points: number[] = [];
  let offset = 0;
  for (let index = 0; index < pieces.length - 1; index++) {
    offset += pieces[index].length;
    if (offset >= 3 && word.length - offset >= 3) points.push(offset);
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
  const engine = engineFor(book.meta.language);
  const words = new Set<string>();
  for (const section of book.sections) {
    if (section.kind !== "chapter" && section.kind !== "backmatter") continue;
    for (const match of section.markdown.matchAll(/\p{L}{10,}/gu)) words.add(match[0]);
  }
  const map: Record<string, string> = {};
  for (const word of words) {
    const hyphenated = conservativeHyphenation(engine, word);
    if (hyphenated !== word) map[word] = hyphenated;
  }
  return map;
}

/** Deterministic language-aware hyphenation before Chromium/Paged.js lays out
 * print. Candidates are intentionally conservative so PDF/print matches the
 * restrained preview rather than filling a page with unnecessary hyphens. */
export async function applyProfessionalHyphenation(page: Page, book: Book): Promise<void> {
  if (book.typography.bodyAlign === "left") return;
  const words = discretionaryWords(book);
  const polishBook = /^pl(?:-|$)/i.test(book.meta.language);
  if (!Object.keys(words).length && !polishBook) return;
  await page.evaluate(({ map, polish }) => {
    const root = document.querySelector("main.book");
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest("code,pre,a,script,style,h1,h2,h3,.scene-break")) return NodeFilter.FILTER_REJECT;
        const proseSection = parent.closest("section.chapter, section.backmatter");
        return proseSection && parent.closest("p,li,blockquote") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      let text = node.data.replace(/\u00ad/g, "");
      if (polish) text = text.replace(/(^|[\s\u00a0])([aAiIoOuUwWzZ]) (?=\p{L})/gu, "$1$2\u00a0");
      node.data = text.replace(/\p{L}{10,}/gu, (word) => map[word] ?? word);
    }
  }, { map: words, polish: polishBook });
}

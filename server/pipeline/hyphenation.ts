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

function discretionaryWords(book: Book): Record<string, string> {
  const engine = engineFor(book.meta.language);
  const words = new Set<string>();
  for (const section of book.sections) {
    if (section.kind !== "chapter" && section.kind !== "backmatter") continue;
    for (const match of section.markdown.matchAll(/\p{L}{8,}/gu)) words.add(match[0]);
  }
  const map: Record<string, string> = {};
  for (const word of words) {
    const pieces = engine.hyphenate(word);
    if (pieces.length > 1) map[word] = pieces.join("\u00ad");
  }
  return map;
}

/** Deterministic language-aware hyphenation before Chromium/Paged.js lays out
 * print. Soft hyphens are discretionary and therefore invisible unless a word
 * actually needs to break at a line edge. */
export async function applyProfessionalHyphenation(page: Page, book: Book): Promise<void> {
  if (book.typography.bodyAlign === "left") return;
  const words = discretionaryWords(book);
  if (!Object.keys(words).length) return;
  await page.evaluate((map) => {
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
      if (node.data.includes("\u00ad")) continue;
      node.data = node.data.replace(/\p{L}{8,}/gu, (word) => map[word] ?? word);
    }
  }, words);
}

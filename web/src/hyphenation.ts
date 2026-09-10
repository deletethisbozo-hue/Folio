import Hypher from "hypher";
import english from "hyphenation.en-us";
import polish from "hyphenation.pl";

const engines = {
  en: new Hypher(english),
  pl: new Hypher(polish),
};

const PROSE_SELECTOR = [
  "section.chapter > p:not(.scene-break)",
  "section.chapter > blockquote p",
  "section.chapter li",
  "section.backmatter > p:not(.scene-break)",
  "section.backmatter li",
].join(",");
const PROTECTED_INLINE = "code,pre,a,em,strong,b,i,u,s,sup,sub,script,style,h1,h2,h3,h4,h5,h6,.scene-break,.dropcap,.math,[data-math]";
const WORD = /\p{L}(?:[\p{L}\u00ad]*\p{L})?/gu;

export function hyphenationLanguage(language: string): "pl" | "en" {
  return /^pl(?:-|$)/i.test(language) ? "pl" : "en";
}

function engineFor(language: string): Hypher {
  return engines[hyphenationLanguage(language)];
}

/** Pattern dictionaries expose many legal boundaries. Folio deliberately keeps
 * only conservative publishing candidates with at least three letters on both
 * sides. The compositor decides later whether a legal point is worth using. */
export function conservativeHyphenation(engine: Hypher, word: string): string {
  const pieces = engine.hyphenate(word);
  if (pieces.length < 2) return word;

  const points: number[] = [];
  let offset = 0;
  for (let index = 0; index < pieces.length - 1; index++) {
    offset += pieces[index].length;
    const remaining = word.length - offset;
    if (offset >= 3 && remaining >= 3) points.push(offset);
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

function applyDictionary(text: string, engine: Hypher): string {
  return text.replace(WORD, (candidate) => {
    // A soft hyphen already present in the manuscript belongs to the author.
    // Never erase it and never add dictionary points around it.
    if (candidate.includes("\u00ad")) return candidate;
    if (candidate.length < 10) return candidate;
    return conservativeHyphenation(engine, candidate);
  });
}

function dropcapLetter(root: Element): string {
  const letters = root.querySelector<HTMLElement>(":scope > .dropcap")?.textContent?.match(/\p{L}/gu);
  return letters?.[letters.length - 1] ?? "";
}

/** Apply language-aware discretionary hyphens to one prose element. Protected
 * semantic inline elements remain atomic: Folio never rewrites URLs, emphasis,
 * code, superscripts or other inline markup just to make a line fit. */
export function hyphenateElement(root: Element, language: string): void {
  const document = root.ownerDocument;
  const engine = engineFor(language);
  const polishText = hyphenationLanguage(language) === "pl";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      return parent && !parent.closest(PROTECTED_INLINE)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  // Drop caps move the initial into a separate span. Keep a Polish one-letter
  // preposition/conjunction tied to the following word even in that geometry.
  const protectAfterDropcap = polishText && /^[aAiIoOuUwWzZ]$/.test(dropcapLetter(root));

  for (const [index, node] of nodes.entries()) {
    let text = node.data;
    if (polishText) {
      if (protectAfterDropcap && index === 0) text = text.replace(/^[ \t]+(?=\p{L})/u, "\u00a0");
      text = text.replace(/(^|[\s\u00a0])([aAiIoOuUwWzZ]) (?=\p{L})/gu, "$1$2\u00a0");
    }
    node.data = applyDictionary(text, engine);
  }
}

/** Prepare only immediately useful prose synchronously. The compositor handles
 * later paragraphs as they approach the viewport, avoiding a whole-manuscript
 * layout pass after every edit. */
export function hyphenatePreviewDocument(document: Document, language: string): void {
  document.documentElement.lang = language || "en";
  const root = document.querySelector("main.book");
  if (!root) return;
  const paragraphs = Array.from(root.querySelectorAll<HTMLElement>(PROSE_SELECTOR));
  for (const paragraph of paragraphs.slice(0, 4)) hyphenateElement(paragraph, language);
}

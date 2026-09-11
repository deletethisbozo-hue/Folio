import Hypher from "hypher";
import english from "hyphenation.en-us";
import polish from "hyphenation.pl";

const engines = {
  en: new Hypher(english),
  pl: new Hypher(polish),
};

type HyphenationLanguage = keyof typeof engines;
type HyphenationLimits = { minimumWord: number; left: number; right: number };

const HYPHENATION_LIMITS: Record<HyphenationLanguage, HyphenationLimits> = {
  // TeX's maintained Polish patterns use lefthyphenmin=2 and
  // righthyphenmin=2. Keeping 3/3 here discarded valid Polish breaks and
  // forced the compositor into visibly ragged emergency lines.
  pl: { minimumWord: 4, left: 2, right: 2 },
  // U.S. English TeX convention: lefthyphenmin=2, righthyphenmin=3.
  en: { minimumWord: 5, left: 2, right: 3 },
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

export function hyphenationLanguage(language: string): HyphenationLanguage {
  return /^pl(?:-|$)/i.test(language) ? "pl" : "en";
}

function engineFor(language: string): Hypher {
  return engines[hyphenationLanguage(language)];
}

/** Keep only dictionary breakpoints that respect language-specific fragment
 * minima. Polish follows TeX 2/2; U.S. English follows the standard 2/3
 * convention used by the corresponding TeX hyphenation patterns. */
export function conservativeHyphenation(
  engine: Hypher,
  word: string,
  leftMinimum = HYPHENATION_LIMITS.en.left,
  rightMinimum = HYPHENATION_LIMITS.en.right,
  minimumWord = 6,
): string {
  if (word.length < minimumWord) return word;
  const pieces = engine.hyphenate(word);
  if (pieces.length < 2) return word;

  const points: number[] = [];
  let offset = 0;
  for (let index = 0; index < pieces.length - 1; index++) {
    offset += pieces[index].length;
    const remaining = word.length - offset;
    if (offset >= leftMinimum && remaining >= rightMinimum) points.push(offset);
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

function applyDictionary(text: string, engine: Hypher, limits: HyphenationLimits): string {
  return text.replace(WORD, (candidate) => {
    if (candidate.includes("\u00ad")) return candidate;
    return conservativeHyphenation(engine, candidate, limits.left, limits.right, limits.minimumWord);
  });
}

function dropcapLetter(root: Element): string {
  const letters = root.querySelector<HTMLElement>(":scope > .dropcap")?.textContent?.match(/\p{L}/gu);
  return letters?.[letters.length - 1] ?? "";
}

/** Apply language-aware discretionary hyphens to one prose element. Links and
 * styled semantic inlines stay atomic, so improving line breaks can never eat
 * formatting or split an URL. */
export function hyphenateElement(root: Element, language: string): void {
  const document = root.ownerDocument;
  const languageKey = hyphenationLanguage(language);
  const engine = engines[languageKey];
  const limits = HYPHENATION_LIMITS[languageKey];
  const polishText = languageKey === "pl";
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

  const protectAfterDropcap = polishText && /^[aAiIoOuUwWzZ]$/.test(dropcapLetter(root));

  for (const [index, node] of nodes.entries()) {
    let text = node.data;
    if (polishText) {
      if (protectAfterDropcap && index === 0) text = text.replace(/^[ \t]+(?=\p{L})/u, "\u00a0");
      text = text.replace(/(^|[\s\u00a0])([aAiIoOuUwWzZ]) (?=\p{L})/gu, "$1$2\u00a0");
    }
    node.data = applyDictionary(text, engine, limits);
  }
}

/** Prepare only the first visible prose synchronously. The compositor continues
 * near the viewport in small batches so large chapters remain responsive. */
export function hyphenatePreviewDocument(document: Document, language: string): void {
  document.documentElement.lang = language || "en";
  const root = document.querySelector("main.book");
  if (!root) return;
  const paragraphs = Array.from(root.querySelectorAll<HTMLElement>(PROSE_SELECTOR));
  for (const paragraph of paragraphs.slice(0, 4)) hyphenateElement(paragraph, language);
}

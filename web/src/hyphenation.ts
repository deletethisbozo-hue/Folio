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

function engineFor(language: string): Hypher {
  return /^pl(?:-|$)/i.test(language) ? engines.pl : engines.en;
}

/** Pattern dictionaries intentionally expose many legal syllable boundaries.
 * Folio keeps only conservative book-typography candidates: long words, with
 * at least three real letters on both sides of a discretionary break. */
function conservativeHyphenation(engine: Hypher, word: string): string {
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

/** Apply language-aware discretionary hyphens to one prose element. Exported
 * so the lazy compositor can prepare paragraphs only when they approach the
 * viewport instead of rewriting an entire 100k-word chapter after every key. */
export function hyphenateElement(root: Element, language: string): void {
  const document = root.ownerDocument;
  const engine = engineFor(language);
  const polishText = /^pl(?:-|$)/i.test(language);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      return parent && !parent.closest("code,pre,a,script,style,h1,h2,h3,.scene-break,.dropcap")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  // A drop cap turns the first letter into its own span. For Polish prose that
  // must not defeat the one-letter-word rule: "W Polsce" still needs a NBSP
  // even though W and the following space now live in separate text nodes.
  const dropcap = root.querySelector<HTMLElement>(":scope > .dropcap");
  const protectAfterDropcap = polishText && /^[aAiIoOuUwWzZ]$/.test(dropcap?.textContent?.trim() ?? "");

  for (const [index, node] of nodes.entries()) {
    let text = node.data.replace(/\u00ad/g, "");
    if (polishText) {
      if (protectAfterDropcap && index === 0) text = text.replace(/^[ \t]+(?=\p{L})/u, "\u00a0");
      text = text.replace(/(^|[\s\u00a0])([aAiIoOuUwWzZ]) (?=\p{L})/gu, "$1$2\u00a0");
    }
    node.data = text.replace(/\p{L}{10,}/gu, (word) => conservativeHyphenation(engine, word));
  }
}

/** Prepare only the first few paragraphs synchronously. Everything else is
 * hyphenated by the lazy compositor when it approaches the viewport. Avoiding
 * getBoundingClientRect() over the whole chapter removes a forced full-layout
 * pass after every edit in very large manuscripts. */
export function hyphenatePreviewDocument(document: Document, language: string): void {
  // The live draft can change language before the next authoritative server
  // preview arrives. Keep the iframe's semantic language in lockstep with the
  // language we were explicitly asked to typeset, because the compositor reads
  // documentElement.lang when it re-hyphenates a paragraph. Without this, a
  // freshly pasted Polish manuscript could be pre-hyphenated as Polish and then
  // immediately recomposed as English depending on network timing.
  document.documentElement.lang = language || "en";
  const root = document.querySelector("main.book");
  if (!root) return;
  const paragraphs = Array.from(root.querySelectorAll<HTMLElement>(PROSE_SELECTOR));
  for (const paragraph of paragraphs.slice(0, 4)) hyphenateElement(paragraph, language);
}

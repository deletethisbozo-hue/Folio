import Hypher from "hypher";
import english from "hyphenation.en-us";
import polish from "hyphenation.pl";

const engines = {
  en: new Hypher(english),
  pl: new Hypher(polish),
};

function engineFor(language: string): Hypher {
  return /^pl(?:-|$)/i.test(language) ? engines.pl : engines.en;
}

/** Keep only typographically useful discretionary breaks. Pattern dictionaries
 * intentionally expose many legal syllable boundaries; using every one of them
 * makes a novel look mechanically hyphenated and gives the compositor too many
 * tempting breakpoints. Folio therefore keeps a conservative subset: long
 * words only, with at least three real letters on both sides of a break. */
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

/** Insert discretionary soft hyphens only into prose text nodes. Native CSS
 * hyphenation is inconsistent between Windows Chromium builds; explicit
 * language patterns make the preview deterministic without changing copied
 * text or the saved Markdown source. Breaks are deliberately conservative so
 * they improve bad lines rather than appearing on every other line. */
export function hyphenatePreviewDocument(document: Document, language: string): void {
  const root = document.querySelector("main.book");
  if (!root) return;
  const engine = engineFor(language);
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
    if (/^pl(?:-|$)/i.test(language)) {
      node.data = node.data.replace(/(^|[\s\u00a0])([aAiIoOuUwWzZ]) (?=\p{L})/gu, "$1$2\u00a0");
    }
    if (node.data.includes("\u00ad")) continue;
    node.data = node.data.replace(/\p{L}{10,}/gu, (word) => conservativeHyphenation(engine, word));
  }
}

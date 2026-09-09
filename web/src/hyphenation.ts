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

/** Insert discretionary soft hyphens only into prose text nodes. Native CSS
 * hyphenation is inconsistent between Windows Chromium builds; explicit
 * language patterns make the preview deterministic and remove justification
 * rivers without changing copied text or the saved Markdown source. */
export function hyphenatePreviewDocument(document: Document, language: string): void {
  const root = document.querySelector("main.book");
  if (!root) return;
  const engine = engineFor(language);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest("code,pre,a,script,style,h1,h2,h3,.scene-break")) return NodeFilter.FILTER_REJECT;
      return parent.closest("p,li,blockquote") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    if (/^pl(?:-|$)/i.test(language)) {
      node.data = node.data.replace(/(^|[\s\u00a0])([aAiIoOuUwWzZ]) (?=\p{L})/gu, "$1$2\u00a0");
    }
    if (node.data.includes("\u00ad")) continue;
    node.data = node.data.replace(/\p{L}{8,}/gu, (word) => {
      const pieces = engine.hyphenate(word);
      return pieces.length > 1 ? pieces.join("\u00ad") : word;
    });
  }
}

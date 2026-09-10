import { hyphenateElement } from "./hyphenation";

const PROSE_SELECTORS = [
  "section.chapter > p:not(.scene-break)",
  "section.chapter > blockquote p",
  "section.chapter li",
  "section.backmatter > p:not(.scene-break)",
  "section.backmatter li",
];
const PROSE_SELECTOR = PROSE_SELECTORS.join(",");
const ATOMIC_INLINE = "a,em,strong,b,i,u,s,sup,sub";
const compositionGeneration = new WeakMap<Document, number>();
const compositionObservers = new WeakMap<Document, IntersectionObserver>();

type Word = {
  node: HTMLElement;
  width: number;
  spaceBefore: boolean;
  hyphenBefore: boolean;
  canBreakBefore: boolean;
  characters: number;
};
type Break = {
  end: number;
  justified: boolean;
  wordSpacing: number;
  tracking: number;
  hyphenated: boolean;
};
type State = Break & {
  cost: number;
  from: number;
  fromKey: number;
};

function pixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function restore(paragraph: HTMLElement): void {
  const original = paragraph.dataset.folioOriginalHtml;
  if (original !== undefined) {
    paragraph.innerHTML = original;
    delete paragraph.dataset.folioOriginalHtml;
  }
  paragraph.classList.remove("folio-composed", "folio-compositor-safe-fallback");
}

function ensureFallbackStyle(document: Document): void {
  let style = document.getElementById("folio-compositor-fallback") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "folio-compositor-fallback";
    document.head.appendChild(style);
  }
  const pending = PROSE_SELECTORS.map((selector) => `${selector}:not(.folio-composed)`).join(",");
  style.textContent = `${pending}{text-align:left!important;text-align-last:left!important;-webkit-hyphens:manual!important;hyphens:manual!important;overflow-wrap:normal!important;word-break:normal!important;word-spacing:normal!important;letter-spacing:normal!important;text-wrap:pretty!important}.scene-break{display:block!important;text-align:center!important;text-align-last:center!important;word-spacing:normal!important;letter-spacing:normal!important}`;
}

function tokenize(paragraph: HTMLElement): Word[] {
  const document = paragraph.ownerDocument;
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      return parent && !parent.closest(".dropcap,code,pre,script,style,.math,[data-math]")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  let separated = true;
  let hasWord = false;
  for (const textNode of textNodes) {
    const fragment = document.createDocumentFragment();
    for (const part of textNode.data.split(/([ \t\r\n]+)/)) {
      if (!part) continue;
      if (/^[ \t\r\n]+$/.test(part)) {
        separated = true;
        fragment.append(" ");
        continue;
      }

      part.split("\u00ad").forEach((piece, index) => {
        if (!piece) return;
        const span = document.createElement("span");
        const discretionary = index > 0;
        span.className = "folio-word";
        span.dataset.folioSpaceBefore = hasWord && separated ? "true" : "false";
        span.dataset.folioHyphenBefore = discretionary ? "true" : "false";
        span.textContent = (discretionary ? "\u00ad" : "") + piece;
        span.style.whiteSpace = "nowrap";
        fragment.append(span);
        hasWord = true;
        separated = false;
      });
    }
    textNode.replaceWith(fragment);
  }

  const nodes = Array.from(paragraph.querySelectorAll<HTMLElement>(".folio-word"));
  const atomicIds = new WeakMap<Element, number>();
  let nextAtomicId = 1;
  let previousAtomic = 0;
  return nodes.map((node) => {
    const atomic = node.closest(ATOMIC_INLINE);
    let atomicId = 0;
    if (atomic) {
      atomicId = atomicIds.get(atomic) ?? nextAtomicId++;
      atomicIds.set(atomic, atomicId);
    }
    const spaceBefore = node.dataset.folioSpaceBefore === "true";
    const hyphenBefore = node.dataset.folioHyphenBefore === "true";
    const canBreakBefore = hyphenBefore || (spaceBefore && !(atomicId && atomicId === previousAtomic));
    const word: Word = {
      node,
      width: node.getBoundingClientRect().width,
      spaceBefore,
      hyphenBefore,
      canBreakBefore,
      characters: (node.textContent ?? "").replace(/\u00ad/g, "").length,
    };
    previousAtomic = atomicId;
    return word;
  });
}

function boundedAdjustment(
  adjustment: number,
  gaps: number,
  trackingOps: number,
  spaceWidth: number,
  fontSize: number,
): { wordSpacing: number; tracking: number } | null {
  if (gaps <= 0) return null;
  const maxWordSpacing = Math.min(fontSize * 0.18, Math.max(0.55, spaceWidth * 0.68));
  const minWordSpacing = -Math.min(fontSize * 0.028, Math.max(0.18, spaceWidth * 0.10));
  const maxTracking = fontSize * 0.0125;
  const minTracking = -fontSize * 0.009;
  let tracking = trackingOps > 0 ? Math.max(minTracking, Math.min(maxTracking, adjustment / trackingOps)) : 0;
  let wordSpacing = (adjustment - tracking * trackingOps) / gaps;
  if (wordSpacing > maxWordSpacing || wordSpacing < minWordSpacing) {
    wordSpacing = Math.max(minWordSpacing, Math.min(maxWordSpacing, wordSpacing));
    tracking = trackingOps > 0 ? (adjustment - wordSpacing * gaps) / trackingOps : 0;
  }
  if (wordSpacing > maxWordSpacing + 0.001 || wordSpacing < minWordSpacing - 0.001) return null;
  if (tracking > maxTracking + 0.001 || tracking < minTracking - 0.001) return null;
  return { wordSpacing, tracking };
}

function chooseBreaks(
  words: Word[],
  fullWidth: number,
  spaceWidth: number,
  hyphenWidth: number,
  indent: number,
  capWidth: number,
  capLines: number,
  fontSize: number,
): Break[] {
  const count = words.length;
  const states: Array<Map<number, State>> = Array.from({ length: count + 1 }, () => new Map());
  states[0].set(0, {
    cost: 0, from: -1, fromKey: -1, end: 0,
    justified: false, wordSpacing: 0, tracking: 0, hyphenated: false,
  });

  for (let start = 0; start < count; start++) {
    for (const [stateKey, previous] of states[start]) {
      const line = Math.floor(stateKey / 2);
      const available = Math.max(fontSize * 5, fullWidth - (line === 0 ? indent : 0) - (line < capLines ? capWidth : 0));
      let wordWidth = 0;
      let gaps = 0;
      let characters = 0;
      for (let end = start; end < count; end++) {
        wordWidth += words[end].width;
        characters += words[end].characters;
        if (end > start && words[end].spaceBefore) gaps++;
        const last = end === count - 1;
        const next = last ? null : words[end + 1];
        const canBreak = last || next!.canBreakBefore;
        const hyphenBreak = !last && next!.hyphenBefore;
        const natural = wordWidth + gaps * spaceWidth + (hyphenBreak ? hyphenWidth : 0);
        if (natural > available + Math.max(1, fontSize * 0.08) && end > start) break;
        if (!canBreak) continue;
        const adjustment = available - natural;
        const trackingOps = Math.max(0, characters + gaps - 1);
        const fit = !last && natural <= available + 1
          ? boundedAdjustment(adjustment, gaps, trackingOps, spaceWidth, fontSize)
          : null;
        const justified = !last && fit !== null;
        const leftover = Math.max(0, adjustment) / Math.max(1, available);
        const hyphenPenalty = hyphenBreak ? 48 + (previous.hyphenated ? 190 : 0) : 0;
        const deformation = fit
          ? Math.pow(fit.wordSpacing / Math.max(1, fontSize * 0.18), 2)
            + Math.pow(fit.tracking / Math.max(0.01, fontSize * 0.0125), 2) * 0.45
          : 0;
        const cost = previous.cost + hyphenPenalty + (last
          ? 4 * leftover * leftover
          : justified
            ? 22 * deformation
            : 180 + 150 * leftover * leftover + (gaps < 2 ? 95 : 0));
        const nextLine = line + 1;
        const nextKey = nextLine * 2 + (hyphenBreak ? 1 : 0);
        const old = states[end + 1].get(nextKey);
        if (!old || cost < old.cost) {
          states[end + 1].set(nextKey, {
            cost,
            from: start,
            fromKey: stateKey,
            end: end + 1,
            justified,
            wordSpacing: justified ? fit!.wordSpacing : 0,
            tracking: justified ? fit!.tracking : 0,
            hyphenated: hyphenBreak,
          });
        }
      }
    }
  }

  let bestKey = -1;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const [key, state] of states[count]) {
    if (state.cost < bestCost) { bestCost = state.cost; bestKey = key; }
  }
  if (bestKey < 0) return [{ end: count, justified: false, wordSpacing: 0, tracking: 0, hyphenated: false }];

  const reversed: Break[] = [];
  let end = count;
  let key = bestKey;
  while (end > 0) {
    const state = states[end].get(key)!;
    reversed.push({
      end,
      justified: state.justified,
      wordSpacing: state.wordSpacing,
      tracking: state.tracking,
      hyphenated: state.hyphenated,
    });
    end = state.from;
    key = state.fromKey;
  }
  return reversed.reverse();
}

function cloneLineFragment(document: Document, words: Word[], start: number, end: number): DocumentFragment {
  const range = document.createRange();
  range.setStartBefore(words[start].node);
  range.setEndAfter(words[end - 1].node);
  return range.cloneContents();
}

function composeParagraph(paragraph: HTMLElement, language: string): void {
  if (
    paragraph.closest(".chapter-subtitle,.note,.telegram,.sign,.inscription,.verse,.poem,.msg") ||
    paragraph.querySelector("br,img,svg,code,pre,.math,[data-math]")
  ) return;
  if (paragraph.dataset.folioOriginalHtml !== undefined) restore(paragraph);

  const style = getComputedStyle(paragraph);
  const fullWidth = paragraph.clientWidth;
  const fontSize = pixels(style.fontSize) || 16;
  if (fullWidth < fontSize * 8) return;
  const estimatedWords = paragraph.textContent?.trim().split(/\s+/).length ?? 0;
  if (estimatedWords > 1400) {
    paragraph.classList.add("folio-compositor-safe-fallback");
    return;
  }

  paragraph.dataset.folioOriginalHtml = paragraph.innerHTML;
  hyphenateElement(paragraph, language);
  const indent = Math.max(0, pixels(style.textIndent));
  const lineHeight = pixels(style.lineHeight) || fontSize * 1.5;
  const cap = paragraph.querySelector<HTMLElement>(":scope > .dropcap");
  const capRect = cap?.getBoundingClientRect();
  const capStyle = cap ? getComputedStyle(cap) : null;
  const capWidth = capRect
    ? capRect.width + pixels(capStyle?.marginLeft ?? "0") + pixels(capStyle?.marginRight ?? "0")
    : 0;
  const capDepth = capRect
    ? capRect.height + pixels(capStyle?.marginTop ?? "0") + pixels(capStyle?.marginBottom ?? "0")
    : 0;
  const capLines = capRect ? Math.max(1, Math.ceil(capDepth / lineHeight)) : 0;

  const probe = paragraph.ownerDocument.createElement("span");
  probe.textContent = " -";
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${style.font};letter-spacing:${style.letterSpacing};word-spacing:${style.wordSpacing}`;
  paragraph.ownerDocument.body.appendChild(probe);
  const pairWidth = probe.getBoundingClientRect().width;
  probe.textContent = " ";
  const spaceWidth = probe.getBoundingClientRect().width || fontSize * 0.25;
  const hyphenWidth = Math.max(fontSize * 0.2, pairWidth - spaceWidth);
  probe.remove();

  const words = tokenize(paragraph);
  if (!words.length) { restore(paragraph); return; }
  const breaks = chooseBreaks(words, fullWidth, spaceWidth, hyphenWidth, cap ? 0 : indent, capWidth, capLines, fontSize);
  const baseWordSpacing = pixels(style.wordSpacing);
  const baseTracking = pixels(style.letterSpacing);
  const lines: HTMLElement[] = [];
  let start = 0;
  for (const [lineIndex, lineBreak] of breaks.entries()) {
    const line = paragraph.ownerDocument.createElement("span");
    line.className = `folio-composed-line ${lineBreak.justified ? "folio-line-justified" : "folio-line-natural"}`;
    line.append(cloneLineFragment(paragraph.ownerDocument, words, start, lineBreak.end));
    if (lineBreak.end < words.length && words[lineBreak.end].hyphenBefore) line.append("-");
    if (lineBreak.justified) {
      line.style.wordSpacing = `${baseWordSpacing + lineBreak.wordSpacing}px`;
      line.style.letterSpacing = `${baseTracking + lineBreak.tracking}px`;
      line.dataset.folioWordSpacing = String(lineBreak.wordSpacing);
      line.dataset.folioTracking = String(lineBreak.tracking);
    }
    if (lineIndex === 0 && !cap && indent) line.style.marginLeft = `${indent}px`;
    if (lineIndex === 0 || lineIndex === breaks.length - 2) line.style.breakAfter = "avoid";
    lines.push(line);
    start = lineBreak.end;
  }

  paragraph.classList.add("folio-composed");
  paragraph.replaceChildren(...(cap ? [cap] : []));
  lines.forEach((line, index) => {
    paragraph.append(line);
    if (index < lines.length - 1 && !breaks[index].hyphenated) paragraph.append(" ");
  });
}

function installObserver(
  document: Document,
  paragraphs: HTMLElement[],
  queue: HTMLElement[],
  queued: WeakSet<HTMLElement>,
  generation: number,
  language: string,
): void {
  const view = document.defaultView;
  if (!view) return;
  let scheduled = false;
  let observer: IntersectionObserver;

  const request = () => {
    if (scheduled || compositionGeneration.get(document) !== generation) return;
    scheduled = true;
    view.requestAnimationFrame(run);
  };

  const run = () => {
    scheduled = false;
    if (compositionGeneration.get(document) !== generation) return;
    const started = view.performance.now();
    let processed = 0;
    while (queue.length && processed < 2 && view.performance.now() - started < 8) {
      const paragraph = queue.shift()!;
      if (!paragraph.isConnected) continue;
      observer.unobserve(paragraph);
      composeParagraph(paragraph, language);
      processed++;
    }
    if (queue.length) request();
  };

  observer = new view.IntersectionObserver((entries) => {
    if (compositionGeneration.get(document) !== generation) return;
    for (const entry of entries) {
      const paragraph = entry.target as HTMLElement;
      if (entry.isIntersecting && !queued.has(paragraph)) {
        queued.add(paragraph);
        queue.push(paragraph);
      }
    }
    if (queue.length) request();
  }, { root: null, rootMargin: "1600px 0px", threshold: 0 });
  compositionObservers.set(document, observer);
  for (const paragraph of paragraphs) observer.observe(paragraph);
  if (queue.length) request();
}

export async function composePreviewDocument(document: Document, enabled: boolean): Promise<void> {
  const generation = (compositionGeneration.get(document) ?? 0) + 1;
  compositionGeneration.set(document, generation);
  compositionObservers.get(document)?.disconnect();
  compositionObservers.delete(document);

  if (!enabled) {
    document.querySelectorAll<HTMLElement>(`${PROSE_SELECTOR}[data-folio-original-html]`).forEach(restore);
    document.getElementById("folio-compositor-fallback")?.remove();
    return;
  }

  ensureFallbackStyle(document);
  const language = document.documentElement.lang || "en";
  const paragraphs = Array.from(document.querySelectorAll<HTMLElement>(PROSE_SELECTOR));
  const view = document.defaultView;
  if (!view || !paragraphs.length) return;
  const queue: HTMLElement[] = [];
  const queued = new WeakSet<HTMLElement>();
  for (const paragraph of paragraphs.slice(0, 3)) {
    queued.add(paragraph);
    queue.push(paragraph);
  }
  const first = queue.shift();
  if (first && compositionGeneration.get(document) === generation) composeParagraph(first, language);
  installObserver(document, paragraphs, queue, queued, generation, language);
  if (document.fonts?.status === "loading") {
    void document.fonts.ready.then(() => {
      if (compositionGeneration.get(document) === generation) void composePreviewDocument(document, true);
    }).catch(() => undefined);
  }
}

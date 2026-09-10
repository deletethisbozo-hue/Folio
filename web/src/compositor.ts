import { hyphenateElement } from "./hyphenation";

const PROSE_SELECTORS = [
  "section.chapter > p:not(.scene-break)",
  "section.chapter > blockquote p",
  "section.chapter li",
  "section.backmatter > p:not(.scene-break)",
  "section.backmatter li",
];
const PROSE_SELECTOR = PROSE_SELECTORS.join(",");
const compositionGeneration = new WeakMap<Document, number>();
const compositionObservers = new WeakMap<Document, IntersectionObserver>();

type Word = {
  node: HTMLElement;
  width: number;
  /** No source whitespace before this fragment. */
  joinBefore: boolean;
  /** This fragment follows an actual discretionary soft-hyphen point. */
  hyphenBefore: boolean;
};
type Break = { end: number; justified: boolean; wordSpacing: number };

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
  paragraph.classList.remove("folio-composed");
}

function ensureFallbackStyle(document: Document): void {
  let style = document.getElementById("folio-compositor-fallback") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "folio-compositor-fallback";
    document.head.appendChild(style);
  }
  // Off-screen paragraphs use Chromium's cheap justification temporarily. They
  // are upgraded to the paragraph-wide compositor before entering the viewport.
  // No per-paragraph marker is needed, which avoids thousands of DOM writes.
  const pending = PROSE_SELECTORS.map((selector) => `${selector}:not(.folio-composed)`).join(",");
  style.textContent = `${pending}{text-align:justify!important;text-align-last:left!important;-webkit-hyphens:manual!important;hyphens:manual!important;overflow-wrap:normal!important;word-break:normal!important;word-spacing:normal!important}`;
}

function tokenize(paragraph: HTMLElement): Word[] {
  const document = paragraph.ownerDocument;
  const cap = paragraph.querySelector<HTMLElement>(":scope > .dropcap");
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      return parent && !parent.closest(".dropcap,code,pre,script,style")
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
        span.dataset.folioJoinBefore = discretionary || (hasWord && !separated) ? "true" : "false";
        span.dataset.folioHyphenBefore = discretionary ? "true" : "false";
        span.textContent = piece;
        fragment.append(span);
        hasWord = true;
        separated = false;
      });
    }
    textNode.replaceWith(fragment);
  }

  const nodes = Array.from(paragraph.querySelectorAll<HTMLElement>(".folio-word"));
  for (const node of nodes) {
    const style = getComputedStyle(node);
    // Words are moved out of their original inline wrapper when lines are built.
    // Carry visible inline styling with them instead of losing emphasis.
    node.style.fontFamily = style.fontFamily;
    node.style.fontSize = style.fontSize;
    node.style.fontWeight = style.fontWeight;
    node.style.fontStyle = style.fontStyle;
    node.style.fontVariant = style.fontVariant;
    node.style.textDecoration = style.textDecoration;
    node.style.letterSpacing = style.letterSpacing;
    node.style.whiteSpace = "nowrap";
  }

  const words = nodes.map((node) => ({
    node,
    width: node.getBoundingClientRect().width,
    joinBefore: node.dataset.folioJoinBefore === "true",
    hyphenBefore: node.dataset.folioHyphenBefore === "true",
  }));
  if (cap) cap.remove();
  paragraph.replaceChildren(...(cap ? [cap] : []));
  return words;
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
  const maxGap = Math.max(spaceWidth, fontSize * 0.47);
  const idealGap = Math.max(spaceWidth, fontSize * 0.29);
  const states: Array<Map<number, { cost: number; from: number; justified: boolean; wordSpacing: number }>> =
    Array.from({ length: count + 1 }, () => new Map());
  states[0].set(0, { cost: 0, from: -1, justified: false, wordSpacing: 0 });

  for (let start = 0; start < count; start++) {
    for (const [line, state] of states[start]) {
      const available = Math.max(fontSize * 5, fullWidth - (line === 0 ? indent : 0) - (line < capLines ? capWidth : 0));
      let wordWidth = 0;
      let gaps = 0;
      for (let end = start; end < count; end++) {
        wordWidth += words[end].width;
        if (end > start && !words[end].joinBefore) gaps++;

        const last = end === count - 1;
        const next = last ? null : words[end + 1];
        // Adjacent DOM/text fragments are not automatically legal line breaks.
        // Only source whitespace or a genuine soft-hyphen boundary may break.
        const canBreak = last || !next!.joinBefore || next!.hyphenBefore;
        const hyphenBreak = !last && next!.hyphenBefore;
        const natural = wordWidth + gaps * spaceWidth + (hyphenBreak ? hyphenWidth : 0);
        if (natural > available + 0.5 && end > start) break;
        if (!canBreak) continue;

        const gap = gaps ? (available - wordWidth - (hyphenBreak ? hyphenWidth : 0)) / gaps : Number.POSITIVE_INFINITY;
        const justified = !last && gaps > 0 && gap >= spaceWidth * 0.82 && gap <= maxGap;
        const leftover = Math.max(0, available - natural) / available;
        // Hyphenation is a rescue tool, not the compositor's favourite move.
        // A real discretionary break must improve a line enough to pay for it.
        const hyphenPenalty = hyphenBreak ? 52 : 0;
        const cost = state.cost + hyphenPenalty + (last
          ? 4 * leftover * leftover
          : justified
            ? 28 * Math.pow((gap - idealGap) / Math.max(1, maxGap - spaceWidth), 2)
            : 150 + 90 * leftover * leftover + (gaps < 2 ? 80 : 0));
        const nextLine = line + 1;
        const previous = states[end + 1].get(nextLine);
        if (!previous || cost < previous.cost) states[end + 1].set(nextLine, {
          cost,
          from: start,
          justified,
          wordSpacing: justified ? Math.max(0, gap - spaceWidth) : 0,
        });
      }
    }
  }

  let bestLine = -1;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const [line, state] of states[count]) {
    if (state.cost < bestCost) { bestCost = state.cost; bestLine = line; }
  }
  if (bestLine < 0) return [{ end: count, justified: false, wordSpacing: 0 }];

  const reversed: Break[] = [];
  let end = count;
  let line = bestLine;
  while (end > 0) {
    const state = states[end].get(line)!;
    reversed.push({ end, justified: state.justified, wordSpacing: state.wordSpacing });
    end = state.from;
    line--;
  }
  return reversed.reverse();
}

function composeParagraph(paragraph: HTMLElement, language: string): void {
  if (paragraph.closest(".chapter-subtitle,.note,.telegram,.sign,.inscription,.verse,.poem,.msg") || paragraph.querySelector("br,img,svg")) return;
  if (paragraph.dataset.folioOriginalHtml !== undefined) restore(paragraph);
  hyphenateElement(paragraph, language);
  paragraph.dataset.folioOriginalHtml = paragraph.innerHTML;

  const style = getComputedStyle(paragraph);
  const fullWidth = paragraph.clientWidth;
  const fontSize = pixels(style.fontSize) || 16;
  if (fullWidth < fontSize * 8) return;
  const indent = Math.max(0, pixels(style.textIndent));
  const lineHeight = pixels(style.lineHeight) || fontSize * 1.5;
  const cap = paragraph.querySelector<HTMLElement>(":scope > .dropcap");
  const capRect = cap?.getBoundingClientRect();
  const capStyle = cap ? getComputedStyle(cap) : null;
  const capWidth = capRect ? capRect.width + pixels(capStyle?.marginRight ?? "0") : 0;
  const capLines = capRect ? Math.max(1, Math.ceil(capRect.height / lineHeight)) : 0;

  const probe = paragraph.ownerDocument.createElement("span");
  probe.textContent = " -";
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${style.font};letter-spacing:${style.letterSpacing}`;
  paragraph.ownerDocument.body.appendChild(probe);
  const pairWidth = probe.getBoundingClientRect().width;
  probe.textContent = " ";
  const spaceWidth = probe.getBoundingClientRect().width || fontSize * 0.25;
  const hyphenWidth = Math.max(fontSize * 0.2, pairWidth - spaceWidth);
  probe.remove();

  const words = tokenize(paragraph);
  if (!words.length) { restore(paragraph); return; }
  const breaks = chooseBreaks(words, fullWidth, spaceWidth, hyphenWidth, cap ? 0 : indent, capWidth, capLines, fontSize);
  paragraph.classList.add("folio-composed");

  let start = 0;
  for (const [lineIndex, lineBreak] of breaks.entries()) {
    const line = paragraph.ownerDocument.createElement("span");
    line.className = `folio-composed-line ${lineBreak.justified ? "folio-line-justified" : "folio-line-natural"}`;
    if (lineBreak.justified) line.style.wordSpacing = `${lineBreak.wordSpacing}px`;
    if (lineIndex === 0 && !cap && indent) line.style.marginLeft = `${indent}px`;
    if (start > 0 && !words[start].joinBefore) line.append(" ");
    for (let i = start; i < lineBreak.end; i++) {
      if (i > start && !words[i].joinBefore) line.append(" ");
      line.append(words[i].node);
    }
    if (lineBreak.end < words.length && words[lineBreak.end].hyphenBefore) line.append("-");
    paragraph.append(line);
    start = lineBreak.end;
  }
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

/** Compose only the part of a long chapter the reader is about to see. The
 * remaining paragraphs keep a cheap browser fallback and are upgraded ahead of
 * scrolling. No full-page geometry scan runs on the typing path. */
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
  // First paragraphs are immediately useful for a freshly opened chapter. If
  // scroll was preserved deeper in the chapter, IntersectionObserver queues the
  // actual viewport without us measuring every preceding paragraph.
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

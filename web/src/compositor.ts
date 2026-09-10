const PROSE_SELECTOR = [
  "section.chapter > p:not(.scene-break)",
  "section.chapter > blockquote p",
  "section.chapter li",
  "section.backmatter > p:not(.scene-break)",
  "section.backmatter li",
].join(",");
const compositionGeneration = new WeakMap<Document, number>();

type Word = { node: HTMLElement; width: number; joinBefore: boolean };
type Break = { end: number; justified: boolean; wordSpacing: number };

function pixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function restore(paragraph: HTMLElement): void {
  const original = paragraph.dataset.folioOriginalHtml;
  if (original === undefined) return;
  paragraph.innerHTML = original;
  delete paragraph.dataset.folioOriginalHtml;
  paragraph.classList.remove("folio-composed");
}

function tokenize(paragraph: HTMLElement): Word[] {
  const document = paragraph.ownerDocument;
  const cap = paragraph.querySelector<HTMLElement>(":scope > .dropcap");
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      return parent && !parent.closest(".dropcap,code,pre,script,style") && node.nodeValue?.trim()
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  for (const textNode of textNodes) {
    const fragment = document.createDocumentFragment();
    for (const part of textNode.data.split(/([ \t\r\n]+)/)) {
      if (!part) continue;
      if (/^[ \t\r\n]+$/.test(part)) {
        fragment.append(" ");
      } else {
        part.split("\u00ad").forEach((piece, index) => {
          if (!piece) return;
          const span = document.createElement("span");
          span.className = "folio-word";
          span.dataset.folioJoinBefore = index > 0 ? "true" : "false";
          span.textContent = piece;
          fragment.append(span);
        });
      }
    }
    textNode.replaceWith(fragment);
  }

  const nodes = Array.from(paragraph.querySelectorAll<HTMLElement>(".folio-word"));
  for (const node of nodes) {
    const style = getComputedStyle(node);
    // Words are moved out of their original inline wrapper when lines are built.
    // Carry the visible inline styling with them instead of losing emphasis.
    node.style.fontFamily = style.fontFamily;
    node.style.fontSize = style.fontSize;
    node.style.fontWeight = style.fontWeight;
    node.style.fontStyle = style.fontStyle;
    node.style.fontVariant = style.fontVariant;
    node.style.textDecoration = style.textDecoration;
    node.style.letterSpacing = style.letterSpacing;
    node.style.whiteSpace = "nowrap";
  }
  const words = nodes.map((node) => ({ node, width: node.getBoundingClientRect().width, joinBefore: node.dataset.folioJoinBefore === "true" }));
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
        const hyphenBreak = end < count - 1 && words[end + 1].joinBefore;
        const natural = wordWidth + gaps * spaceWidth + (hyphenBreak ? hyphenWidth : 0);
        if (natural > available + 0.5 && end > start) break;
        const last = end === count - 1;
        const gap = gaps ? (available - wordWidth - (hyphenBreak ? hyphenWidth : 0)) / gaps : Number.POSITIVE_INFINITY;
        const justified = !last && gaps > 0 && gap >= spaceWidth * 0.82 && gap <= maxGap;
        const leftover = Math.max(0, available - natural) / available;
        // Prefer even, modestly expanded spaces. A line that would need a huge
        // gap is allowed only as a natural ragged line and receives a penalty.
        const cost = state.cost + (last
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

function composeParagraph(paragraph: HTMLElement): void {
  if (paragraph.closest(".chapter-subtitle,.note,.telegram,.sign,.inscription,.verse,.poem,.msg") || paragraph.querySelector("br,img,svg")) return;
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
    for (let i = start; i < lineBreak.end; i++) {
      if (i > start && !words[i].joinBefore) line.append(" ");
      line.append(words[i].node);
    }
    if (lineBreak.end < words.length && words[lineBreak.end].joinBefore) line.append("-");
    paragraph.append(line);
    start = lineBreak.end;
  }
}

/** Compose whole paragraphs with bounded space expansion. Unlike Chromium's
 * greedy inter-word justification this never creates arbitrarily large gaps. */
export async function composePreviewDocument(document: Document, enabled: boolean): Promise<void> {
  const generation = (compositionGeneration.get(document) ?? 0) + 1;
  compositionGeneration.set(document, generation);
  document.querySelectorAll<HTMLElement>(`${PROSE_SELECTOR}[data-folio-original-html]`).forEach(restore);
  if (!enabled) return;
  try { await document.fonts?.ready; } catch { /* a fallback font is still measurable */ }
  if (compositionGeneration.get(document) !== generation) return;
  const paragraphs = Array.from(document.querySelectorAll<HTMLElement>(PROSE_SELECTOR));
  for (let index = 0; index < paragraphs.length; index++) {
    if (compositionGeneration.get(document) !== generation) return;
    composeParagraph(paragraphs[index]);
    // A paragraph-wide layout pass is deliberately incremental. Yield often so
    // autosave, typing and scrolling remain responsive even after a complete
    // 100,000-word manuscript is pasted into one chapter.
    if (index > 0 && index % 4 === 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }
}

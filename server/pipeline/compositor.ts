import type { Page } from "puppeteer";
import type { Book } from "./types.ts";

/** A bounded paragraph composer for Chromium PDF/print output. It chooses line
 * breaks across the paragraph and only justifies lines whose resulting spaces
 * stay within a conservative book-typography limit. */
export async function composeProfessionalParagraphs(page: Page, book: Book): Promise<void> {
  if (book.typography.bodyAlign === "left") return;
  await page.evaluate(async () => {
    try { await document.fonts?.ready; } catch { /* use the resolved fallback */ }
    const selector = [
      "section.chapter > p:not(.scene-break)", "section.chapter > blockquote p", "section.chapter li",
      "section.backmatter > p:not(.scene-break)", "section.backmatter li",
    ].join(",");
    const style = document.createElement("style");
    style.id = "folio-professional-compositor";
    style.textContent =
      ".folio-composed{text-indent:0!important;text-align:left!important;text-align-last:left!important}" +
      ".folio-composed-line{display:block;white-space:nowrap;text-indent:0}" +
      ".folio-line-justified{text-align:left!important;text-align-last:left!important}" +
      ".folio-line-natural{text-align:left!important;text-align-last:left!important}";
    document.head.appendChild(style);

    for (const paragraph of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (paragraph.closest(".chapter-subtitle,.note,.telegram,.sign,.inscription,.verse,.poem,.msg") || paragraph.querySelector("br,img,svg")) continue;
      const computed = getComputedStyle(paragraph);
      const width = paragraph.clientWidth;
      const fontSize = Number.parseFloat(computed.fontSize) || 16;
      if (width < fontSize * 8) continue;
      const indent = Math.max(0, Number.parseFloat(computed.textIndent) || 0);
      const lineHeight = Number.parseFloat(computed.lineHeight) || fontSize * 1.5;
      const cap = paragraph.querySelector<HTMLElement>(":scope > .dropcap");
      const capRect = cap?.getBoundingClientRect();
      const capWidth = capRect ? capRect.width + (Number.parseFloat(getComputedStyle(cap!).marginRight) || 0) : 0;
      const capLines = capRect ? Math.max(1, Math.ceil(capRect.height / lineHeight)) : 0;

      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const parent = node.parentElement;
        if (parent && !parent.closest(".dropcap,code,pre,script,style")) textNodes.push(node);
      }
      let separated = true;
      let hasWord = false;
      for (const textNode of textNodes) {
        const fragment = document.createDocumentFragment();
        for (const part of textNode.data.split(/([ \t\r\n]+)/)) {
          if (!part) continue;
          if (/^[ \t\r\n]+$/.test(part)) {
            separated = true;
            fragment.append(" ");
          } else {
            part.split("\u00ad").forEach((piece, index) => {
              if (!piece) return;
              const word = document.createElement("span");
              word.className = "folio-word";
              word.dataset.folioJoinBefore = index > 0 || (hasWord && !separated) ? "true" : "false";
              word.textContent = piece;
              fragment.append(word);
              hasWord = true;
              separated = false;
            });
          }
        }
        textNode.replaceWith(fragment);
      }
      const wordNodes = Array.from(paragraph.querySelectorAll<HTMLElement>(".folio-word"));
      for (const word of wordNodes) {
        const wordStyle = getComputedStyle(word);
        word.style.fontFamily = wordStyle.fontFamily;
        word.style.fontSize = wordStyle.fontSize;
        word.style.fontWeight = wordStyle.fontWeight;
        word.style.fontStyle = wordStyle.fontStyle;
        word.style.fontVariant = wordStyle.fontVariant;
        word.style.textDecoration = wordStyle.textDecoration;
        word.style.letterSpacing = wordStyle.letterSpacing;
        word.style.whiteSpace = "nowrap";
      }
      const words = wordNodes.map((word) => ({ width: word.getBoundingClientRect().width, joinBefore: word.dataset.folioJoinBefore === "true" }));
      const widths = words.map((word) => word.width);
      if (!widths.length) continue;
      const probe = document.createElement("span");
      probe.textContent = " -";
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${computed.font};letter-spacing:${computed.letterSpacing}`;
      document.body.appendChild(probe);
      const pairWidth = probe.getBoundingClientRect().width;
      probe.textContent = " ";
      const spaceWidth = probe.getBoundingClientRect().width || fontSize * 0.25;
      const hyphenWidth = Math.max(fontSize * 0.2, pairWidth - spaceWidth);
      probe.remove();
      const maxGap = Math.max(spaceWidth, fontSize * 0.47);
      const idealGap = Math.max(spaceWidth, fontSize * 0.29);
      const states: Array<Map<number, { cost: number; from: number; justified: boolean; wordSpacing: number }>> =
        Array.from({ length: widths.length + 1 }, () => new Map());
      states[0].set(0, { cost: 0, from: -1, justified: false, wordSpacing: 0 });
      for (let start = 0; start < widths.length; start++) {
        for (const [lineNo, previous] of states[start]) {
          const available = Math.max(fontSize * 5, width - (lineNo === 0 && !cap ? indent : 0) - (lineNo < capLines ? capWidth : 0));
          let wordWidth = 0;
          let gaps = 0;
          for (let end = start; end < widths.length; end++) {
            wordWidth += widths[end];
            if (end > start && !words[end].joinBefore) gaps++;
            const hyphenBreak = end < widths.length - 1 && words[end + 1].joinBefore;
            const natural = wordWidth + gaps * spaceWidth + (hyphenBreak ? hyphenWidth : 0);
            if (natural > available + 0.5 && end > start) break;
            const last = end === widths.length - 1;
            const gap = gaps ? (available - wordWidth - (hyphenBreak ? hyphenWidth : 0)) / gaps : Number.POSITIVE_INFINITY;
            const justified = !last && gaps > 0 && gap >= spaceWidth * 0.82 && gap <= maxGap;
            const leftover = Math.max(0, available - natural) / available;
            const cost = previous.cost + (last ? 4 * leftover * leftover : justified
              ? 28 * Math.pow((gap - idealGap) / Math.max(1, maxGap - spaceWidth), 2)
              : 150 + 90 * leftover * leftover + (gaps < 2 ? 80 : 0));
            const nextLine = lineNo + 1;
            const old = states[end + 1].get(nextLine);
            if (!old || cost < old.cost) states[end + 1].set(nextLine, {
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
      for (const [lineNo, state] of states[widths.length]) {
        if (state.cost < bestCost) { bestLine = lineNo; bestCost = state.cost; }
      }
      if (bestLine < 0) continue;
      const breaks: Array<{ end: number; justified: boolean; wordSpacing: number }> = [];
      let end = widths.length;
      for (let lineNo = bestLine; end > 0; lineNo--) {
        const state = states[end].get(lineNo)!;
        breaks.push({ end, justified: state.justified, wordSpacing: state.wordSpacing });
        end = state.from;
      }
      breaks.reverse();
      if (cap) cap.remove();
      paragraph.replaceChildren(...(cap ? [cap] : []));
      paragraph.classList.add("folio-composed");
      let start = 0;
      for (const [lineNo, lineBreak] of breaks.entries()) {
        const line = document.createElement("span");
        line.className = `folio-composed-line ${lineBreak.justified ? "folio-line-justified" : "folio-line-natural"}`;
        if (lineBreak.justified) line.style.wordSpacing = `${lineBreak.wordSpacing}px`;
        if (lineNo === 0 && !cap && indent) line.style.marginLeft = `${indent}px`;
        if (start > 0 && !words[start].joinBefore) line.append(" ");
        for (let i = start; i < lineBreak.end; i++) {
          if (i > start && !words[i].joinBefore) line.append(" ");
          line.append(wordNodes[i]);
        }
        if (lineBreak.end < words.length && words[lineBreak.end].joinBefore) line.append("-");
        paragraph.append(line);
        start = lineBreak.end;
      }
    }
  });
}

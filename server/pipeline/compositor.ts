import type { Page } from "puppeteer";
import type { Book } from "./types.ts";

/** A bounded paragraph composer for Chromium PDF/print output. It chooses line
 * breaks across the whole paragraph, caps both inter-word expansion and
 * tracking, preserves inline semantics, and penalises consecutive hyphenation. */
export async function composeProfessionalParagraphs(page: Page, book: Book): Promise<void> {
  if (book.typography.bodyAlign === "left") return;
  // tsx/esbuild may preserve names of helpers nested inside a function passed to
  // Puppeteer by emitting calls to its module-level __name helper. Puppeteer
  // serialises only the callback, not that module closure. Define the harmless
  // helper in the page global first so production/tests cannot fail at runtime.
  await page.evaluate("globalThis.__name = globalThis.__name || function(target){ return target; }");
  await page.evaluate(async () => {
    try { await document.fonts?.ready; } catch { /* resolved fallback is usable */ }

    const selector = [
      "section.chapter > p:not(.scene-break)", "section.chapter > blockquote p", "section.chapter li",
      "section.backmatter > p:not(.scene-break)", "section.backmatter li",
    ].join(",");
    const atomicInline = "a,em,strong,b,i,u,s,sup,sub";
    const styleNode = document.createElement("style");
    styleNode.id = "folio-professional-compositor";
    styleNode.textContent =
      ".folio-composed{text-indent:0!important;text-align:left!important;text-align-last:left!important}" +
      ".folio-composed-line{display:block;white-space:nowrap;text-indent:0;text-align:left!important;text-align-last:left!important}" +
      ".folio-compositor-safe-fallback{text-align:left!important;text-align-last:left!important}" +
      ".scene-break{display:block!important;text-align:center!important;text-align-last:center!important;word-spacing:normal!important;letter-spacing:normal!important}";
    document.head.appendChild(styleNode);

    const px = (value: string) => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    type Word = {
      node: HTMLElement;
      width: number;
      spaceBefore: boolean;
      hyphenBefore: boolean;
      canBreakBefore: boolean;
      characters: number;
    };
    type Break = { end: number; justified: boolean; wordSpacing: number; tracking: number; hyphenated: boolean };
    type State = Break & { cost: number; from: number; fromKey: number };

    const boundedAdjustment = (
      adjustment: number,
      gaps: number,
      trackingOps: number,
      spaceWidth: number,
      fontSize: number,
    ): { wordSpacing: number; tracking: number } | null => {
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
    };

    for (const paragraph of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (
        paragraph.closest(".chapter-subtitle,.note,.telegram,.sign,.inscription,.verse,.poem,.msg") ||
        paragraph.querySelector("br,img,svg,code,pre,.math,[data-math]")
      ) continue;

      const computed = getComputedStyle(paragraph);
      const width = paragraph.clientWidth;
      const fontSize = px(computed.fontSize) || 16;
      if (width < fontSize * 8) continue;
      const estimatedWords = paragraph.textContent?.trim().split(/\s+/).length ?? 0;
      if (estimatedWords > 1400) {
        paragraph.classList.add("folio-compositor-safe-fallback");
        continue;
      }

      const indent = Math.max(0, px(computed.textIndent));
      const lineHeight = px(computed.lineHeight) || fontSize * 1.5;
      const cap = paragraph.querySelector<HTMLElement>(":scope > .dropcap");
      const capRect = cap?.getBoundingClientRect();
      const capStyle = cap ? getComputedStyle(cap) : null;
      const capWidth = capRect
        ? capRect.width + px(capStyle?.marginLeft ?? "0") + px(capStyle?.marginRight ?? "0")
        : 0;
      const capDepth = capRect
        ? capRect.height + px(capStyle?.marginTop ?? "0") + px(capStyle?.marginBottom ?? "0")
        : 0;
      const capLines = capRect ? Math.max(1, Math.ceil(capDepth / lineHeight)) : 0;

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
            const word = document.createElement("span");
            const discretionary = index > 0;
            word.className = "folio-word";
            word.dataset.folioSpaceBefore = hasWord && separated ? "true" : "false";
            word.dataset.folioHyphenBefore = discretionary ? "true" : "false";
            word.textContent = (discretionary ? "\u00ad" : "") + piece;
            word.style.whiteSpace = "nowrap";
            fragment.append(word);
            hasWord = true;
            separated = false;
          });
        }
        textNode.replaceWith(fragment);
      }

      const wordNodes = Array.from(paragraph.querySelectorAll<HTMLElement>(".folio-word"));
      if (!wordNodes.length) continue;
      const atomicIds = new WeakMap<Element, number>();
      let nextAtomicId = 1;
      let previousAtomic = 0;
      const words: Word[] = wordNodes.map((node) => {
        const atomic = node.closest(atomicInline);
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

      const probe = document.createElement("span");
      probe.textContent = " -";
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${computed.font};letter-spacing:${computed.letterSpacing};word-spacing:${computed.wordSpacing}`;
      document.body.appendChild(probe);
      const pairWidth = probe.getBoundingClientRect().width;
      probe.textContent = " ";
      const spaceWidth = probe.getBoundingClientRect().width || fontSize * 0.25;
      const hyphenWidth = Math.max(fontSize * 0.2, pairWidth - spaceWidth);
      probe.remove();

      const states: Array<Map<number, State>> = Array.from({ length: words.length + 1 }, () => new Map());
      states[0].set(0, {
        cost: 0, from: -1, fromKey: -1, end: 0,
        justified: false, wordSpacing: 0, tracking: 0, hyphenated: false,
      });

      for (let start = 0; start < words.length; start++) {
        for (const [stateKey, previous] of states[start]) {
          const lineNo = Math.floor(stateKey / 2);
          const available = Math.max(fontSize * 5, width - (lineNo === 0 && !cap ? indent : 0) - (lineNo < capLines ? capWidth : 0));
          let wordWidth = 0;
          let gaps = 0;
          let characters = 0;
          for (let end = start; end < words.length; end++) {
            wordWidth += words[end].width;
            characters += words[end].characters;
            if (end > start && words[end].spaceBefore) gaps++;
            const last = end === words.length - 1;
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
            const nextLine = lineNo + 1;
            const nextKey = nextLine * 2 + (hyphenBreak ? 1 : 0);
            const old = states[end + 1].get(nextKey);
            if (!old || cost < old.cost) states[end + 1].set(nextKey, {
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

      let bestKey = -1;
      let bestCost = Number.POSITIVE_INFINITY;
      for (const [key, state] of states[words.length]) {
        if (state.cost < bestCost) { bestCost = state.cost; bestKey = key; }
      }
      if (bestKey < 0) {
        paragraph.classList.add("folio-compositor-safe-fallback");
        continue;
      }

      const reversed: Break[] = [];
      let end = words.length;
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
      const breaks = reversed.reverse();

      const lineFragments: DocumentFragment[] = [];
      let start = 0;
      for (const lineBreak of breaks) {
        const range = document.createRange();
        range.setStartBefore(words[start].node);
        range.setEndAfter(words[lineBreak.end - 1].node);
        lineFragments.push(range.cloneContents());
        start = lineBreak.end;
      }

      const baseWordSpacing = px(computed.wordSpacing);
      const baseTracking = px(computed.letterSpacing);
      const lines: HTMLElement[] = [];
      start = 0;
      for (const [lineNo, lineBreak] of breaks.entries()) {
        const line = document.createElement("span");
        line.className = `folio-composed-line ${lineBreak.justified ? "folio-line-justified" : "folio-line-natural"}`;
        line.append(lineFragments[lineNo]);
        if (lineBreak.end < words.length && words[lineBreak.end].hyphenBefore) line.append("-");
        if (lineBreak.justified) {
          line.style.wordSpacing = `${baseWordSpacing + lineBreak.wordSpacing}px`;
          line.style.letterSpacing = `${baseTracking + lineBreak.tracking}px`;
          line.dataset.folioWordSpacing = String(lineBreak.wordSpacing);
          line.dataset.folioTracking = String(lineBreak.tracking);
        }
        if (lineNo === 0 && !cap && indent) line.style.marginLeft = `${indent}px`;
        if (lineNo === 0 || lineNo === breaks.length - 2) line.style.breakAfter = "avoid";
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
  });
}

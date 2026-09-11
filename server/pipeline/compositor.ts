import type { Page } from "puppeteer";
import type { Book } from "./types.ts";

/** Chromium print/PDF composition mirrors the reflow preview rules: legal
 * paragraph-level break optimisation, bounded spaces/tracking, hyphen ladder
 * penalties, semantic inline preservation and deterministic drop-cap geometry. */
export async function composeProfessionalParagraphs(page: Page, book: Book): Promise<void> {
  if (book.typography.bodyAlign === "left") return;

  // tsx/esbuild can emit calls to a module-level __name helper while serialising
  // nested helpers inside page.evaluate. Define it in the page explicitly so the
  // callback never depends on the Node module closure.
  await page.evaluate("globalThis.__name = globalThis.__name || function(target){ return target; }");
  await page.evaluate(async () => {
    try { await document.fonts?.ready; } catch { /* fallback metrics are usable */ }

    const selector = [
      "section.chapter > p:not(.scene-break)",
      "section.chapter > blockquote p",
      "section.chapter li",
      "section.backmatter > p:not(.scene-break)",
      "section.backmatter li",
    ].join(",");
    const atomicInline = "a,em,strong,b,i,u,s,sup,sub";
    const styleNode = document.createElement("style");
    styleNode.id = "folio-professional-compositor";
    styleNode.textContent =
      ".folio-composed{position:relative!important;text-indent:0!important;text-align:left!important;text-align-last:left!important;overflow:visible!important}" +
      ".folio-composed-line{display:block!important;box-sizing:border-box!important;white-space:nowrap!important;text-indent:0!important;text-align:left!important;text-align-last:left!important}" +
      ".folio-composed-dropcap>.dropcap.folio-composed-cap{float:none!important;position:absolute!important;z-index:1}" +
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
    type LineFit = { wordSpacing: number; tracking: number; badness: number; fitness: number };
    type Break = {
      end: number;
      justified: boolean;
      wordSpacing: number;
      tracking: number;
      hyphenated: boolean;
      offset: number;
      available: number;
      emergency: boolean;
    };
    type State = Break & {
      cost: number;
      from: number;
      fromKey: number;
      fitness: number;
      gapPositions: number[];
      riverPositions: number[];
    };

    const fitLine = (
      adjustment: number,
      gaps: number,
      trackingOps: number,
      spaceWidth: number,
      fontSize: number,
      emergency = false,
    ): LineFit | null => {
      if (gaps <= 0) return null;
      const maxWordSpacing = emergency
        ? Math.min(spaceWidth * 0.48, fontSize * 0.14)
        : Math.min(spaceWidth * 0.38, fontSize * 0.115);
      const minWordSpacing = emergency
        ? -Math.min(spaceWidth * 0.18, fontSize * 0.045)
        : -Math.min(spaceWidth * 0.14, fontSize * 0.035);
      const maxTracking = fontSize * (emergency ? 0.007 : 0.0055);
      const minTracking = -fontSize * (emergency ? 0.0045 : 0.0035);

      let wordSpacing = Math.max(minWordSpacing, Math.min(maxWordSpacing, adjustment / gaps));
      let remaining = adjustment - wordSpacing * gaps;
      let tracking = trackingOps > 0 ? remaining / trackingOps : 0;
      if (tracking > maxTracking || tracking < minTracking) {
        tracking = Math.max(minTracking, Math.min(maxTracking, tracking));
        wordSpacing = (adjustment - tracking * trackingOps) / gaps;
      }
      if (wordSpacing > maxWordSpacing + 0.001 || wordSpacing < minWordSpacing - 0.001) return null;
      if (tracking > maxTracking + 0.001 || tracking < minTracking - 0.001) return null;

      const spaceRatio = wordSpacing / Math.max(0.5, spaceWidth);
      const trackingRatio = tracking / Math.max(1, fontSize);
      const badness = 100 * Math.pow(Math.abs(spaceRatio) / 0.20, 3)
        + 55 * Math.pow(Math.abs(trackingRatio) / 0.0035, 3);
      const fitness = spaceRatio < -0.04 ? 0 : spaceRatio <= 0.10 ? 1 : spaceRatio <= 0.22 ? 2 : 3;
      return { wordSpacing, tracking, badness, fitness };
    };

    const FITNESS_COUNT = 4;
    const HYPHEN_STREAK_COUNT = 3;
    const encodeState = (line: number, hyphenStreak: number, fitness: number) =>
      (line * HYPHEN_STREAK_COUNT + hyphenStreak) * FITNESS_COUNT + fitness;
    const decodeState = (key: number) => ({
      line: Math.floor(key / (HYPHEN_STREAK_COUNT * FITNESS_COUNT)),
      hyphenStreak: Math.floor(key / FITNESS_COUNT) % HYPHEN_STREAK_COUNT,
      fitness: key % FITNESS_COUNT,
    });
    const lineGapPositions = (
      words: Word[],
      start: number,
      end: number,
      offset: number,
      spaceWidth: number,
      fit: LineFit | null,
    ) => {
      const positions: number[] = [];
      let cursor = offset;
      for (let index = start; index < end; index++) {
        const word = words[index];
        if (index > start && word.spaceBefore) {
          const gapWidth = spaceWidth + (fit?.wordSpacing ?? 0) + (fit?.tracking ?? 0);
          positions.push(cursor + gapWidth / 2);
          cursor += gapWidth;
        }
        cursor += word.width + (fit?.tracking ?? 0) * word.characters;
      }
      return positions;
    };
    const riverCost = (current: number[], previous: State, spaceWidth: number) => {
      const tolerance = Math.max(1.5, spaceWidth * 0.72);
      const rivers: number[] = [];
      let cost = 0;
      for (const position of current) {
        const adjacent = previous.gapPositions.reduce((best, candidate) => Math.min(best, Math.abs(position - candidate)), Infinity);
        if (adjacent < tolerance) {
          rivers.push(position);
          cost += 7 * Math.pow(1 - adjacent / tolerance, 2);
        }
        const established = previous.riverPositions.reduce((best, candidate) => Math.min(best, Math.abs(position - candidate)), Infinity);
        if (established < tolerance) cost += 95 * Math.pow(1 - established / tolerance, 2);
      }
      return { cost, rivers };
    };

    for (const paragraph of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (
        paragraph.closest(".chapter-subtitle,.note,.telegram,.sign,.inscription,.verse,.poem,.msg") ||
        paragraph.querySelector("br,img,svg,code,pre,.math,[data-math]")
      ) continue;

      const computed = getComputedStyle(paragraph);
      const fontSize = px(computed.fontSize) || 16;
      const paragraphRect = paragraph.getBoundingClientRect();
      if (paragraphRect.width < fontSize * 8) continue;
      const estimatedWords = paragraph.textContent?.trim().split(/\s+/).length ?? 0;
      if (estimatedWords > 1400) {
        paragraph.classList.add("folio-compositor-safe-fallback");
        continue;
      }

      const borderLeft = px(computed.borderLeftWidth);
      const borderRight = px(computed.borderRightWidth);
      const borderTop = px(computed.borderTopWidth);
      const paddingLeft = px(computed.paddingLeft);
      const paddingRight = px(computed.paddingRight);
      const paddingTop = px(computed.paddingTop);
      const contentLeft = paragraphRect.left + borderLeft + paddingLeft;
      const contentTop = paragraphRect.top + borderTop + paddingTop;
      const width = Math.max(1, paragraphRect.width - borderLeft - borderRight - paddingLeft - paddingRight);
      const lineHeight = px(computed.lineHeight) || fontSize * 1.5;
      const indent = Math.max(0, px(computed.textIndent));
      const cap = paragraph.querySelector<HTMLElement>(":scope > .dropcap");

      let capLines = 0;
      let capIntrusion = 0;
      let capLeft = 0;
      let capTop = 0;
      let capDepth = 0;
      if (cap) {
        const capRect = cap.getBoundingClientRect();
        const capStyle = getComputedStyle(cap);
        capIntrusion = Math.max(0, capRect.right + px(capStyle.marginRight) - contentLeft);
        capIntrusion = Math.min(width * 0.46, capIntrusion);
        capDepth = Math.max(0, capRect.bottom + px(capStyle.marginBottom) - contentTop);
        capLines = Math.max(1, Math.ceil((capDepth - 0.01) / Math.max(1, lineHeight)));
        capLeft = capRect.left - (paragraphRect.left + borderLeft);
        capTop = capRect.top - (paragraphRect.top + borderTop);
      }

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
      const hyphenWidth = Math.max(fontSize * 0.18, pairWidth - spaceWidth);
      probe.remove();

      const lineGeometry = (line: number) => {
        if (cap && line < capLines) return {
          offset: capIntrusion,
          available: Math.max(1, width - capIntrusion),
        };
        const offset = line === 0 && !cap ? indent : 0;
        return { offset, available: Math.max(1, width - offset) };
      };

      const runBreaker = (emergency: boolean): Break[] | null => {
      const states: Array<Map<number, State>> = Array.from({ length: words.length + 1 }, () => new Map());
      const initialFitness = 1;
      states[0].set(encodeState(0, 0, initialFitness), {
        cost: 0,
        from: -1,
        fromKey: -1,
        end: 0,
        justified: false,
        wordSpacing: 0,
        tracking: 0,
        hyphenated: false,
        offset: 0,
        available: width,
        emergency,
        fitness: initialFitness,
        gapPositions: [],
        riverPositions: [],
      });

      for (let start = 0; start < words.length; start++) {
        for (const [stateKey, previous] of states[start]) {
          const decoded = decodeState(stateKey);
          const lineNo = decoded.line;
          const previousHyphenStreak = decoded.hyphenStreak;
          const previousFitness = decoded.fitness;
          const { offset, available } = lineGeometry(lineNo);
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
            const adjustment = available - natural;
            const trackingOps = Math.max(0, characters + gaps - 1);
            // Mirror live preview: bounded compression is a normal composition
            // tool, not an unreachable branch hidden behind natural <= measure.
            const strictFit = !last
              ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, false)
              : null;
            const fit = strictFit ?? (emergency && !last
              ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, true)
              : null);
            if (!canBreak) continue;
            if (natural > available + 0.75 && !fit && (end > start || last)) break;
            // Mirror the reflow preview: only lines physically beside a drop
            // cap may stay natural in the strict pass. Ordinary prose still
            // has to reach the measure inside the normal spacing bounds.
            const dropcapRescue = !last && Boolean(cap) && lineNo < capLines
              && natural <= available + 0.75
              && (!fit || (gaps <= 2 && fit.wordSpacing > spaceWidth * 0.10));
            const emergencyRescue = emergency && !last && !fit && natural <= available + 0.75;
            const rescueNatural = dropcapRescue || emergencyRescue;
            const lineFit = dropcapRescue ? null : fit;
            if (!last && !lineFit && !rescueNatural) continue;

            const wordsOnLine = end - start + 1;
            const fill = Math.min(1, natural / Math.max(1, available));
            const shortLastPenalty = last
              ? (wordsOnLine === 1 ? 180 : fill < 0.28 ? 80 * Math.pow((0.28 - fill) / 0.28, 2) : 0)
              : 0;
            const hyphenPenalty = hyphenBreak ? 165 + previousHyphenStreak * 560 : 0;
            const punctuationPenalty = hyphenBreak && /[,:;.!?…»”’)]$/.test(words[end].node.textContent ?? "") ? 80 : 0;
            const rescuePenalty = dropcapRescue
              ? 115 + 260 * Math.pow(1 - fill, 2)
              : rescueNatural ? 1100 + 900 * Math.pow(1 - fill, 2) : 0;
            const currentFitness = lineFit?.fitness ?? previousFitness;
            const fitnessDelta = Math.abs(currentFitness - previousFitness);
            const fitnessPenalty = lineNo === 0 || !lineFit
              ? 0
              : fitnessDelta > 1 ? 240 * fitnessDelta : fitnessDelta === 1 ? 14 : currentFitness === 3 ? 80 : 0;
            const currentGaps = lineGapPositions(words, start, end + 1, offset, spaceWidth, lineFit);
            const rivers = riverCost(currentGaps, previous, spaceWidth);
            const cost = previous.cost + (lineFit?.badness ?? 0) + rescuePenalty + hyphenPenalty + punctuationPenalty + shortLastPenalty + fitnessPenalty + rivers.cost;
            const nextLine = lineNo + 1;
            const nextStreak = hyphenBreak ? Math.min(2, previousHyphenStreak + 1) : 0;
            const nextKey = encodeState(nextLine, nextStreak, currentFitness);
            const old = states[end + 1].get(nextKey);
            if (!old || cost < old.cost) states[end + 1].set(nextKey, {
              cost,
              from: start,
              fromKey: stateKey,
              end: end + 1,
              justified: !last && Boolean(lineFit),
              wordSpacing: lineFit?.wordSpacing ?? 0,
              tracking: lineFit?.tracking ?? 0,
              hyphenated: hyphenBreak,
              offset,
              available,
              emergency: !last && emergency && !dropcapRescue && (!strictFit || emergencyRescue),
              fitness: currentFitness,
              gapPositions: currentGaps,
              riverPositions: rivers.rivers,
            });
          }
        }
      }

      let bestKey = -1;
      let bestCost = Number.POSITIVE_INFINITY;
      for (const [key, state] of states[words.length]) {
        if (state.cost < bestCost) {
          bestCost = state.cost;
          bestKey = key;
        }
      }
      if (bestKey < 0) return null;

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
          offset: state.offset,
          available: state.available,
          emergency: state.emergency,
        });
        end = state.from;
        key = state.fromKey;
      }
      return reversed.reverse();
      };

      const breaks = runBreaker(false) ?? runBreaker(true);
      if (!breaks) {
        paragraph.classList.add("folio-compositor-safe-fallback");
        continue;
      }

      const fragments: DocumentFragment[] = [];
      let start = 0;
      for (const lineBreak of breaks) {
        const range = document.createRange();
        range.setStartBefore(words[start].node);
        range.setEndAfter(words[lineBreak.end - 1].node);
        fragments.push(range.cloneContents());
        start = lineBreak.end;
      }

      const baseWordSpacing = px(computed.wordSpacing);
      const baseTracking = px(computed.letterSpacing);
      const lines: HTMLElement[] = [];
      for (const [lineNo, lineBreak] of breaks.entries()) {
        const line = document.createElement("span");
        line.className = `folio-composed-line ${lineBreak.justified ? "folio-line-justified" : "folio-line-natural"}${lineBreak.emergency ? " folio-line-emergency" : ""}`;
        if (lineBreak.emergency) line.dataset.folioEmergency = "true";
        line.append(fragments[lineNo]);
        if (lineBreak.end < words.length && words[lineBreak.end].hyphenBefore) line.append("-");
        line.style.marginLeft = `${lineBreak.offset}px`;
        line.style.width = `${lineBreak.available}px`;
        if (lineBreak.justified) {
          line.style.wordSpacing = `${baseWordSpacing + lineBreak.wordSpacing}px`;
          line.style.letterSpacing = `${baseTracking + lineBreak.tracking}px`;
          line.dataset.folioWordSpacing = String(lineBreak.wordSpacing);
          line.dataset.folioTracking = String(lineBreak.tracking);
        }
        if (lineNo === 0 || lineNo === breaks.length - 2) line.style.breakAfter = "avoid";
        lines.push(line);
      }

      paragraph.classList.add("folio-composed");
      if (cap) {
        paragraph.classList.add("folio-composed-dropcap");
        paragraph.style.minHeight = `${Math.max(px(computed.minHeight), capDepth)}px`;
        cap.classList.add("folio-composed-cap");
        cap.style.left = `${capLeft}px`;
        cap.style.top = `${capTop}px`;
      }
      paragraph.replaceChildren(...(cap ? [cap] : []));
      lines.forEach((line, index) => {
        paragraph.append(line);
        if (index < lines.length - 1 && !breaks[index].hyphenated) paragraph.append(" ");
      });
    }
  });
}

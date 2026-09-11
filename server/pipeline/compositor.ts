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
      rightProtrusion: number;
    };
    type LineFit = { wordSpacing: number; tracking: number; glyphScale: number; badness: number; fitness: number };
    type Break = {
      end: number;
      justified: boolean;
      wordSpacing: number;
      tracking: number;
      glyphScale: number;
      hyphenated: boolean;
      offset: number;
      available: number;
      emergency: boolean;
      relaxed: boolean;
      finalCompressed: boolean;
      rightProtrusion: number;
    };
    type State = Break & {
      cost: number;
      from: number;
      fromKey: number;
      fitness: number;
      hyphenCount: number;
      gapPositions: number[];
      riverPositions: number[];
    };

    const fitLine = (
      adjustment: number,
      gaps: number,
      trackingOps: number,
      spaceWidth: number,
      fontSize: number,
      naturalWidth: number,
      previousGlyphScale = 1,
      emergency = false,
      finalCompression = false,
    ): LineFit | null => {
      if (gaps <= 0) return null;
      // The second pass may stretch inter-word space only slightly beyond
      // strict composition. Tracking and glyph expansion stay at strict limits;
      // this is a controlled justified fallback, not an excuse for loose copy.
      const maxWordSpacing = emergency
        ? Math.min(spaceWidth * 0.56, fontSize * 0.14)
        : Math.min(spaceWidth * 0.50, fontSize * 0.115);
      const minWordSpacing = emergency || finalCompression
        ? -Math.min(spaceWidth * 0.34, fontSize * 0.065)
        : -Math.min(spaceWidth * 0.22, fontSize * 0.055);
      const maxTracking = fontSize * 0.0055;
      const minTracking = -fontSize * (emergency || finalCompression ? 0.0055 : 0.0045);
      const maxGlyphScaleDelta = 0.02;
      const available = naturalWidth + adjustment;
      let best: LineFit | null = null;

      for (let step = -20; step <= 20; step++) {
        const glyphScale = 1 + step * 0.001;
        if (Math.abs(glyphScale - 1) > maxGlyphScaleDelta + 0.000001) continue;
        if (Math.abs(glyphScale - previousGlyphScale) > 0.025) continue;
        const scaledAdjustment = available / glyphScale - naturalWidth;
        let wordSpacing = Math.max(minWordSpacing, Math.min(maxWordSpacing, scaledAdjustment / gaps));
        let remaining = scaledAdjustment - wordSpacing * gaps;
        let tracking = trackingOps > 0 ? remaining / trackingOps : 0;
        if (tracking > maxTracking || tracking < minTracking) {
          tracking = Math.max(minTracking, Math.min(maxTracking, tracking));
          wordSpacing = (scaledAdjustment - tracking * trackingOps) / gaps;
        }
        if (wordSpacing > maxWordSpacing + 0.001 || wordSpacing < minWordSpacing - 0.001) continue;
        if (tracking > maxTracking + 0.001 || tracking < minTracking - 0.001) continue;

        const spaceRatio = wordSpacing / Math.max(0.5, spaceWidth);
        const trackingRatio = tracking / Math.max(1, fontSize);
        const scaleRatio = Math.abs(glyphScale - 1) / 0.01;
        const scaleJumpRatio = Math.abs(glyphScale - previousGlyphScale) / 0.01;
        const badness = 100 * Math.pow(Math.abs(spaceRatio) / 0.20, 3)
          + 55 * Math.pow(Math.abs(trackingRatio) / 0.0035, 3)
          + 42 * Math.pow(scaleRatio, 3)
          + 90 * Math.pow(scaleJumpRatio, 2);
        const fitness = spaceRatio < -0.04 ? 0 : spaceRatio <= 0.10 ? 1 : spaceRatio <= 0.22 ? 2 : 3;
        const candidate = { wordSpacing, tracking, glyphScale, badness, fitness };
        if (!best || candidate.badness < best.badness) best = candidate;
      }
      return best;
    };

    const FITNESS_COUNT = 4;
    const HYPHEN_STREAK_COUNT = 3;
    const GLYPH_SCALE_MIN = 0.98;
    const GLYPH_SCALE_STEP = 0.001;
    const GLYPH_SCALE_COUNT = 41;
    const glyphScaleBucket = (glyphScale: number) => Math.max(0, Math.min(
      GLYPH_SCALE_COUNT - 1,
      Math.round((glyphScale - GLYPH_SCALE_MIN) / GLYPH_SCALE_STEP),
    ));
    const HYPHEN_BUCKET_COUNT = 9;
    const hyphenCountBucket = (hyphenCount: number) => Math.min(HYPHEN_BUCKET_COUNT - 1, hyphenCount);
    const encodeState = (line: number, hyphenStreak: number, fitness: number, glyphScale: number, hyphenCount: number) => {
      const base = (line * HYPHEN_STREAK_COUNT + hyphenStreak) * FITNESS_COUNT + fitness;
      const packed = base * GLYPH_SCALE_COUNT + glyphScaleBucket(glyphScale);
      return packed * HYPHEN_BUCKET_COUNT + hyphenCountBucket(hyphenCount);
    };
    const decodeState = (key: number) => {
      const hyphenBucket = key % HYPHEN_BUCKET_COUNT;
      const packed = Math.floor(key / HYPHEN_BUCKET_COUNT);
      const glyphBucket = packed % GLYPH_SCALE_COUNT;
      const base = Math.floor(packed / GLYPH_SCALE_COUNT);
      return {
        line: Math.floor(base / (HYPHEN_STREAK_COUNT * FITNESS_COUNT)),
        hyphenStreak: Math.floor(base / FITNESS_COUNT) % HYPHEN_STREAK_COUNT,
        fitness: base % FITNESS_COUNT,
        glyphScale: GLYPH_SCALE_MIN + glyphBucket * GLYPH_SCALE_STEP,
        hyphenBucket,
      };
    };
    const lineGapPositions = (
      words: Word[],
      start: number,
      end: number,
      offset: number,
      spaceWidth: number,
      fit: LineFit | null,
    ) => {
      const positions: number[] = [];
      const scale = fit?.glyphScale ?? 1;
      let cursor = 0;
      for (let index = start; index < end; index++) {
        const word = words[index];
        if (index > start && word.spaceBefore) {
          const gapWidth = spaceWidth + (fit?.wordSpacing ?? 0) + (fit?.tracking ?? 0);
          positions.push(offset + (cursor + gapWidth / 2) * scale);
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
        const rawText = node.textContent ?? "";
        const cleanText = rawText.replace(/\u00ad/g, "");
        let rightProtrusion = 0;
        const terminalPunctuation = cleanText.match(/[.,;:!?…»”’)\]]$/)?.[0];
        const textNode = node.firstChild;
        if (terminalPunctuation && textNode?.nodeType === Node.TEXT_NODE && textNode.textContent) {
          const terminalFactor = terminalPunctuation === "." || terminalPunctuation === ","
            ? 0.75
            : terminalPunctuation === "…" ? 0.50
              : /[»”’)\]]/.test(terminalPunctuation) ? 0.55 : 0.40;
          const terminalRange = document.createRange();
          const rawLength = textNode.textContent.length;
          terminalRange.setStart(textNode, Math.max(0, rawLength - 1));
          terminalRange.setEnd(textNode, rawLength);
          rightProtrusion = Math.min(4.5, terminalRange.getBoundingClientRect().width * terminalFactor);
        }
        const word: Word = {
          node,
          width: node.getBoundingClientRect().width,
          spaceBefore,
          hyphenBefore,
          canBreakBefore,
          characters: cleanText.length,
          rightProtrusion,
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

      const runBreaker = (emergency: boolean, allowNaturalRescue = emergency): Break[] | null => {
      const states: Array<Map<number, State>> = Array.from({ length: words.length + 1 }, () => new Map());
      const initialFitness = 1;
      states[0].set(encodeState(0, 0, initialFitness, 1, 0), {
        cost: 0,
        from: -1,
        fromKey: -1,
        end: 0,
        justified: false,
        wordSpacing: 0,
        tracking: 0,
        glyphScale: 1,
        hyphenated: false,
        offset: 0,
        available: width,
        emergency: false,
        relaxed: false,
        finalCompressed: false,
        rightProtrusion: 0,
        fitness: initialFitness,
        hyphenCount: 0,
        gapPositions: [],
        riverPositions: [],
      });

      for (let start = 0; start < words.length; start++) {
        for (const [stateKey, previous] of states[start]) {
          const decoded = decodeState(stateKey);
          const lineNo = decoded.line;
          const previousHyphenStreak = decoded.hyphenStreak;
          const previousFitness = decoded.fitness;
          const previousHyphenCount = previous.hyphenCount;
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
            // Professional prose never uses three consecutive discretionary
            // hyphens when a justified/relaxed alternative exists. The final
            // rescue pass may still recover pathological narrow measures.
            if (hyphenBreak && previousHyphenStreak >= 2 && !allowNaturalRescue) continue;
            const natural = wordWidth + gaps * spaceWidth + (hyphenBreak ? hyphenWidth : 0);
            const rightProtrusion = hyphenBreak ? 0 : words[end].rightProtrusion;
            const opticalAvailable = available + rightProtrusion;

            const adjustment = opticalAvailable - natural;
            const trackingOps = Math.max(0, characters + gaps - 1);
            const semanticWordsOnLine = 1 + words
              .slice(start + 1, end + 1)
              .filter((word) => word.spaceBefore).length;
            // folio-final-hyphen-fragment-guard: never strand only the
            // continuation of a discretionary split on the final line.
            // A final fragment such as `de-` / `cyzji.` is a composition
            // defect, not an acceptable way to satisfy local line fit.
            if (last && semanticWordsOnLine === 1 && previous.hyphenated) continue;
            // Mirror live preview: bounded compression is a normal composition
            // tool, not an unreachable branch hidden behind natural <= measure.
            const finalCompressionFit = last
              && semanticWordsOnLine >= 2
              && adjustment < -0.75
                  ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, previous.glyphScale, false, true)
              : null;
            const strictFit = !last
              ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, previous.glyphScale, false)
              : finalCompressionFit;
            const fit = strictFit ?? (emergency && !last
              ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, previous.glyphScale, true)
              : null);
            if (!canBreak) continue;
            if (natural > available + 0.75 && !fit && (end > start || last)) break;
            // Mirror the reflow preview: only lines physically beside a drop
            // cap may stay natural in the strict pass. Ordinary prose still
            // has to reach the measure inside the normal spacing bounds.
            const dropcapRescue = !last && Boolean(cap) && lineNo < capLines
              && natural <= available + 0.75
              && (!fit || (gaps <= 2 && fit.wordSpacing > spaceWidth * 0.10));
            const emergencyRescue = allowNaturalRescue && !last && !fit && natural <= available + 0.75;
            const rescueNatural = dropcapRescue || emergencyRescue;
            const lineFit = dropcapRescue ? null : fit;
            const relaxedFit = !last && emergency && !strictFit && Boolean(lineFit);
            if (!last && !lineFit && !rescueNatural) continue;

            // Hyphenation splits one visible word into several compositor tokens.
            // Widow control must count semantic words, not discretionary pieces,
            // otherwise endings such as `de-` / `cyzji.` evade the rule entirely.
            // A one-word final line is undesirable, but not composition failure.
        // Let the existing high widow penalty compare it against alternative paths
        // instead of forcing the entire paragraph into the emergency rescue pass.
            const fill = Math.min(1, natural / Math.max(1, available));
            // A stranded final word is a real book-composition defect, especially
            // when the preceding line was itself hyphenated. Preserve feasible
            // alternatives instead of buying an ugly paragraph ending for a
            // slightly cheaper local line fit.
            const shortLastPenalty = last
              ? semanticWordsOnLine === 1
                ? 1800 + (previous.hyphenated ? 1200 : 0) + 600 * Math.pow(1 - fill, 2)
                : fill < 0.28 ? 220 * Math.pow((0.28 - fill) / 0.28, 2) : 0
              : 0;
            const cumulativeHyphenPenalty = previousHyphenCount < 2
              ? previousHyphenCount * 180
              : 1400 * Math.pow(previousHyphenCount - 1, 2);
            // Legal hyphenation points are not equally attractive. Very short visible
            // prefixes create a choppy book page, so prefer longer fragments without
            // banning language-valid 2/2 breaks when a narrow measure truly needs one.
            const shortHyphenFragmentPenalty = hyphenBreak
              ? words[end].characters <= 2 ? 850 : words[end].characters === 3 ? 420 : 0
              : 0;
            // Mirror the preview's paragraph-level hyphen-density cost so PDF and
            // print composition prefer the same calmer break pattern.
            const projectedLineCount = lineNo + 1;
            const projectedHyphenCount = previousHyphenCount + (hyphenBreak ? 1 : 0);
            const projectedHyphenRate = projectedHyphenCount / Math.max(1, projectedLineCount);
            const hyphenDensityPenalty = hyphenBreak && projectedLineCount >= 4 && projectedHyphenRate > 0.42
              ? 2600 * Math.pow((projectedHyphenRate - 0.42) / 0.18, 2)
              : 0;
            const hyphenPenalty = hyphenBreak
              ? 240 + previousHyphenStreak * 950 + cumulativeHyphenPenalty + shortHyphenFragmentPenalty + hyphenDensityPenalty
              : 0;
            const punctuationPenalty = hyphenBreak && /[,:;.!?…»”’)]$/.test(words[end].node.textContent ?? "") ? 80 : 0;
            const rescuePenalty = dropcapRescue
              ? 115 + 260 * Math.pow(1 - fill, 2)
              : rescueNatural ? 1100 + 900 * Math.pow(1 - fill, 2) : 0;
            const relaxedPenalty = relaxedFit
              ? Math.max(220, 420 - previousHyphenCount * 100)
              : 0;
            const finalCompressed = last && Boolean(finalCompressionFit);
            const finalCompressionPenalty = finalCompressed ? 160 : 0;
            const currentFitness = lineFit?.fitness ?? previousFitness;
            const fitnessDelta = Math.abs(currentFitness - previousFitness);
            const fitnessPenalty = lineNo === 0 || !lineFit
              ? 0
              : fitnessDelta > 1 ? 240 * fitnessDelta : fitnessDelta === 1 ? 14 : currentFitness === 3 ? 80 : 0;
            const currentGaps = lineGapPositions(words, start, end + 1, offset, spaceWidth, lineFit);
            const rivers = riverCost(currentGaps, previous, spaceWidth);
            const cost = previous.cost + (lineFit?.badness ?? 0) + rescuePenalty + relaxedPenalty + finalCompressionPenalty + hyphenPenalty + punctuationPenalty + shortLastPenalty + fitnessPenalty + rivers.cost;
            const nextLine = lineNo + 1;
            const nextStreak = hyphenBreak ? Math.min(2, previousHyphenStreak + 1) : 0;
            const nextHyphenCount = previousHyphenCount + (hyphenBreak ? 1 : 0);
            const nextKey = encodeState(nextLine, nextStreak, currentFitness, lineFit?.glyphScale ?? 1, nextHyphenCount);
            const old = states[end + 1].get(nextKey);
            if (!old || cost < old.cost) states[end + 1].set(nextKey, {
              cost,
              from: start,
              fromKey: stateKey,
              end: end + 1,
              justified: !last && Boolean(lineFit),
              wordSpacing: lineFit?.wordSpacing ?? 0,
              tracking: lineFit?.tracking ?? 0,
              glyphScale: lineFit?.glyphScale ?? 1,
              hyphenated: hyphenBreak,
              offset,
              available,
              emergency: emergencyRescue,
              relaxed: relaxedFit,
              finalCompressed,
              rightProtrusion: lineFit ? rightProtrusion : 0,
              fitness: currentFitness,
              hyphenCount: nextHyphenCount,
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
          glyphScale: state.glyphScale,
          hyphenated: state.hyphenated,
          offset: state.offset,
          available: state.available,
          emergency: state.emergency,
          relaxed: state.relaxed,
          finalCompressed: state.finalCompressed,
          rightProtrusion: state.rightProtrusion,
        });
        end = state.from;
        key = state.fromKey;
      }
      return reversed.reverse();
      };

      // Keep rescue out of the cost graph until both strict and relaxed
      // justified composition have failed completely.
      const breaks = runBreaker(true, false) ?? runBreaker(true, true);
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
        line.className = `folio-composed-line ${lineBreak.justified ? "folio-line-justified" : "folio-line-natural"}${lineBreak.relaxed ? " folio-line-relaxed" : ""}${lineBreak.emergency ? " folio-line-emergency" : ""}${lineBreak.finalCompressed ? " folio-line-final-compressed" : ""}`;
        if (lineBreak.relaxed) line.dataset.folioRelaxed = "true";
        if (lineBreak.emergency) line.dataset.folioEmergency = "true";
        const content = document.createElement("span");
        content.className = "folio-line-content";
        content.style.display = "inline-block";
        content.style.transformOrigin = "left center";
        content.append(fragments[lineNo]);
        if (lineBreak.end < words.length && words[lineBreak.end].hyphenBefore) content.append("-");
        line.append(content);
        line.style.marginLeft = `${lineBreak.offset}px`;
        line.style.width = `${lineBreak.available}px`;
        if (lineBreak.rightProtrusion > 0) line.dataset.folioRightProtrusion = String(lineBreak.rightProtrusion);
        if (lineBreak.justified || lineBreak.finalCompressed) {
          line.style.wordSpacing = `${baseWordSpacing + lineBreak.wordSpacing}px`;
          line.style.letterSpacing = `${baseTracking + lineBreak.tracking}px`;
          if (Math.abs(lineBreak.glyphScale - 1) > 0.00001) content.style.transform = `scaleX(${lineBreak.glyphScale})`;
          line.dataset.folioWordSpacing = String(lineBreak.wordSpacing);
          line.dataset.folioTracking = String(lineBreak.tracking);
          line.dataset.folioGlyphScale = String(lineBreak.glyphScale);
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

      // Mirror live preview exactly: calibrate the final transformed fragment
      // against Chromium's real rendered width. Platform font rasterizers can
      // differ slightly from the algebraic width model; correcting scale after
      // layout keeps export and preview on the same professional measure without
      // widening any spacing/tracking envelope.
      const corrections: Array<{ line: HTMLElement; content: HTMLElement; scale: number }> = [];
      for (const line of lines) {
        if (!line.classList.contains("folio-line-justified") && !line.classList.contains("folio-line-final-compressed")) continue;
        const content = line.querySelector<HTMLElement>(":scope > .folio-line-content");
        if (!content) continue;
        const rendered = content.getBoundingClientRect().width;
        const measure = line.getBoundingClientRect().width;
        const protrusion = Number(line.dataset.folioRightProtrusion ?? 0);
        const opticalMeasure = measure + protrusion;
        const currentScale = Number(line.dataset.folioGlyphScale ?? 1);
        if (rendered <= 0 || opticalMeasure <= 0 || !Number.isFinite(currentScale)) continue;
        const correctedScale = Math.max(0.98, Math.min(1.02, currentScale * opticalMeasure / rendered));
        if (Math.abs(correctedScale - currentScale) > 0.00001) {
          corrections.push({ line, content, scale: correctedScale });
        }
      }
      for (const correction of corrections) {
        correction.content.style.transform = Math.abs(correction.scale - 1) > 0.00001
          ? `scaleX(${correction.scale})`
          : "";
        correction.line.dataset.folioGlyphScale = String(correction.scale);
      }
    }
  });
}

import type { Page } from "puppeteer";
import type { Book } from "./types.ts";

export interface CompositionProgress {
  completedParagraphs: number;
  totalParagraphs: number;
  fraction: number;
}

/** Chromium print/PDF composition mirrors the reflow preview rules: legal
 * paragraph-level break optimisation, bounded spaces/tracking, hyphen ladder
 * penalties, semantic inline preservation and deterministic drop-cap geometry. */
export async function composeProfessionalParagraphs(
  page: Page,
  book: Book,
  onProgress?: (progress: CompositionProgress) => void,
): Promise<void> {
  if (book.typography.bodyAlign === "left") return;

  const reportProgress = (message: import("puppeteer").ConsoleMessage) => {
    if (!onProgress) return;
    const text = message.text();
    if (!text.startsWith("__FOLIO_COMPOSITION_PROGRESS__")) return;
    const [completed, total] = text.slice("__FOLIO_COMPOSITION_PROGRESS__".length).split("/").map(Number);
    if (Number.isFinite(completed) && Number.isFinite(total) && total > 0) {
      onProgress({ completedParagraphs: completed, totalParagraphs: total, fraction: completed / total });
    }
  };
  if (onProgress) page.on("console", reportProgress);

  try {
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
    const normalizedLanguage = (document.documentElement.lang || "en").toLowerCase();
    const englishProse = normalizedLanguage.startsWith("en");
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
      lexeme: string;
    };
    type SectionHyphenStats = { justifiedLines: number; hyphenatedLines: number };
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
      lineNo: number;
      hyphenCount: number;
      hyphenStreak: number;
      gapPositions: number[];
      riverPositions: number[];
    };
    const lineFitCache = new Map<string, LineFit | null>();

    const fitLine = (
      adjustment: number,
      gaps: number,
      trackingOps: number,
      spaceWidth: number,
      fontSize: number,
      naturalWidth: number,
      emergency = false,
      finalCompression = false,
    ): LineFit | null => {
      if (gaps <= 0) return null;
      const cacheKey = `${adjustment}:${gaps}:${trackingOps}:${emergency ? 1 : 0}:${finalCompression ? 1 : 0}`;
      const cached = lineFitCache.get(cacheKey);
      if (cached !== undefined) return cached;
      // The second pass may stretch inter-word space only slightly beyond
      // strict composition. Tracking and glyph expansion stay at strict limits;
      // this is a controlled justified fallback, not an excuse for loose copy.
      const maxWordSpacing = fontSize * 0.075;
      const relaxedCompressionEm = 0.120;
      // Match the live preview cross-platform Polish density rescue. It stays
      // below the 0.101em strict-spacing qualification ceiling and only wins when
      // its badness is cheaper than another discretionary hyphen.
      const strictCompressionEm = normalizedLanguage.startsWith("pl") ? 0.099 : 0.06;
      const minWordSpacing = emergency || finalCompression
        ? -(fontSize * relaxedCompressionEm)
        : -(fontSize * strictCompressionEm);
      const maxTracking = fontSize * 0.003;
      const minTracking = -fontSize * (emergency || finalCompression ? 0.003 : 0.0025);
      // Chromium wraps transformed text runs in transparency-group Form XObjects.
      // Ghostscript must flatten those groups for PDF/X-3, which rasterizes body
      // text and makes it unsearchable. Keep glyphs unscaled and fit with spacing
      // and legal line breaks instead.
      // Glyph scaling is intentionally disabled to preserve searchable text.
      // The former 41-step search admitted only scale=1, so calculate that
      // sole candidate directly instead of repeating an empty loop per break.
      const glyphScale = 1;
      const available = naturalWidth + adjustment;
      const scaledAdjustment = available / glyphScale - naturalWidth;
      let wordSpacing = Math.max(minWordSpacing, Math.min(maxWordSpacing, scaledAdjustment / gaps));
      let remaining = scaledAdjustment - wordSpacing * gaps;
      let tracking = trackingOps > 0 ? remaining / trackingOps : 0;
      if (tracking > maxTracking || tracking < minTracking) {
        tracking = Math.max(minTracking, Math.min(maxTracking, tracking));
        wordSpacing = (scaledAdjustment - tracking * trackingOps) / gaps;
      }
      wordSpacing = Math.max(minWordSpacing, Math.min(maxWordSpacing, wordSpacing));
      tracking = Math.max(minTracking, Math.min(maxTracking, tracking));

      // A line that only fits by visually collapsing whitespace is not a valid
      // book line. Keep a conservative pre-break reserve above the release
      // floor because Chromium/Paged.js can shave roughly 0.4 px from modeled
      // inline-space geometry at 11pt. The final gate still enforces the real
      // 0.12em floor, so this changes the break instead of lowering quality.
      const physicalGapFloor = Math.max(1.5, fontSize * 0.12) + Math.min(0.45, fontSize * 0.03);
      const minimumPhysicalWordSpacing = physicalGapFloor / glyphScale - spaceWidth - tracking;
      if (minimumPhysicalWordSpacing > maxWordSpacing + 0.000001) {
        lineFitCache.set(cacheKey, null);
        return null;
      }
      if (wordSpacing < minimumPhysicalWordSpacing) wordSpacing = minimumPhysicalWordSpacing;

      const residualPx = (scaledAdjustment - wordSpacing * gaps - tracking * trackingOps) * glyphScale;
      if (Math.abs(residualPx) > 1.705) {
        lineFitCache.set(cacheKey, null);
        return null;
      }

      const spaceRatio = wordSpacing / Math.max(0.5, spaceWidth);
      const trackingRatio = tracking / Math.max(1, fontSize);
      const badness = 100 * Math.pow(Math.abs(spaceRatio) / 0.20, 3)
        + 55 * Math.pow(Math.abs(trackingRatio) / 0.0035, 3)
        + 80 * Math.pow(Math.abs(residualPx) / 1.7, 2);
      const fitness = spaceRatio < -0.04 ? 0 : spaceRatio <= 0.10 ? 1 : spaceRatio <= 0.22 ? 2 : 3;
      const result = { wordSpacing, tracking, glyphScale, badness, fitness };
      lineFitCache.set(cacheKey, result);
      return result;
    };

    const FITNESS_COUNT = 4;
    const HYPHEN_STREAK_COUNT = 3;
    const HYPHEN_BUCKET_COUNT = 9;
    const hyphenCountBucket = (hyphenCount: number) => Math.min(HYPHEN_BUCKET_COUNT - 1, hyphenCount);
    const encodeState = (line: number, hyphenStreak: number, fitness: number, hyphenCount: number) => {
      const base = (line * HYPHEN_STREAK_COUNT + hyphenStreak) * FITNESS_COUNT + fitness;
      return base * HYPHEN_BUCKET_COUNT + hyphenCountBucket(hyphenCount);
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
    const nearestDistance = (sortedPositions: number[], target: number) => {
      let low = 0;
      let high = sortedPositions.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (sortedPositions[middle] < target) low = middle + 1;
        else high = middle;
      }
      const before = low > 0 ? Math.abs(target - sortedPositions[low - 1]) : Infinity;
      const after = low < sortedPositions.length ? Math.abs(sortedPositions[low] - target) : Infinity;
      return Math.min(before, after);
    };
    const riverCost = (current: number[], previous: State, spaceWidth: number) => {
      const tolerance = Math.max(1.5, spaceWidth * 0.72);
      const rivers: number[] = [];
      let cost = 0;
      for (const position of current) {
        const adjacent = nearestDistance(previous.gapPositions, position);
        if (adjacent < tolerance) {
          rivers.push(position);
          cost += 7 * Math.pow(1 - adjacent / tolerance, 2);
        }
        const established = nearestDistance(previous.riverPositions, position);
        if (established < tolerance) cost += 95 * Math.pow(1 - established / tolerance, 2);
      }
      return { cost, rivers };
    };

    const statsBySection = new WeakMap<HTMLElement, SectionHyphenStats>();
    const paragraphs = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const progressEvery = Math.max(1, Math.ceil(paragraphs.length / 20));
    for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
      if (paragraphIndex % progressEvery === 0) {
        console.info(`__FOLIO_COMPOSITION_PROGRESS__${paragraphIndex}/${paragraphs.length}`);
      }
      lineFitCache.clear();
      if (
        paragraph.closest(".chapter-subtitle,.note,.telegram,.sign,.inscription,.verse,.poem,.msg") ||
        paragraph.querySelector("br,img,svg,code,pre,.math,[data-math]")
      ) continue;

      const paragraphRectForFloat = paragraph.getBoundingClientRect();
      const sectionForFloat = paragraph.closest<HTMLElement>("section.chapter,section.backmatter,section.frontmatter");
      const overlapsFloat = sectionForFloat
        ? Array.from(sectionForFloat.querySelectorAll<HTMLElement>(".folio-illustration-block.folio-wrap-left,.folio-illustration-block.folio-wrap-right"))
            .some((illustration) => {
              const rect = illustration.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 &&
                rect.bottom > paragraphRectForFloat.top + 0.5 &&
                rect.top < paragraphRectForFloat.bottom - 0.5;
            })
        : false;
      if (overlapsFloat) {
        paragraph.classList.add("folio-float-native");
        continue;
      }

      const computed = getComputedStyle(paragraph);
      const fontSize = px(computed.fontSize) || 16;
      const paragraphRect = paragraph.getBoundingClientRect();
      if (paragraphRect.width < fontSize * 8) continue;
      const estimatedWords = paragraph.textContent?.trim().split(/\s+/).length ?? 0;
      if (estimatedWords > 1400) {
        paragraph.classList.add("folio-compositor-safe-fallback");
        continue;
      }

      const section = paragraph.closest<HTMLElement>("section.chapter,section.backmatter") ?? paragraph.parentElement;
      let sectionStats = section ? statsBySection.get(section) : undefined;
      if (!sectionStats) {
        sectionStats = { justifiedLines: 0, hyphenatedLines: 0 };
        if (section) statsBySection.set(section, sectionStats);
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

      // Print drop-cap paragraphs stay on Chromium's native float layout.
      // alignDropCaps() has already optically seated and calibrated the float
      // before this compositor runs. Converting that stable float into Folio's
      // synthetic line boxes reintroduces a second, slightly different vertical
      // grid and is the source of the repeated 3-vs-4 line phantom gap/overlap
      // regressions. Keep professional composition for every other paragraph.
      const keepNativeDropcap = Boolean(cap);
      if (keepNativeDropcap) {
        paragraph.classList.add("folio-native-dropcap");
        paragraph.classList.remove("folio-composed", "folio-composed-dropcap");
        paragraph.style.removeProperty("min-height");
        continue;
      }

      let capLines = 0;
      let capIntrusion = 0;
      let capLeft = 0;
      let capTop = 0;
      let capDepth = 0;
      if (cap) {
        const capRect = cap.getBoundingClientRect();
        const capStyle = getComputedStyle(cap);
        capDepth = Math.max(0, capRect.bottom + px(capStyle.marginBottom) - contentTop);

        // The compositor owns the FINAL vertical line grid, so it must decide how
        // many lines sit beside the cap using that grid. Reusing alignDropCaps()'
        // native-float line count left medium/XL caps with a phantom extra row
        // after composition because the composed rows land at slightly different
        // y coordinates.
        // Measure the text-ink inset using the SAME block-line geometry the
        // compositor will render. Reading the original native paragraph here is
        // subtly wrong: after composition, .folio-composed-line lands a few px
        // differently, which used to turn a real 3-line Medium cap into a
        // phantom 4-line reservation.
        let composedTextInsetTop = 0;
        let composedTextHeight = fontSize;
        const gridProbe = document.createElement("span");
        gridProbe.className = "folio-composed-line";
        gridProbe.style.position = "absolute";
        gridProbe.style.visibility = "hidden";
        gridProbe.style.pointerEvents = "none";
        gridProbe.style.left = "-10000px";
        gridProbe.style.top = "0";
        gridProbe.style.width = `${width}px`;
        gridProbe.textContent = "Hg";
        paragraph.append(gridProbe);
        const probeText = gridProbe.firstChild as Text | null;
        if (probeText) {
          const probeRange = document.createRange();
          probeRange.selectNodeContents(probeText);
          const textRect = probeRange.getClientRects()[0];
          const lineRect = gridProbe.getBoundingClientRect();
          if (textRect) {
            composedTextInsetTop = textRect.top - lineRect.top;
            if (textRect.height) composedTextHeight = textRect.height;
          }
        }
        gridProbe.remove();

        const firstBodyRectTop = contentTop + composedTextInsetTop;
        const firstBodyRectHeight = composedTextHeight;

        let finalGridLines = 0;
        const canvas = document.createElement("canvas").getContext("2d");
        if (canvas) {
          canvas.font = `${capStyle.fontStyle} ${capStyle.fontWeight} ${capStyle.fontSize} ${capStyle.fontFamily}`;
          const metrics = canvas.measureText(cap.textContent || "H");
          const asc = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent;
          const desc = metrics.fontBoundingBoxDescent || metrics.actualBoundingBoxDescent;
          const capLineHeight = capStyle.lineHeight === "normal"
            ? asc + desc
            : px(capStyle.lineHeight) || asc + desc;
          const baseline =
            capRect.top +
            px(capStyle.paddingTop) +
            (capLineHeight - (asc + desc)) / 2 +
            asc;
          const inkTop = baseline - metrics.actualBoundingBoxAscent;
          const inkBottom = baseline + metrics.actualBoundingBoxDescent;

          for (let line = 0; line < 7; line++) {
            const rowTop = firstBodyRectTop + line * lineHeight;
            const rowBottom = rowTop + firstBodyRectHeight;
            const intersectsInk =
              inkBottom > rowTop + 0.5 &&
              inkTop < rowBottom - 0.5;
            if (intersectsInk) finalGridLines = line + 1;
            else if (rowTop >= inkBottom - 0.5) break;
          }
        }

        const measuredLines = Number(cap.dataset.folioDropcapLines ?? 0);
        capLines = finalGridLines >= 2
          ? Math.max(2, Math.min(6, finalGridLines))
          : Number.isFinite(measuredLines) && measuredLines >= 2
            ? Math.max(2, Math.min(6, Math.round(measuredLines)))
            : Math.max(2, Math.min(6, Math.ceil(capDepth / Math.max(1, lineHeight) - 0.08)));

        // The cap is anchored to the paragraph's content edge after composition;
        // use its physical width rather than any transient native-float x offset.
        capIntrusion = Math.max(0, capRect.width + px(capStyle.marginRight));
        capIntrusion = Math.min(width * 0.46, capIntrusion);
        capLeft = paddingLeft;
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
      let separatedBreakable = true;
      let hasWord = false;
      for (const textNode of textNodes) {
        const fragment = document.createDocumentFragment();
        for (const part of textNode.data.split(/([ \t\r\n\u00a0]+)/)) {
          if (!part) continue;
          if (/^[ \t\r\n\u00a0]+$/.test(part)) {
            separated = true;
            separatedBreakable = !part.includes("\u00a0");
            fragment.append(separatedBreakable ? " " : "\u00a0");
            continue;
          }
          const dashPieces: string[] = [];
          let dashStart = 0;
          for (let dashIndex = 0; dashIndex < part.length - 1; dashIndex++) {
            if (part[dashIndex] === "—" && dashIndex > dashStart && /[\p{L}\p{N}]/u.test(part[dashIndex + 1])) {
              dashPieces.push(part.slice(dashStart, dashIndex + 1));
              dashStart = dashIndex + 1;
            }
          }
          dashPieces.push(part.slice(dashStart));
          dashPieces.forEach((dashPiece, dashPieceIndex) => {
            dashPiece.split("\u00ad").forEach((piece, index) => {
              if (!piece) return;
              const span = document.createElement("span");
              const discretionary = index > 0;
              const dashBreakBefore = dashPieceIndex > 0 && index === 0;
              span.className = "folio-word";
              span.dataset.folioSpaceBefore = hasWord && separated ? "true" : "false";
              span.dataset.folioBreakableSpaceBefore = hasWord && separated && separatedBreakable ? "true" : "false";
              span.dataset.folioHyphenBefore = discretionary ? "true" : "false";
              span.dataset.folioDashBreakBefore = dashBreakBefore ? "true" : "false";
              span.textContent = (discretionary ? "\u00ad" : "") + piece;
              span.style.whiteSpace = "nowrap";
              fragment.append(span);
              hasWord = true;
              separated = false;
              separatedBreakable = true;
            });
            });
        }
        textNode.replaceWith(fragment);
      }

      const wordNodes = Array.from(paragraph.querySelectorAll<HTMLElement>(".folio-word"));
      if (!wordNodes.length) continue;
      const atomicIds = new WeakMap<Element, number>();
      let nextAtomicId = 1;
      let previousAtomic = 0;
      let previousLexeme = "";
      const words: Word[] = wordNodes.map((node) => {
        const atomic = node.closest(atomicInline);
        let atomicId = 0;
        if (atomic) {
          atomicId = atomicIds.get(atomic) ?? nextAtomicId++;
          atomicIds.set(atomic, atomicId);
        }
        const spaceBefore = node.dataset.folioSpaceBefore === "true";
        const breakableSpaceBefore = node.dataset.folioBreakableSpaceBefore === "true";
        const hyphenBefore = node.dataset.folioHyphenBefore === "true";
        const dashBreakBefore = node.dataset.folioDashBreakBefore === "true";
        const articleGlue = englishProse
          && spaceBefore
          && breakableSpaceBefore
          && /^(?:a|an|the)$/.test(previousLexeme);
        const structuralBreakBefore = (dashBreakBefore || (spaceBefore && breakableSpaceBefore && !articleGlue))
          && !(atomicId && atomicId === previousAtomic);
        const canBreakBefore = hyphenBefore || structuralBreakBefore;
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
          lexeme: cleanText.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "").toLowerCase(),
        };
        previousAtomic = atomicId;
        previousLexeme = word.lexeme;
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
      states[0].set(encodeState(0, 0, initialFitness, 0), {
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
        lineNo: 0,
        hyphenCount: 0,
        hyphenStreak: 0,
        gapPositions: [],
        riverPositions: [],
      });

      for (let start = 0; start < words.length; start++) {
        const startStates = states[start];
        if (startStates.size === 0) continue;
        const gapPositionsByEnd = new Map<number, Map<number, number[]>>();
        for (const [stateKey, previous] of startStates) {
          const lineNo = previous.lineNo;
          const previousHyphenStreak = previous.hyphenStreak;
          const previousFitness = previous.fitness;
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
            const hyphenStreakOverflow = hyphenBreak && previousHyphenStreak >= 2;
            // Three consecutive discretionary hyphens are never an acceptable book
            // composition outcome. Remove that path from the graph instead of merely
            // making it expensive, so the optimiser must choose an earlier clean break.
            if (hyphenStreakOverflow) continue;
            if (!canBreak) continue;
            const natural = wordWidth + gaps * spaceWidth + (hyphenBreak ? hyphenWidth : 0);
            // Optical margin alignment: a line-ending discretionary hyphen may hang
        // slightly into the margin, just like terminal punctuation. Keeping part
        // of the hyphen outside the measure prevents needless spacing distortion
        // without changing the text measure or any QA threshold.
        const rightProtrusion = hyphenBreak
          ? Math.min(2.55, hyphenWidth * 0.51)
          : words[end].rightProtrusion;
            // Optical protrusion should relieve an already-full line, not force a
        // short line to stretch farther merely to hang punctuation. For expansion
        // keep the normal measure; for full/overfull lines allow the optical edge.
        const appliedRightProtrusion = natural >= available ? rightProtrusion : 0;
        const opticalAvailable = available + appliedRightProtrusion;

            const adjustment = opticalAvailable - natural;
            const trackingOps = Math.max(0, characters + gaps - 1);
            const semanticWordsOnLine = 1 + gaps;
            // folio-final-hyphen-fragment-guard: never strand only the
            // continuation of a discretionary split on the final line.
            // A final fragment such as `de-` / `cyzji.` is a composition
            // defect, not an acceptable way to satisfy local line fit.
            const hyphenWidow = last && semanticWordsOnLine === 1 && previous.hyphenated;
            // Mirror live preview: bounded compression is a normal composition
            // tool, not an unreachable branch hidden behind natural <= measure.
            const finalCompressionFit = last
              && semanticWordsOnLine >= 2
              && adjustment < -0.75
                  ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, false, true)
              : null;
            const strictFit = !last
              ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural)
              : finalCompressionFit;
            const emergencyFit = emergency && !last
              ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, true)
              : null;
            const fit = strictFit ?? emergencyFit;
            if (natural > available + 0.75 && !fit && (end > start || last)) {
              break;
            }
            // Mirror the reflow preview: only lines physically beside a drop
            // cap may stay natural in the strict pass. Ordinary prose still
            // has to reach the measure inside the normal spacing bounds.
            const dropcapRescue = false;
            const emergencyRescue = allowNaturalRescue && !last && !fit && natural <= available + 0.75;
            const rescueNatural = emergencyRescue;
            const hasStrictFit = Boolean(strictFit);
            if (!last && !fit && !rescueNatural) continue;

            const lineFit = fit;
            const relaxedFit = !last && emergency && !hasStrictFit && Boolean(lineFit);
            if (lineFit && !relaxedFit && !previous.relaxed && (previous.justified || previous.finalCompressed)
              && Math.abs(lineFit.wordSpacing - previous.wordSpacing) / Math.max(1, fontSize) > 0.1600001) continue;
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
            const projectedSectionLineCount = sectionStats.justifiedLines + projectedLineCount;
            const projectedSectionHyphenCount = sectionStats.hyphenatedLines + projectedHyphenCount;
            const projectedHyphenRate = projectedSectionHyphenCount / Math.max(1, projectedSectionLineCount);
            const hyphenDensityPenalty = hyphenBreak && projectedLineCount >= 4 && projectedHyphenRate > 0.42
              ? 2600 * Math.pow((projectedHyphenRate - 0.42) / 0.18, 2)
              : 0;
            const hyphenPenalty = hyphenBreak
              ? 240 + previousHyphenStreak * 950 + cumulativeHyphenPenalty + shortHyphenFragmentPenalty + hyphenDensityPenalty
              : 0;
            const punctuationPenalty = hyphenBreak && /[,:;.!?…»”’)]$/.test(words[end].node.textContent ?? "") ? 80 : 0;
            const strandedEnglishArticlePenalty = !last
              && !hyphenBreak
              && englishProse
              && /^(?:a|an|the)$/.test(words[end].lexeme)
              ? 12000
              : 0;
            const rescuePenalty = dropcapRescue
              ? 115 + 260 * Math.pow(1 - fill, 2)
              : rescueNatural ? 1100 + 900 * Math.pow(1 - fill, 2) : 0;
            const relaxedPenalty = relaxedFit
              ? Math.max(220, 420 - previousHyphenCount * 100)
              : 0;
            const finalCompressed = last && Boolean(lineFit);
            const finalCompressionPenalty = finalCompressed ? 160 : 0;
            const structuralPenalty = (hyphenStreakOverflow ? 25000 : 0) + (hyphenWidow ? 25000 : 0);
            // The release gate evaluates hyphenated lines against justified lines.
            // Charge the completed paragraph on the final transition as well, so a
            // sequence that looked acceptable while it was being built cannot end
            // above the same 0.45 ceiling merely because the natural final line was
            // included in the local projected-line denominator.
            const completedJustifiedLines = last ? Math.max(1, sectionStats.justifiedLines + lineNo) : 0;
            const completedHyphenCount = last ? sectionStats.hyphenatedLines + previousHyphenCount : 0;
            const completedHyphenRate = last ? completedHyphenCount / completedJustifiedLines : 0;
            // Mirror preview: section QA remains hard-capped at 0.45, while a
            // short paragraph may cross that discrete ratio only at a huge cost
            // rather than forcing a visibly ragged emergency line.
            const finalHyphenDensityPenalty = last && completedJustifiedLines >= 4 && completedHyphenRate > 0.45
              ? 80000 * Math.pow((completedHyphenRate - 0.45) / 0.15, 2)
              : 0;
            const currentFitness = lineFit?.fitness ?? previousFitness;
            const fitnessDelta = Math.abs(currentFitness - previousFitness);
            const fitnessPenalty = lineNo === 0 || !lineFit
              ? 0
              : fitnessDelta > 1 ? 240 * fitnessDelta : fitnessDelta === 1 ? 14 : currentFitness === 3 ? 80 : 0;
            let gapsByOffset = gapPositionsByEnd.get(end);
            let currentGaps = gapsByOffset?.get(offset);
            if (!currentGaps) {
              currentGaps = lineGapPositions(words, start, end + 1, offset, spaceWidth, lineFit);
              if (!gapsByOffset) {
                gapsByOffset = new Map<number, number[]>();
                gapPositionsByEnd.set(end, gapsByOffset);
              }
              gapsByOffset.set(offset, currentGaps);
            }
            const rivers = riverCost(currentGaps, previous, spaceWidth);
            const cost = previous.cost + (lineFit?.badness ?? 0) + rescuePenalty + relaxedPenalty + finalCompressionPenalty + structuralPenalty + finalHyphenDensityPenalty + hyphenPenalty + punctuationPenalty + strandedEnglishArticlePenalty + shortLastPenalty + fitnessPenalty + rivers.cost;
            const nextLine = lineNo + 1;
            const nextStreak = hyphenBreak ? Math.min(2, previousHyphenStreak + 1) : 0;
            const nextHyphenCount = previousHyphenCount + (hyphenBreak ? 1 : 0);
            const nextKey = encodeState(nextLine, nextStreak, currentFitness, nextHyphenCount);
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
              rightProtrusion: lineFit ? appliedRightProtrusion : 0,
              fitness: currentFitness,
              lineNo: nextLine,
              hyphenCount: nextHyphenCount,
              hyphenStreak: nextStreak,
              gapPositions: currentGaps,
              riverPositions: rivers.rivers,
            });
          }
        }
      }

      let bestKey = -1;
      let bestCost = Number.POSITIVE_INFINITY;
      let bestSectionRate = Number.POSITIVE_INFINITY;
      let bestHyphenBudgetPriority = 3;
      for (const [key, state] of states[words.length]) {
        const paragraphJustifiedLines = Math.max(0, state.lineNo - 1);
        const sectionJustifiedLines = sectionStats.justifiedLines + paragraphJustifiedLines;
        const sectionHyphenatedLines = sectionStats.hyphenatedLines + state.hyphenCount;
        const sectionRate = sectionHyphenatedLines / Math.max(1, sectionJustifiedLines);
        // 0.45 is the release ceiling, not the composition target. Prefer 0.40
        // when feasible, preserving cross-platform headroom without loosening fit.
        const hyphenBudgetPriority = sectionRate <= 0.40 + 1e-9
          ? 0
          : sectionRate <= 0.45 + 1e-9 ? 1 : 2;
        const betterSamePriority = hyphenBudgetPriority < 2
          ? state.cost < bestCost
          : sectionRate < bestSectionRate - 1e-9
            || (Math.abs(sectionRate - bestSectionRate) <= 1e-9 && state.cost < bestCost);
        if (hyphenBudgetPriority < bestHyphenBudgetPriority
          || (hyphenBudgetPriority === bestHyphenBudgetPriority && betterSamePriority)) {
          bestHyphenBudgetPriority = hyphenBudgetPriority;
          bestCost = state.cost;
          bestSectionRate = sectionRate;
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
        paragraph.dataset.folioDropcapLines = String(capLines);
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

      sectionStats.justifiedLines += breaks.filter((lineBreak) => lineBreak.justified).length;
      sectionStats.hyphenatedLines += breaks.filter((lineBreak) => lineBreak.justified && lineBreak.hyphenated).length;

      // Verify/calibrate what the reader actually sees. fitLine now rejects
      // candidates below the physical gap floor, so this is only a rasterisation
      // safety net and should need at most a tiny correction.
      const calibratedLines: Array<{
        line: HTMLElement;
        content: HTMLElement;
        opticalMeasure: number;
        fontSize: number;
        gapFloor: number;
        lineWords: HTMLElement[];
      }> = [];
      const semanticGapMinimum = (lineWords: HTMLElement[]) => {
        let minimum = Number.POSITIVE_INFINITY;
        let previousRect = lineWords[0]?.getBoundingClientRect();
        for (let index = 1; index < lineWords.length; index++) {
          const currentRect = lineWords[index].getBoundingClientRect();
          if (lineWords[index].dataset.folioSpaceBefore === "true" && previousRect) {
            minimum = Math.min(minimum, currentRect.left - previousRect.right);
          }
          previousRect = currentRect;
        }
        return minimum;
      };
      for (const line of lines) {
        if (!line.classList.contains("folio-line-justified") && !line.classList.contains("folio-line-final-compressed")) {
          continue;
        }
        const content = line.querySelector<HTMLElement>(":scope > .folio-line-content");
        if (!content) continue;
        const rendered = content.getBoundingClientRect().width;
        const measure = line.getBoundingClientRect().width;
        const protrusion = Number(line.dataset.folioRightProtrusion ?? 0);
        const opticalMeasure = measure + protrusion;
        if (rendered <= 0 || opticalMeasure <= 0) continue;

        const lineFontSize = px(getComputedStyle(line).fontSize) || fontSize;
        const lineWords = [...line.querySelectorAll<HTMLElement>(".folio-word")];
        calibratedLines.push({
          line,
          content,
          opticalMeasure,
          fontSize: lineFontSize,
          gapFloor: Math.max(1.5, lineFontSize * 0.12),
          lineWords,
        });
      }

      const gapAdjustments: Array<{ line: HTMLElement; deficit: number; currentWordSpacing: number }> = [];
      for (const item of calibratedLines) {
        const minimumGap = semanticGapMinimum(item.lineWords);
        if (Number.isFinite(minimumGap) && minimumGap < item.gapFloor - 0.005) {
          const deficit = item.gapFloor - minimumGap;
          if (deficit > 0.20) {
            item.line.dataset.folioGapViolation = "true";
          } else {
            gapAdjustments.push({
              line: item.line,
              deficit,
              currentWordSpacing: Number(item.line.dataset.folioWordSpacing ?? 0),
            });
          }
        }
      }
      for (const adjustment of gapAdjustments) {
        adjustment.line.style.wordSpacing = `${baseWordSpacing + adjustment.currentWordSpacing + adjustment.deficit}px`;
        adjustment.line.dataset.folioWordSpacing = String(adjustment.currentWordSpacing + adjustment.deficit);
      }

      const trackingAdjustments = calibratedLines.map((item) => {
        const rendered = item.content.getBoundingClientRect().width;
        if (rendered > 0) {
          const correction = Math.max(.98, Math.min(1.01, item.opticalMeasure / rendered));
          const characters = Math.max(1, [...(item.content.textContent ?? "").replace(/\u00ad/g, "")].length - 1);
          const trackingCorrection = (rendered * correction - rendered) / characters;
          const currentTracking = px(getComputedStyle(item.line).letterSpacing);
          return { ...item, trackingCorrection, currentTracking };
        }
        return { ...item, trackingCorrection: 0, currentTracking: 0 };
      });
      for (const { line, trackingCorrection, currentTracking } of trackingAdjustments) {
        line.style.letterSpacing = `${currentTracking + trackingCorrection}px`;
        line.dataset.folioTracking = String(Number(line.dataset.folioTracking ?? 0) + trackingCorrection);
        line.dataset.folioGlyphScale = "1";
      }

      for (const item of calibratedLines) {
        const finalMinimumGap = semanticGapMinimum(item.lineWords);
        if (Number.isFinite(finalMinimumGap)) {
          item.line.dataset.folioMinSemanticGap = String(finalMinimumGap);
          if (finalMinimumGap < item.gapFloor - 0.005) item.line.dataset.folioGapViolation = "true";
        }
      }
    }
    console.info(`__FOLIO_COMPOSITION_PROGRESS__${paragraphs.length}/${paragraphs.length}`);
  });
  } finally {
    if (onProgress) page.off("console", reportProgress);
  }
}

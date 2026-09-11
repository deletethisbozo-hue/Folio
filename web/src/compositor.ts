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
let lastBreakFailure: unknown = null;

type Word = {
  node: HTMLElement;
  width: number;
  spaceBefore: boolean;
  hyphenBefore: boolean;
  canBreakBefore: boolean;
  characters: number;
  rightProtrusion: number;
};

type LineFit = {
  wordSpacing: number;
  tracking: number;
  glyphScale: number;
  badness: number;
  fitness: number;
};

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

type Geometry = {
  width: number;
  indent: number;
  cap: HTMLElement | null;
  capLines: number;
  capIntrusion: number;
  capLeft: number;
  capTop: number;
  capDepth: number;
};

type SectionHyphenStats = { justifiedLines: number; hyphenatedLines: number };

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
  const originalStyle = paragraph.dataset.folioOriginalStyle;
  if (originalStyle !== undefined) {
    if (originalStyle === "__none__") paragraph.removeAttribute("style");
    else paragraph.setAttribute("style", originalStyle);
    delete paragraph.dataset.folioOriginalStyle;
  }
  paragraph.classList.remove(
    "folio-composed",
    "folio-composed-dropcap",
    "folio-compositor-safe-fallback",
  );
  delete paragraph.dataset.folioCompositionLanguage;
}

function ensureCompositionStyle(document: Document): void {
  let style = document.getElementById("folio-compositor-fallback") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "folio-compositor-fallback";
    document.head.appendChild(style);
  }
  const pending = PROSE_SELECTORS.map((selector) => `${selector}:not(.folio-composed)`).join(",");
  style.textContent = `
${pending}{text-align:left!important;text-align-last:left!important;-webkit-hyphens:manual!important;hyphens:manual!important;overflow-wrap:normal!important;word-break:normal!important;word-spacing:normal!important;letter-spacing:normal!important;text-wrap:pretty!important}
.folio-composed{position:relative!important;text-indent:0!important;text-align:left!important;text-align-last:left!important;overflow:visible!important}
.folio-composed-line{display:block!important;box-sizing:border-box!important;white-space:nowrap!important;text-indent:0!important;text-align:left!important;text-align-last:left!important}
.folio-composed-dropcap>.dropcap.folio-composed-cap{float:none!important;position:absolute!important;z-index:1}
.folio-compositor-safe-fallback{text-align:left!important;text-align-last:left!important}
.scene-break{display:block!important;text-align:center!important;text-align-last:center!important;word-spacing:normal!important;letter-spacing:normal!important}`;
}

function tokenize(paragraph: HTMLElement, language: string): Word[] {
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

  const nodes = Array.from(paragraph.querySelectorAll<HTMLElement>(".folio-word"));
  const atomicIds = new WeakMap<Element, number>();
  let nextAtomicId = 1;
  let previousAtomic = 0;
  let previousLexeme = "";
  const englishProse = language.toLowerCase().startsWith("en");
  return nodes.map((node) => {
    const atomic = node.closest(ATOMIC_INLINE);
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
    };
    previousAtomic = atomicId;
    previousLexeme = cleanText.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "").toLowerCase();
    return word;
  });
}

/**
 * Metadata supplies the book's default language, but real manuscripts can
 * contain a paragraph in the other language Folio supports. Applying Polish
 * patterns to clearly English prose (or vice versa) produces invalid break
 * points and can make an otherwise strict paragraph require an emergency
 * ragged line on a different platform/font rasterizer.
 *
 * Honour an explicit paragraph language first. Otherwise override the book
 * default only when the paragraph contains a deliberately strong signal; an
 * ambiguous or short paragraph keeps the metadata language.
 */
export function compositionLanguageForText(text: string, bookLanguage: string, explicitLanguage = ""): string {
  const explicit = explicitLanguage.trim();
  if (explicit) return explicit;

  const sample = text
    .replace(/[\u00ad\u00a0]/g, " ")
    .toLocaleLowerCase()
    .slice(0, 4_000);
  if (sample.length < 80) return bookLanguage;

  const polishDiacritics = sample.match(/[ąćęłńóśźż]/g)?.length ?? 0;
  const polishWords = sample.match(/\b(?:się|nie|jest|oraz|który|która|przez|jego|jej|był|była|żeby|może|tylko|jeszcze|tego|tych)\b/g)?.length ?? 0;
  const englishWords = sample.match(/\b(?:the|and|that|this|with|from|would|could|was|were|had|has|have|without|where|which|into|their|there|before|after)\b/g)?.length ?? 0;
  const defaultPolish = /^pl(?:-|$)/i.test(bookLanguage);

  if (defaultPolish && polishDiacritics === 0 && polishWords === 0 && englishWords >= 5) return "en";
  if (!defaultPolish && polishDiacritics >= 3 && polishWords >= 3) return "pl";
  return bookLanguage;
}

function compositionLanguage(paragraph: HTMLElement, bookLanguage: string): string {
  return compositionLanguageForText(
    paragraph.textContent ?? "",
    bookLanguage,
    paragraph.getAttribute("lang") ?? "",
  );
}

function fitLine(
  adjustment: number,
  gaps: number,
  trackingOps: number,
  spaceWidth: number,
  fontSize: number,
  naturalWidth: number,
  previousGlyphScale = 1,
  emergency = false,
  finalCompression = false,
  language = "en",
  selection: "badness" | "continuity" = "badness",
): LineFit | null {
  if (gaps <= 0) return null;

  const maxWordSpacing = emergency
    ? Math.min(spaceWidth * 0.46, fontSize * 0.113)
    : Math.min(spaceWidth * 0.50, fontSize * 0.10);
  const normalizedLanguage = language.toLowerCase();
  const relaxedCompressionEm = normalizedLanguage.startsWith("en") ? 0.07 : 0.0595;
  // Windows and Linux rasterize the same serif faces a little differently.
  // Keep the normal line fitter inside the release gate, but give Polish prose
  // enough bounded compression headroom to choose a clean word boundary instead
  // of exceeding the 0.45 section hyphen-density ceiling. The optimiser still
  // pays badness for every compressed gap, so this is an available rescue path,
  // not the new preferred spacing.
  const strictCompressionEm = normalizedLanguage.startsWith("pl") ? 0.085 : 0.06;
  const minWordSpacing = emergency || finalCompression
    ? -Math.min(spaceWidth * 0.28, fontSize * relaxedCompressionEm)
    : -Math.min(spaceWidth * 0.34, fontSize * strictCompressionEm);
  const maxTracking = fontSize * 0.003;
  const minTracking = -fontSize * (emergency || finalCompression ? 0.003 : 0.0025);
  const maxGlyphScaleDelta = 0.01;
  const available = naturalWidth + adjustment;
  let best: LineFit | null = null;
  let bestRank = Number.POSITIVE_INFINITY;

  for (let step = -20; step <= 20; step++) {
    const glyphScale = 1 + step * 0.0005;
    if (Math.abs(glyphScale - 1) > maxGlyphScaleDelta + 0.000001) continue;
    if (Math.abs(glyphScale - previousGlyphScale) > 0.012) continue;
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
    const residualPx = (scaledAdjustment - wordSpacing * gaps - tracking * trackingOps) * glyphScale;
    if (Math.abs(residualPx) > 1.7) continue;

    const spaceRatio = wordSpacing / Math.max(0.5, spaceWidth);
    const trackingRatio = tracking / Math.max(1, fontSize);
    const scaleRatio = Math.abs(glyphScale - 1) / 0.01;
    const scaleJumpRatio = Math.abs(glyphScale - previousGlyphScale) / 0.01;
    const badness = 100 * Math.pow(Math.abs(spaceRatio) / 0.20, 3)
      + 55 * Math.pow(Math.abs(trackingRatio) / 0.0035, 3)
      + 42 * Math.pow(scaleRatio, 3)
      + 90 * Math.pow(scaleJumpRatio, 2)
      + 80 * Math.pow(Math.abs(residualPx) / 1.7, 2);
    const fitness = spaceRatio < -0.04 ? 0 : spaceRatio <= 0.10 ? 1 : spaceRatio <= 0.22 ? 2 : 3;
    const candidate = { wordSpacing, tracking, glyphScale, badness, fitness };
    const rank = selection === "continuity"
      ? Math.abs(glyphScale - previousGlyphScale) * 1_000_000 + candidate.badness
      : candidate.badness;
    if (!best || rank < bestRank) {
      best = candidate;
      bestRank = rank;
    }
  }
  return best;
}

const FITNESS_COUNT = 4;
const HYPHEN_STREAK_COUNT = 3;
const GLYPH_SCALE_MIN = 0.99;
const GLYPH_SCALE_STEP = 0.0005;
const GLYPH_SCALE_COUNT = 41;

function glyphScaleBucket(glyphScale: number): number {
  return Math.max(0, Math.min(
    GLYPH_SCALE_COUNT - 1,
    Math.round((glyphScale - GLYPH_SCALE_MIN) / GLYPH_SCALE_STEP),
  ));
}

const HYPHEN_BUCKET_COUNT = 9;

function hyphenCountBucket(hyphenCount: number): number {
  return Math.min(HYPHEN_BUCKET_COUNT - 1, hyphenCount);
}

function encodeState(
  line: number,
  hyphenStreak: number,
  fitness: number,
  glyphScale: number,
  hyphenCount: number,
): number {
  const base = (line * HYPHEN_STREAK_COUNT + hyphenStreak) * FITNESS_COUNT + fitness;
  const packed = base * GLYPH_SCALE_COUNT + glyphScaleBucket(glyphScale);
  return packed * HYPHEN_BUCKET_COUNT + hyphenCountBucket(hyphenCount);
}

function decodeState(key: number): { line: number; hyphenStreak: number; fitness: number; glyphScale: number; hyphenBucket: number } {
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
}

function gapPositions(
  words: Word[],
  start: number,
  end: number,
  offset: number,
  spaceWidth: number,
  fit: LineFit | null,
): number[] {
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
}

function riverCost(current: number[], previous: State, spaceWidth: number): { cost: number; rivers: number[] } {
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
}

function lineGeometry(line: number, geometry: Geometry): { offset: number; available: number } {
  if (geometry.cap && line < geometry.capLines) {
    return {
      offset: geometry.capIntrusion,
      available: Math.max(1, geometry.width - geometry.capIntrusion),
    };
  }
  const offset = line === 0 ? geometry.indent : 0;
  return { offset, available: Math.max(1, geometry.width - offset) };
}

function chooseBreaks(
  words: Word[],
  geometry: Geometry,
  spaceWidth: number,
  hyphenWidth: number,
  fontSize: number,
  emergency = false,
  allowNaturalRescue = emergency,
  language = "en",
  sectionStats: SectionHyphenStats = { justifiedLines: 0, hyphenatedLines: 0 },
): Break[] | null {
  const count = words.length;
  lastBreakFailure = null;
  const rejectedBreaks: Array<Record<string, unknown>> = [];
  const states: Array<Map<number, State>> = Array.from({ length: count + 1 }, () => new Map());
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
    available: geometry.width,
    emergency: false,
    relaxed: false,
    finalCompressed: false,
    rightProtrusion: 0,
    fitness: initialFitness,
    hyphenCount: 0,
    gapPositions: [],
    riverPositions: [],
  });

  for (let start = 0; start < count; start++) {
    for (const [stateKey, previous] of states[start]) {
      const decoded = decodeState(stateKey);
      const line = decoded.line;
      const previousHyphenStreak = decoded.hyphenStreak;
      const previousFitness = decoded.fitness;
      const previousHyphenCount = previous.hyphenCount;
      const { offset, available } = lineGeometry(line, geometry);
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
        const hyphenStreakOverflow = hyphenBreak && previousHyphenStreak >= 2;
        // Three consecutive discretionary hyphens are never an acceptable book
        // composition outcome. Remove that path from the graph instead of merely
        // making it expensive, so the optimiser must choose an earlier clean break.
        if (hyphenStreakOverflow) continue;
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
        const semanticWordsOnLine = 1 + words
          .slice(start + 1, end + 1)
          .filter((word) => word.spaceBefore).length;
        const hyphenWidow = last && semanticWordsOnLine === 1 && previous.hyphenated;
        const finalCompressionFit = last
          && semanticWordsOnLine >= 2
          && adjustment < -0.75
          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, previous.glyphScale, false, true, language)
          : null;
        const finalCompressionContinuityFit = last
          && semanticWordsOnLine >= 2
          && adjustment < -0.75
          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, previous.glyphScale, false, true, language, "continuity")
          : null;
        const strictFit = !last
          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, previous.glyphScale, false, false, language)
          : finalCompressionFit;
        const strictContinuityFit = !last
          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, previous.glyphScale, false, false, language, "continuity")
          : finalCompressionContinuityFit;
        const fit = strictFit ?? (emergency && !last
          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, previous.glyphScale, true, false, language)
          : null);
        const continuityFit = strictContinuityFit ?? (emergency && !last
          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, previous.glyphScale, true, false, language, "continuity")
          : null);
        if (!canBreak) continue;
        if (natural > available + 0.75 && !fit && !continuityFit && (end > start || last)) {
          if (canBreak && rejectedBreaks.length < 160) rejectedBreaks.push({
            reason: "overfull-break", start, end, line, hyphenBreak, natural, available, adjustment, gaps, characters,
            startText: (words[start].node.textContent ?? "").replace(/\u00ad/g, ""),
            endText: (words[end].node.textContent ?? "").replace(/\u00ad/g, ""),
            nextText: (words[end + 1]?.node.textContent ?? "").replace(/\u00ad/g, ""),
            previousGlyphScale: previous.glyphScale, previousHyphenStreak, previousHyphenCount,
          });
          break;
        }
        const dropcapRescue = false;
        const emergencyRescue = allowNaturalRescue && !last && !fit && !continuityFit && natural <= available + 0.75;
        const rescueNatural = emergencyRescue;
        const fitOptions: Array<LineFit | null> = [];
        if (fit) fitOptions.push(fit);
        if (continuityFit && !fitOptions.some((candidate) =>
          candidate
          && Math.abs(candidate.glyphScale - continuityFit.glyphScale) < 0.000001
          && Math.abs(candidate.wordSpacing - continuityFit.wordSpacing) < 0.000001
          && Math.abs(candidate.tracking - continuityFit.tracking) < 0.000001
        )) fitOptions.push(continuityFit);
        if (!fitOptions.length && (last || rescueNatural)) fitOptions.push(null);
        const hasStrictFit = Boolean(strictFit || strictContinuityFit);
        if (!last && !fitOptions.length && !rescueNatural) {
          if (canBreak && rejectedBreaks.length < 160) rejectedBreaks.push({
            reason: "no-fit", start, end, line, hyphenBreak, natural, available, adjustment, gaps, characters,
            startText: (words[start].node.textContent ?? "").replace(/\u00ad/g, ""),
            endText: (words[end].node.textContent ?? "").replace(/\u00ad/g, ""),
            nextText: (words[end + 1]?.node.textContent ?? "").replace(/\u00ad/g, ""),
            previousGlyphScale: previous.glyphScale, previousHyphenStreak, previousHyphenCount,
          });
          continue;
        }

        for (const lineFit of fitOptions) {
          const relaxedFit = !last && emergency && !hasStrictFit && Boolean(lineFit);
          const fill = Math.min(1, natural / Math.max(1, available));
        const shortLastPenalty = last
          ? semanticWordsOnLine === 1
            ? 1800 + (previous.hyphenated ? 1200 : 0) + 600 * Math.pow(1 - fill, 2)
            : fill < 0.28 ? 220 * Math.pow((0.28 - fill) / 0.28, 2) : 0
          : 0;
        const cumulativeHyphenPenalty = previousHyphenCount < 2
          ? previousHyphenCount * 180
          : 1400 * Math.pow(previousHyphenCount - 1, 2);
        const shortHyphenFragmentPenalty = hyphenBreak
          ? words[end].characters <= 2 ? 850 : words[end].characters === 3 ? 420 : 0
          : 0;
        const projectedLineCount = line + 1;
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
        const lineEndLexeme = (words[end].node.textContent ?? "")
          .replace(/\u00ad/g, "")
          .replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "")
          .toLowerCase();
        const strandedEnglishArticlePenalty = !last
          && !hyphenBreak
          && language.toLowerCase().startsWith("en")
          && /^(?:a|an|the)$/.test(lineEndLexeme)
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
        const completedJustifiedLines = last ? Math.max(1, sectionStats.justifiedLines + line) : 0;
        const completedHyphenCount = last ? sectionStats.hyphenatedLines + previousHyphenCount : 0;
        const completedHyphenRate = last ? completedHyphenCount / completedJustifiedLines : 0;
        // The release gate is section-level. A hard per-paragraph 0.45 cut made
        // short paragraphs mathematically impossible to compose: 2 hyphens over
        // 4 justified lines is 0.50 even when the whole section is well below 0.45.
        // Keep a very strong density cost, but preserve the fully-justified path.
        const finalHyphenDensityPenalty = last && completedJustifiedLines >= 4 && completedHyphenRate > 0.45
          ? 80000 * Math.pow((completedHyphenRate - 0.45) / 0.15, 2)
          : 0;
        const currentFitness = lineFit?.fitness ?? previousFitness;
        const fitnessDelta = Math.abs(currentFitness - previousFitness);
        const fitnessPenalty = line === 0 || !lineFit
          ? 0
          : fitnessDelta > 1 ? 240 * fitnessDelta : fitnessDelta === 1 ? 14 : currentFitness === 3 ? 80 : 0;
        const currentGaps = gapPositions(words, start, end + 1, offset, spaceWidth, lineFit);
        const rivers = riverCost(currentGaps, previous, spaceWidth);
        const cost = previous.cost
          + (lineFit?.badness ?? 0)
          + rescuePenalty
          + relaxedPenalty
          + finalCompressionPenalty
          + structuralPenalty
          + finalHyphenDensityPenalty
          + hyphenPenalty
          + punctuationPenalty
          + strandedEnglishArticlePenalty
          + shortLastPenalty
          + fitnessPenalty
          + rivers.cost;

        const nextLine = line + 1;
        const nextStreak = hyphenBreak ? Math.min(2, previousHyphenStreak + 1) : 0;
        const nextHyphenCount = previousHyphenCount + (hyphenBreak ? 1 : 0);
        const nextKey = encodeState(nextLine, nextStreak, currentFitness, lineFit?.glyphScale ?? 1, nextHyphenCount);
        const old = states[end + 1].get(nextKey);
        if (!old || cost < old.cost) {
          states[end + 1].set(nextKey, {
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
            hyphenCount: nextHyphenCount,
            gapPositions: currentGaps,
            riverPositions: rivers.rivers,
          });
        }
        }
      }
    }
  }

  let bestKey = -1;
  let bestCost = Number.POSITIVE_INFINITY;
  let bestSectionRate = Number.POSITIVE_INFINITY;
  let bestHyphenBudgetPriority = 3;
  for (const [key, state] of states[count]) {
    const decoded = decodeState(key);
    const paragraphJustifiedLines = Math.max(0, decoded.line - 1);
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
  if (bestKey < 0) {
    let furthest = 0;
    for (let index = 0; index < states.length; index++) if (states[index].size) furthest = index;
    lastBreakFailure = {
      tokenCount: count,
      furthest,
      boundary: words.slice(Math.max(0, furthest - 5), Math.min(count, furthest + 8)).map((word, relativeIndex) => ({
        index: Math.max(0, furthest - 5) + relativeIndex,
        text: (word.node.textContent ?? "").replace(/\u00ad/g, ""),
        spaceBefore: word.spaceBefore,
        hyphenBefore: word.hyphenBefore,
        canBreakBefore: word.canBreakBefore,
        width: word.width,
      })),
      reachableStateCount: states[furthest].size,
      reachableStates: [...states[furthest]].slice(0, 24).map(([key, state]) => ({
        key, decoded: decodeState(key), cost: state.cost, from: state.from, glyphScale: state.glyphScale,
        hyphenated: state.hyphenated, hyphenCount: state.hyphenCount, emergency: state.emergency, relaxed: state.relaxed,
      })),
      rejectedBreaks: rejectedBreaks.slice(-60),
    };
    return null;
  }

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
}

function cloneLineFragment(document: Document, words: Word[], start: number, end: number): DocumentFragment {
  const range = document.createRange();
  range.setStartBefore(words[start].node);
  range.setEndAfter(words[end - 1].node);
  return range.cloneContents();
}

function measureGeometry(paragraph: HTMLElement, style: CSSStyleDeclaration): Geometry {
  const paragraphRect = paragraph.getBoundingClientRect();
  const borderLeft = pixels(style.borderLeftWidth);
  const borderRight = pixels(style.borderRightWidth);
  const borderTop = pixels(style.borderTopWidth);
  const paddingLeft = pixels(style.paddingLeft);
  const paddingRight = pixels(style.paddingRight);
  const paddingTop = pixels(style.paddingTop);
  const contentLeft = paragraphRect.left + borderLeft + paddingLeft;
  const contentTop = paragraphRect.top + borderTop + paddingTop;
  const width = Math.max(1, paragraphRect.width - borderLeft - borderRight - paddingLeft - paddingRight);
  const indent = Math.max(0, pixels(style.textIndent));
  const lineHeight = pixels(style.lineHeight) || pixels(style.fontSize) * 1.5;
  const cap = paragraph.querySelector<HTMLElement>(":scope > .dropcap");
  if (!cap) {
    return { width, indent, cap: null, capLines: 0, capIntrusion: 0, capLeft: 0, capTop: 0, capDepth: 0 };
  }

  const capRect = cap.getBoundingClientRect();
  const capStyle = getComputedStyle(cap);
  const marginRight = pixels(capStyle.marginRight);
  const marginBottom = pixels(capStyle.marginBottom);
  const capIntrusion = Math.max(0, capRect.right + marginRight - contentLeft);
  const capDepth = Math.max(0, capRect.bottom + marginBottom - contentTop);
  const capLines = 2;

  return {
    width,
    indent: 0,
    cap,
    capLines,
    capIntrusion: Math.min(width * 0.46, capIntrusion),
    capLeft: capRect.left - (paragraphRect.left + borderLeft),
    capTop: capRect.top - (paragraphRect.top + borderTop),
    capDepth,
  };
}

function composeParagraph(paragraph: HTMLElement, language: string, sectionStats: SectionHyphenStats): void {
  if (
    paragraph.closest(".chapter-subtitle,.note,.telegram,.sign,.inscription,.verse,.poem,.msg") ||
    paragraph.querySelector("br,img,svg,code,pre,.math,[data-math]")
  ) return;
  if (paragraph.dataset.folioOriginalHtml !== undefined) restore(paragraph);

  const style = getComputedStyle(paragraph);
  const fontSize = pixels(style.fontSize) || 16;
  if (paragraph.getBoundingClientRect().width < fontSize * 8) return;
  const estimatedWords = paragraph.textContent?.trim().split(/\s+/).length ?? 0;
  if (estimatedWords > 1400) {
    paragraph.classList.add("folio-compositor-safe-fallback");
    return;
  }

  paragraph.dataset.folioOriginalHtml = paragraph.innerHTML;
  paragraph.dataset.folioOriginalStyle = paragraph.getAttribute("style") ?? "__none__";
  const paragraphLanguage = compositionLanguage(paragraph, language);
  paragraph.dataset.folioCompositionLanguage = paragraphLanguage;
  hyphenateElement(paragraph, paragraphLanguage);
  const geometry = measureGeometry(paragraph, style);

  const probe = paragraph.ownerDocument.createElement("span");
  probe.textContent = " -";
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${style.font};letter-spacing:${style.letterSpacing};word-spacing:${style.wordSpacing}`;
  paragraph.ownerDocument.body.appendChild(probe);
  const pairWidth = probe.getBoundingClientRect().width;
  probe.textContent = " ";
  const spaceWidth = probe.getBoundingClientRect().width || fontSize * 0.25;
  const hyphenWidth = Math.max(fontSize * 0.18, pairWidth - spaceWidth);
  probe.remove();

  const words = tokenize(paragraph, paragraphLanguage);
  if (!words.length) {
    restore(paragraph);
    return;
  }

  let breaks = chooseBreaks(words, geometry, spaceWidth, hyphenWidth, fontSize, true, false, paragraphLanguage, sectionStats);
  const strictFailure = breaks ? null : lastBreakFailure;
  if (!breaks) breaks = chooseBreaks(words, geometry, spaceWidth, hyphenWidth, fontSize, true, true, paragraphLanguage, sectionStats);
  if (strictFailure) paragraph.dataset.folioStrictFailure = JSON.stringify(strictFailure);
  if (!breaks) {
    restore(paragraph);
    paragraph.classList.add("folio-compositor-safe-fallback");
    return;
  }

  const baseWordSpacing = pixels(style.wordSpacing);
  const baseTracking = pixels(style.letterSpacing);
  const lines: HTMLElement[] = [];
  let start = 0;
  for (const [lineIndex, lineBreak] of breaks.entries()) {
    const line = paragraph.ownerDocument.createElement("span");
    line.className = `folio-composed-line ${lineBreak.justified ? "folio-line-justified" : "folio-line-natural"}${lineBreak.relaxed ? " folio-line-relaxed" : ""}${lineBreak.emergency ? " folio-line-emergency" : ""}${lineBreak.finalCompressed ? " folio-line-final-compressed" : ""}`;
    if (lineBreak.relaxed) line.dataset.folioRelaxed = "true";
    if (lineBreak.emergency) line.dataset.folioEmergency = "true";
    const content = paragraph.ownerDocument.createElement("span");
    content.className = "folio-line-content";
    content.style.display = "inline-block";
    content.style.transformOrigin = "left center";
    content.append(cloneLineFragment(paragraph.ownerDocument, words, start, lineBreak.end));
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
    if (lineIndex === 0 || lineIndex === breaks.length - 2) line.style.breakAfter = "avoid";
    lines.push(line);
    start = lineBreak.end;
  }

  paragraph.classList.add("folio-composed");
  const cap = geometry.cap;
  if (cap) {
    paragraph.classList.add("folio-composed-dropcap");
    paragraph.style.minHeight = `${Math.max(pixels(style.minHeight), geometry.capDepth)}px`;
    cap.classList.add("folio-composed-cap");
    cap.style.left = `${geometry.capLeft}px`;
    cap.style.top = `${geometry.capTop}px`;
  }

  paragraph.replaceChildren(...(cap ? [cap] : []));
  lines.forEach((line, index) => {
    paragraph.append(line);
    if (index < lines.length - 1 && !breaks[index].hyphenated) paragraph.append(" ");
  });

  sectionStats.justifiedLines += breaks.filter((lineBreak) => lineBreak.justified).length;
  sectionStats.hyphenatedLines += breaks.filter((lineBreak) => lineBreak.justified && lineBreak.hyphenated).length;

  const maxAdjacentScaleDelta = 0.012;
  let previousCorrectedScale: number | null = null;
  for (const line of lines) {
    if (!line.classList.contains("folio-line-justified") && !line.classList.contains("folio-line-final-compressed")) {
      previousCorrectedScale = null;
      continue;
    }
    const content = line.querySelector<HTMLElement>(":scope > .folio-line-content");
    if (!content) {
      previousCorrectedScale = null;
      continue;
    }
    const rendered = content.getBoundingClientRect().width;
    const measure = line.getBoundingClientRect().width;
    const protrusion = Number(line.dataset.folioRightProtrusion ?? 0);
    const opticalMeasure = measure + protrusion;
    const currentScale = Number(line.dataset.folioGlyphScale ?? 1);
    if (rendered <= 0 || opticalMeasure <= 0 || !Number.isFinite(currentScale)) {
      previousCorrectedScale = null;
      continue;
    }
    let correctedScale = Math.max(0.99, Math.min(1.01, currentScale * opticalMeasure / rendered));
    if (previousCorrectedScale !== null) {
      correctedScale = Math.max(
        previousCorrectedScale - maxAdjacentScaleDelta,
        Math.min(previousCorrectedScale + maxAdjacentScaleDelta, correctedScale),
      );
      correctedScale = Math.max(0.99, Math.min(1.01, correctedScale));
    }
    content.style.transform = Math.abs(correctedScale - 1) > 0.00001
      ? "scaleX(" + correctedScale + ")"
      : "";
    line.dataset.folioGlyphScale = String(correctedScale);
    previousCorrectedScale = correctedScale;
  }
}

function sectionStatsFor(
  paragraph: HTMLElement,
  statsBySection: WeakMap<HTMLElement, SectionHyphenStats>,
): SectionHyphenStats {
  const section = paragraph.closest<HTMLElement>("section.chapter,section.backmatter") ?? paragraph.parentElement;
  if (!section) return { justifiedLines: 0, hyphenatedLines: 0 };
  let stats = statsBySection.get(section);
  if (!stats) {
    stats = { justifiedLines: 0, hyphenatedLines: 0 };
    statsBySection.set(section, stats);
  }
  return stats;
}

function installObserver(
  document: Document,
  paragraphs: HTMLElement[],
  queue: HTMLElement[],
  queued: WeakSet<HTMLElement>,
  generation: number,
  language: string,
  statsBySection: WeakMap<HTMLElement, SectionHyphenStats>,
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
      composeParagraph(paragraph, language, sectionStatsFor(paragraph, statsBySection));
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

  ensureCompositionStyle(document);
  const language = document.documentElement.lang || "en";
  const paragraphs = Array.from(document.querySelectorAll<HTMLElement>(PROSE_SELECTOR));
  const view = document.defaultView;
  if (!view || !paragraphs.length) return;

  // A geometry generation must never expose line boxes calculated for the
  // previous device width. Only paragraphs that have actually been composed
  // carry original HTML, so restoring this small visible subset is cheap even
  // in a 5,200-paragraph manuscript. The new observer then recomposes the
  // paragraphs that are visible at the current measure.
  for (const paragraph of paragraphs) {
    if (paragraph.dataset.folioOriginalHtml !== undefined) restore(paragraph);
  }

  const queue: HTMLElement[] = [];
  const queued = new WeakSet<HTMLElement>();
  const statsBySection = new WeakMap<HTMLElement, SectionHyphenStats>();
  for (const paragraph of paragraphs.slice(0, 4)) {
    queued.add(paragraph);
    queue.push(paragraph);
  }

  const first = queue.shift();
  if (first && compositionGeneration.get(document) === generation) composeParagraph(first, language, sectionStatsFor(first, statsBySection));
  installObserver(document, paragraphs, queue, queued, generation, language, statsBySection);

  if (document.fonts?.status === "loading") {
    void document.fonts.ready.then(() => {
      if (compositionGeneration.get(document) === generation) void composePreviewDocument(document, true);
    }).catch(() => undefined);
  }
}

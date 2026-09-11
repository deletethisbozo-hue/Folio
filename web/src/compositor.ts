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

type LineFit = {
  wordSpacing: number;
  tracking: number;
  badness: number;
  fitness: number;
};

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

function fitLine(
  adjustment: number,
  gaps: number,
  trackingOps: number,
  spaceWidth: number,
  fontSize: number,
  emergency = false,
): LineFit | null {
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
}

const FITNESS_COUNT = 4;
const HYPHEN_STREAK_COUNT = 3;

function encodeState(line: number, hyphenStreak: number, fitness: number): number {
  return (line * HYPHEN_STREAK_COUNT + hyphenStreak) * FITNESS_COUNT + fitness;
}

function decodeState(key: number): { line: number; hyphenStreak: number; fitness: number } {
  return {
    line: Math.floor(key / (HYPHEN_STREAK_COUNT * FITNESS_COUNT)),
    hyphenStreak: Math.floor(key / FITNESS_COUNT) % HYPHEN_STREAK_COUNT,
    fitness: key % FITNESS_COUNT,
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
): Break[] | null {
  const count = words.length;
  const states: Array<Map<number, State>> = Array.from({ length: count + 1 }, () => new Map());
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
    available: geometry.width,
    emergency,
    fitness: initialFitness,
    gapPositions: [],
    riverPositions: [],
  });

  for (let start = 0; start < count; start++) {
    for (const [stateKey, previous] of states[start]) {
      const decoded = decodeState(stateKey);
      const line = decoded.line;
      const previousHyphenStreak = decoded.hyphenStreak;
      const previousFitness = decoded.fitness;
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
        const natural = wordWidth + gaps * spaceWidth + (hyphenBreak ? hyphenWidth : 0);

        if (natural > available + 0.75 && end > start) break;
        if (!canBreak) continue;

        const adjustment = available - natural;
        const trackingOps = Math.max(0, characters + gaps - 1);
        const strictFit = !last && natural <= available + 0.75
          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, false)
          : null;
        const fit = strictFit ?? (emergency && !last && natural <= available + 0.75
          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, true)
          : null);
        // A short line beside a drop cap can be mathematically impossible to
        // fill without an obvious river of white. Natural setting is the
        // professional fallback only while the cap occupies the measure.
        const dropcapRescue = !last && Boolean(geometry.cap) && line < geometry.capLines
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
        const hyphenPenalty = hyphenBreak
          ? 165 + previousHyphenStreak * 560
          : 0;
        const punctuationPenalty = hyphenBreak && /[,:;.!?…»”’)]$/.test(words[end].node.textContent ?? "") ? 80 : 0;
        const rescuePenalty = dropcapRescue
          ? 115 + 260 * Math.pow(1 - fill, 2)
          : rescueNatural ? 1100 + 900 * Math.pow(1 - fill, 2) : 0;
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
          + hyphenPenalty
          + punctuationPenalty
          + shortLastPenalty
          + fitnessPenalty
          + rivers.cost;

        const nextLine = line + 1;
        const nextStreak = hyphenBreak ? Math.min(2, previousHyphenStreak + 1) : 0;
        const nextKey = encodeState(nextLine, nextStreak, currentFitness);
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
  }

  let bestKey = -1;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const [key, state] of states[count]) {
    if (state.cost < bestCost) {
      bestCost = state.cost;
      bestKey = key;
    }
  }
  if (bestKey < 0) return null;

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
      offset: state.offset,
      available: state.available,
      emergency: state.emergency,
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
  const capLines = Math.max(1, Math.ceil((capDepth - 0.01) / Math.max(1, lineHeight)));

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

function composeParagraph(paragraph: HTMLElement, language: string): void {
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
  hyphenateElement(paragraph, language);
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

  const words = tokenize(paragraph);
  if (!words.length) {
    restore(paragraph);
    return;
  }

  let breaks = chooseBreaks(words, geometry, spaceWidth, hyphenWidth, fontSize, false);
  if (!breaks) breaks = chooseBreaks(words, geometry, spaceWidth, hyphenWidth, fontSize, true);
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
    line.className = `folio-composed-line ${lineBreak.justified ? "folio-line-justified" : "folio-line-natural"}${lineBreak.emergency ? " folio-line-emergency" : ""}`;
    if (lineBreak.emergency) line.dataset.folioEmergency = "true";
    line.append(cloneLineFragment(paragraph.ownerDocument, words, start, lineBreak.end));
    if (lineBreak.end < words.length && words[lineBreak.end].hyphenBefore) line.append("-");
    line.style.marginLeft = `${lineBreak.offset}px`;
    line.style.width = `${lineBreak.available}px`;
    if (lineBreak.justified) {
      line.style.wordSpacing = `${baseWordSpacing + lineBreak.wordSpacing}px`;
      line.style.letterSpacing = `${baseTracking + lineBreak.tracking}px`;
      line.dataset.folioWordSpacing = String(lineBreak.wordSpacing);
      line.dataset.folioTracking = String(lineBreak.tracking);
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

  ensureCompositionStyle(document);
  const language = document.documentElement.lang || "en";
  const paragraphs = Array.from(document.querySelectorAll<HTMLElement>(PROSE_SELECTOR));
  const view = document.defaultView;
  if (!view || !paragraphs.length) return;

  const queue: HTMLElement[] = [];
  const queued = new WeakSet<HTMLElement>();
  for (const paragraph of paragraphs.slice(0, 4)) {
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

const pendingFontLoads = new WeakMap<HTMLElement, string>();

/**
 * Optically seat drop caps against the real resolved glyph metrics while
 * preserving the size selected by the theme/user. Print uses the same rule in
 * server/pipeline/dropcap.ts; preview must not silently replace 3em/4.5em with
 * a separately calculated font size.
 */
export async function seatPreviewDropCaps(frame: HTMLIFrameElement): Promise<void> {
  const doc = frame.contentDocument;
  if (!doc?.body || !doc.defaultView) return;
  try { await doc.fonts.ready; } catch { return; }
  if (!frame.isConnected || frame.contentDocument !== doc) return;
  for (const cap of Array.from(doc.querySelectorAll<HTMLElement>("section.chapter .dropcap"))) {
    seatPreviewDropCap(cap);
  }
}

/** Shared native drop-cap calibration for iframe loads and the lazy compositor. */
export function seatPreviewDropCap(cap: HTMLElement): void {
  const doc = cap.ownerDocument;
  const view = doc.defaultView;
  if (!cap.isConnected || !doc.body || !view || view.getComputedStyle(cap).float === "none") return;

  const para = cap.closest<HTMLElement>("p");
  if (!para) return;

  // The compositor can reach this function before a theme face finishes
  // loading. Seating against fallback metrics leaves a stale wrapped-line
  // count once the real font swaps in, so defer authoritative calibration
  // until the document font set is settled.
  if (doc.fonts.status !== "loaded") {
    void doc.fonts.ready.then(() => {
      if (cap.isConnected && cap.ownerDocument === doc) seatPreviewDropCap(cap);
    }).catch(() => undefined);
    return;
  }

  const initialStyle = view.getComputedStyle(cap);
  const initialGlyph = cap.textContent?.trim() || "H";
  const fontProbe = `${initialStyle.fontStyle} ${initialStyle.fontWeight} ${initialStyle.fontSize} ${initialStyle.fontFamily}`;
  if (!doc.fonts.check(fontProbe, initialGlyph)) {
    if (pendingFontLoads.get(cap) === fontProbe) return;
    pendingFontLoads.set(cap, fontProbe);
    void doc.fonts.load(fontProbe, initialGlyph).then(() => {
      pendingFontLoads.delete(cap);
      if (cap.isConnected && cap.ownerDocument === doc) seatPreviewDropCap(cap);
    }).catch(() => {
      pendingFontLoads.delete(cap);
    });
    return;
  }
  pendingFontLoads.delete(cap);

  const canvas = doc.createElement("canvas").getContext("2d");
  if (!canvas) return;

  para.classList.add("folio-native-dropcap");
  para.classList.remove("folio-composed-dropcap");
  para.style.setProperty("text-indent", "0px", "important");

  const walker = doc.createTreeWalker(para, NodeFilter.SHOW_TEXT);
  let bodyNode: Text | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!cap.contains(node) && node.data.trim()) {
      bodyNode = node;
      break;
    }
  }
  if (!bodyNode) return;

  // Clear only preview calibration left by an earlier pass. In particular,
  // font-size must be cleared so the authoritative CSS variable selected by
  // Theme default / Small / Large is what gets measured and rendered.
  for (const property of ["font-size", "line-height", "padding-right", "margin-top", "margin-right", "margin-bottom"]) {
    cap.style.removeProperty(property);
  }
  delete cap.dataset.folioDropcapLines;
  delete cap.dataset.folioDropcapWrappedLines;
  delete cap.dataset.folioDropcapSeated;
  void para.offsetHeight;

  const bodyRange = doc.createRange();
  bodyRange.setStart(bodyNode, 0);
  bodyRange.setEnd(bodyNode, Math.min(20, bodyNode.data.length));
  const firstBodyRect = bodyRange.getClientRects()[0];
  if (!firstBodyRect) return;

  const bodyStyle = view.getComputedStyle(para);
  const bodySize = Number.parseFloat(bodyStyle.fontSize) || 16;
  canvas.font = `${bodyStyle.fontStyle} ${bodyStyle.fontWeight} ${bodyStyle.fontSize} ${bodyStyle.fontFamily}`;
  const bodyMetrics = canvas.measureText("Hh");
  const bodyAsc = bodyMetrics.fontBoundingBoxAscent || bodyMetrics.actualBoundingBoxAscent || bodySize * .8;
  const bodyDesc = bodyMetrics.fontBoundingBoxDescent || bodyMetrics.actualBoundingBoxDescent || bodySize * .2;
  const bodyLineHeight = bodyStyle.lineHeight === "normal"
    ? bodyAsc + bodyDesc
    : Number.parseFloat(bodyStyle.lineHeight) || bodyAsc + bodyDesc;
  const bodyBaseline =
    firstBodyRect.top +
    (bodyLineHeight - (bodyAsc + bodyDesc)) / 2 +
    bodyAsc;
  const bodyInkTop = bodyBaseline - (bodyMetrics.actualBoundingBoxAscent || bodyAsc);

  let capStyle = view.getComputedStyle(cap);
  const capFontSize = Number.parseFloat(capStyle.fontSize) || bodySize * 3;
  const glyph = cap.textContent?.trim() || "H";
  canvas.font = `${capStyle.fontStyle} ${capStyle.fontWeight} ${capStyle.fontSize} ${capStyle.fontFamily}`;
  const capMetrics = canvas.measureText(glyph);
  const capAsc = capMetrics.fontBoundingBoxAscent || capMetrics.actualBoundingBoxAscent || capFontSize * .8;
  const capDesc = capMetrics.fontBoundingBoxDescent || capMetrics.actualBoundingBoxDescent || capFontSize * .2;
  const capLineHeight = capStyle.lineHeight === "normal"
    ? capAsc + capDesc
    : Number.parseFloat(capStyle.lineHeight) || capAsc + capDesc;

  const capRect0 = cap.getBoundingClientRect();
  const capBaseline0 =
    capRect0.top +
    Number.parseFloat(capStyle.paddingTop || "0") +
    (capLineHeight - (capAsc + capDesc)) / 2 +
    capAsc;
  const capInkTop0 = capBaseline0 - (capMetrics.actualBoundingBoxAscent || capAsc);
  const topDelta = capInkTop0 - bodyInkTop;
  if (Math.abs(topDelta) > .25) {
    const initialTop = Number.parseFloat(capStyle.marginTop || "0") || 0;
    cap.style.setProperty("margin-top", `${initialTop - topDelta}px`, "important");
    void para.offsetHeight;
  }

  // Keep prose outside the native float box itself. Measuring only the
  // painted glyph edge can pull text into the cap's line box on faces with
  // side bearings, which creates real Range/rect collisions even when the
  // visible outlines appear separated.
  capStyle = view.getComputedStyle(cap);
  const desiredGap = Math.max(1.5, bodySize * .13);
  let rightMargin = Number.parseFloat(capStyle.marginRight || "0") || 0;
  for (let pass = 0; pass < 4; pass++) {
    const textRect = bodyRange.getClientRects()[0];
    if (!textRect) break;
    const capRect = cap.getBoundingClientRect();
    const gap = textRect.left - capRect.right;
    if (!Number.isFinite(gap) || Math.abs(gap - desiredGap) < .25) break;
    const delta = Math.max(-capFontSize * .20, Math.min(capFontSize * .20, desiredGap - gap));
    rightMargin = Math.max(-capFontSize * .25, Math.min(capFontSize * .25, rightMargin + delta));
    cap.style.setProperty("margin-right", `${rightMargin}px`, "important");
    void para.offsetHeight;
  }

  // Recompute visible cap ink after optical seating.
  capStyle = view.getComputedStyle(cap);
  const capRect = cap.getBoundingClientRect();
  canvas.font = `${capStyle.fontStyle} ${capStyle.fontWeight} ${capStyle.fontSize} ${capStyle.fontFamily}`;
  const seatedMetrics = canvas.measureText(glyph);
  const seatedAsc = seatedMetrics.fontBoundingBoxAscent || seatedMetrics.actualBoundingBoxAscent || capFontSize * .8;
  const seatedDesc = seatedMetrics.fontBoundingBoxDescent || seatedMetrics.actualBoundingBoxDescent || capFontSize * .2;
  const seatedLineHeight = capStyle.lineHeight === "normal"
    ? seatedAsc + seatedDesc
    : Number.parseFloat(capStyle.lineHeight) || seatedAsc + seatedDesc;
  const capBaseline =
    capRect.top +
    Number.parseFloat(capStyle.paddingTop || "0") +
    (seatedLineHeight - (seatedAsc + seatedDesc)) / 2 +
    seatedAsc;
  const capInkTop = capBaseline - (seatedMetrics.actualBoundingBoxAscent || seatedAsc);
  const capInkBottom = capBaseline + (seatedMetrics.actualBoundingBoxDescent || seatedDesc);

  const nativeRows = new Map<number, { top: number; bottom: number }>();
  const rowWalker = doc.createTreeWalker(para, NodeFilter.SHOW_TEXT);
  while (rowWalker.nextNode()) {
    const node = rowWalker.currentNode as Text;
    if (cap.contains(node) || !node.data.trim()) continue;
    const range = doc.createRange();
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width <= 1 || rect.height <= 1) continue;
      const key = Math.round(rect.top * 2) / 2;
      const previous = nativeRows.get(key);
      nativeRows.set(key, previous
        ? { top: Math.min(previous.top, rect.top), bottom: Math.max(previous.bottom, rect.bottom) }
        : { top: rect.top, bottom: rect.bottom });
    }
  }

  const sortedRows = [...nativeRows.values()].sort((a, b) => a.top - b.top);
  let intersectedInkLines = 0;
  for (let line = 0; line < Math.min(7, sortedRows.length); line++) {
    const row = sortedRows[line];
    const intersectsInk = capInkBottom > row.top + .5 && capInkTop < row.bottom - .5;
    if (intersectsInk) intersectedInkLines = line + 1;
    else if (row.top >= capInkBottom - .5) break;
  }

  // Native rows are already displaced by the float we are calibrating, so
  // using them alone can create a feedback loop: a stale third wrapped row
  // makes the cap "need" three rows and therefore preserves that same third
  // row forever. Also project the undisturbed paragraph line grid from the
  // first body row and resolved line-height, then take the conservative
  // intersection count. This measures painted cap ink against the baseline
  // prose rhythm rather than against geometry produced by the old seating.
  let projectedInkLines = 0;
  const firstRowHeight = firstBodyRect.height || Math.max(1, bodyLineHeight * .8);
  for (let line = 0; line < 7; line++) {
    const top = firstBodyRect.top + line * bodyLineHeight;
    const bottom = top + firstRowHeight;
    const intersectsInk = capInkBottom > top + .5 && capInkTop < bottom - .5;
    if (intersectsInk) projectedInkLines = line + 1;
    else if (top >= capInkBottom - .5) break;
  }
  const measuredInkLines = Math.min(
    intersectedInkLines || projectedInkLines || 2,
    projectedInkLines || intersectedInkLines || 2,
  );
  const seatLines = Math.max(2, Math.min(6, measuredInkLines));

  const paraRect = para.getBoundingClientRect();
  const contentLeft =
    paraRect.left +
    Number.parseFloat(bodyStyle.borderLeftWidth || "0") +
    Number.parseFloat(bodyStyle.paddingLeft || "0");

  const wrappedLineCount = () => {
    const lineLefts = new Map<number, number>();
    const textWalker = doc.createTreeWalker(para, NodeFilter.SHOW_TEXT);
    while (textWalker.nextNode()) {
      const node = textWalker.currentNode as Text;
      if (cap.contains(node) || !node.data.trim()) continue;
      const range = doc.createRange();
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width <= 1 || rect.height <= 1) continue;
        const top = Math.round(rect.top * 2) / 2;
        const previous = lineLefts.get(top);
        lineLefts.set(top, previous == null ? rect.left : Math.min(previous, rect.left));
      }
    }
    let wrapped = 0;
    for (const [, left] of [...lineLefts.entries()].sort((a, b) => a[0] - b[0])) {
      if (left > contentLeft + 1.25) wrapped++;
      else break;
    }
    return wrapped;
  };

  const bodyLineBoxTop =
    firstBodyRect.top - Math.max(0, (bodyLineHeight - firstBodyRect.height) / 2);
  const desiredFloatBottom = bodyLineBoxTop + seatLines * bodyLineHeight - 1.25;
  let marginBottom = desiredFloatBottom - capRect.bottom;
  cap.style.setProperty("margin-bottom", `${marginBottom}px`, "important");
  void para.offsetHeight;

  const step = Math.max(1, bodyLineHeight * .10);
  let wrappedLines = wrappedLineCount();
  for (let pass = 0; pass < 20 && wrappedLines !== seatLines; pass++) {
    marginBottom += wrappedLines > seatLines ? -step : step;
    cap.style.setProperty("margin-bottom", `${marginBottom}px`, "important");
    void para.offsetHeight;
    wrappedLines = wrappedLineCount();
  }

  // Validate against the FINAL native rows after the float has settled. This
  // second measurement is authoritative: the initial rows can still carry a
  // stale wrap depth from the previous Theme default / Small / Large state.
  // The final target must equal the number of prose rows that the painted glyph
  // actually intersects, which is also what the visual QA verifies.
  const finalInkLineCount = () => {
    const rows = new Map<number, { top: number; bottom: number }>();
    const walker = doc.createTreeWalker(para, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (cap.contains(node) || !node.data.trim()) continue;
      const range = doc.createRange();
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width <= 1 || rect.height <= 1) continue;
        const key = Math.round(rect.top * 2) / 2;
        const previous = rows.get(key);
        rows.set(key, previous
          ? { top: Math.min(previous.top, rect.top), bottom: Math.max(previous.bottom, rect.bottom) }
          : { top: rect.top, bottom: rect.bottom });
      }
    }
    let count = 0;
    for (const row of [...rows.values()].sort((a, b) => a.top - b.top)) {
      const intersects = row.bottom > capInkTop + .5 && row.top < capInkBottom - .5;
      if (intersects) count++;
      else if (row.top >= capInkBottom - .5) break;
    }
    return Math.max(2, Math.min(6, count || 2));
  };

  let finalSeatLines = finalInkLineCount();
  if (wrappedLines !== finalSeatLines) {
    for (let pass = 0; pass < 24 && wrappedLines !== finalSeatLines; pass++) {
      marginBottom += wrappedLines > finalSeatLines ? -step : step;
      cap.style.setProperty("margin-bottom", `${marginBottom}px`, "important");
      void para.offsetHeight;
      wrappedLines = wrappedLineCount();
      finalSeatLines = finalInkLineCount();
    }
  }

  cap.dataset.folioDropcapLines = String(finalSeatLines);
  cap.dataset.folioDropcapWrappedLines = String(wrappedLines);
  cap.dataset.folioDropcapSeated = wrappedLines === finalSeatLines ? "true" : "partial";
}

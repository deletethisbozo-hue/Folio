/**
 * Optically seat drop caps against real glyph metrics rather than assuming that
 * one CSS font-size and bottom margin work for every bundled typeface.
 * Only affects browser preview: print has its own pre-pagination seating, and
 * EPUB retains the conservative CSS float fallback.
 */
export async function seatPreviewDropCaps(frame: HTMLIFrameElement): Promise<void> {
  const doc = frame.contentDocument;
  if (!doc?.body || !doc.defaultView) return;
  try { await doc.fonts.ready; } catch { return; }
  if (!frame.isConnected || frame.contentDocument !== doc) return;

  const context = doc.createElement("canvas").getContext("2d");
  if (!context) return;

  for (const cap of Array.from(doc.querySelectorAll<HTMLElement>("section.chapter .dropcap"))) {
    if (!cap.isConnected) continue;
    const para = cap.closest<HTMLElement>("p");
    if (!para || doc.defaultView.getComputedStyle(cap).float === "none") continue;
    const walker = doc.createTreeWalker(para, NodeFilter.SHOW_TEXT);
    let bodyNode: Text | null = null;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (!cap.contains(node) && node.data.trim()) {bodyNode = node; break;}
    }
    if (!bodyNode) continue;
    // Restore CSS values before measuring, so previous calibration cannot
    // accumulate with font-size or line-height changes.
    for (const property of ["font-size", "line-height", "padding-right", "margin-top", "margin-right", "margin-bottom"]) {
      cap.style.removeProperty(property);
    }
    const paraStyle = doc.defaultView.getComputedStyle(para);
    const bodySize = Number.parseFloat(paraStyle.fontSize) || 16;
    const leading = Number.parseFloat(paraStyle.lineHeight) || bodySize * 1.5;
    const bodyRange = doc.createRange();
    bodyRange.setStart(bodyNode, 0);
    bodyRange.setEnd(bodyNode, Math.min(8, bodyNode.length));
    const firstRect = bodyRange.getClientRects()[0];
    if (!firstRect) continue;

    // Determine the actual body ink height from the selected book font.
    context.font = paraStyle.fontStyle + " " + paraStyle.fontWeight + " " + paraStyle.fontSize + " " + paraStyle.fontFamily;
    const bodyInk = context.measureText("Hg");
    const bodyAscent = bodyInk.fontBoundingBoxAscent || bodySize * .8;
    const bodyDescent = bodyInk.fontBoundingBoxDescent || bodySize * .2;
    const firstInkTop = firstRect.top + (leading - bodyAscent - bodyDescent) / 2 +
      bodyAscent - (bodyInk.actualBoundingBoxAscent || bodyAscent);

    const capStyle = doc.defaultView.getComputedStyle(cap);
    const family = capStyle.fontFamily;
    const weight = capStyle.fontWeight;
    const glyph = cap.textContent?.trim()?.slice(0, 2) || "A";
    const seatLines = capStyle.getPropertyValue("--folio-dropcap-lines").trim() === "3"
      || (Number.parseFloat(capStyle.getPropertyValue("--folio-dropcap-user-size")) || 0) >= 4
      ? 3 : 2;

    context.font = capStyle.fontStyle + " " + weight + " 100px " + family;
    const sample = context.measureText(glyph);
    const inkRatio = Math.max(.38, Math.min(1.35,
      ((sample.actualBoundingBoxAscent || 70) + (sample.actualBoundingBoxDescent || 5)) / 100));
    const bodyInkHeight = (bodyInk.actualBoundingBoxAscent || bodySize * .7) +
      (bodyInk.actualBoundingBoxDescent || bodySize * .1);
    const desiredHeight = bodyInkHeight + (seatLines - 1) * leading - leading * .06;
    const fontPx = Math.max(bodySize * 1.9, Math.min(bodySize * 6.4, desiredHeight / inkRatio));
    cap.style.setProperty("font-size", fontPx.toFixed(2) + "px", "important");
    cap.style.setProperty("line-height", ".9", "important");
    cap.style.setProperty("padding-right", (bodySize * .10).toFixed(2) + "px", "important");
    cap.style.setProperty("margin-top", "0px", "important");
    cap.style.setProperty("margin-right", "0px", "important");
    cap.style.setProperty("margin-bottom", "0px", "important");

    let current = doc.defaultView.getComputedStyle(cap);
    context.font = current.fontStyle + " " + weight + " " + current.fontSize + " " + family;
    const metrics = context.measureText(glyph);
    const capAscent = metrics.fontBoundingBoxAscent || fontPx * .8;
    const capDescent = metrics.fontBoundingBoxDescent || fontPx * .2;
    const linebox = Number.parseFloat(current.lineHeight) || fontPx * .9;
    const capRect = cap.getBoundingClientRect();
    const capInkTop = capRect.top + (linebox - capAscent - capDescent) / 2 +
      capAscent - (metrics.actualBoundingBoxAscent || capAscent);
    const opticalDelta = Math.max(-fontPx*.25, Math.min(fontPx*.25, firstInkTop - capInkTop));
    cap.style.setProperty("margin-top", opticalDelta.toFixed(2) + "px", "important");

    // Cancel excessive *font sidebearing*, not text spacing. Keep >= 1.5 px
    // between actual painted glyph and the next word even on antique faces.
    const sideBearing = Math.max(0, metrics.width - metrics.actualBoundingBoxRight);
    const desiredGap = Math.max(1.5, bodySize * .13);
    const padding = bodySize * .10;
    const rightMargin = Math.max(-fontPx*.20, Math.min(0, desiredGap - sideBearing - padding));
    cap.style.setProperty("margin-right", rightMargin.toFixed(2) + "px", "important");

    const seatedRect = cap.getBoundingClientRect();
    const desiredFloatEnd = firstRect.top + (seatLines - .15) * leading;
    let bottomMargin = desiredFloatEnd - seatedRect.bottom;
    cap.style.setProperty("margin-bottom", bottomMargin.toFixed(2) + "px", "important");

    // Trim phantom wrapped rows, or extend a too-short float, according to the
    // actual native text rects (not guessed glyph height).
    const wrappedRows = () => {
      const rows = new Map<number, number>();
      const textWalker = doc.createTreeWalker(para, NodeFilter.SHOW_TEXT);
      while (textWalker.nextNode()) {
        const node = textWalker.currentNode as Text;
        if (cap.contains(node) || !node.data.trim()) continue;
        const range = doc.createRange();
        range.selectNodeContents(node);
        for (const r of Array.from(range.getClientRects())) {
          if (r.width < 1 || r.height < 1) continue;
          const top = Math.round(r.top * 2) / 2;
          rows.set(top, Math.min(rows.get(top) ?? Infinity, r.left));
        }
      }
      const left = para.getBoundingClientRect().left + Number.parseFloat(paraStyle.paddingLeft || "0");
      let count = 0;
      for (const [, offset] of [...rows.entries()].sort((a,b)=>a[0]-b[0])) {
        if (offset > left + 1.25) count++; else break;
      }
      return count;
    };
    let actual = wrappedRows();
    for (let tries = 0; tries < 18 && actual !== seatLines; tries++) {
      bottomMargin += actual > seatLines ? -leading*.1 : leading*.1;
      cap.style.setProperty("margin-bottom", bottomMargin.toFixed(2) + "px", "important");
      actual = wrappedRows();
    }
    cap.dataset.folioDropcapLines = String(seatLines);
    cap.dataset.folioDropcapWrappedLines = String(actual);
    cap.dataset.folioDropcapSeated = actual === seatLines ? "true" : "partial";
  }
}

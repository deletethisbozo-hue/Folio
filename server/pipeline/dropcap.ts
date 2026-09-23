import type { Page } from "puppeteer";

/**
 * Seat every drop cap against the visible body-text ink and make the float
 * exclude exactly the body lines occupied by visible glyph ink.
 *
 * This runs before Print pagination. It deliberately measures the resolved font
 * in Chromium instead of assuming a fixed two/three-line cap: blackletter faces
 * and user size presets have wildly different ascent/descent geometry.
 */
export async function alignDropCaps(page: Page): Promise<number> {
  // tsx/esbuild annotates nested helpers with __name while serialising the
  // evaluate callback. Puppeteer's isolated page world does not inherit that
  // helper from Node, so provide the same harmless shim used by the compositor.
  await page.evaluate("globalThis.__name = globalThis.__name || function(target){ return target; }");
  return page.evaluate(() => {
    const caps = Array.from(document.querySelectorAll<HTMLElement>(".dropcap"));
    if (caps.length === 0) return 0;

    for (const cap of caps) {
      cap.style.removeProperty("margin-top");
      cap.style.removeProperty("margin-bottom");
      delete cap.dataset.folioDropcapLines;
      delete cap.dataset.folioDropcapWrappedLines;
      delete cap.dataset.folioDropcapSeated;
    }
    void document.body.offsetHeight;

    const canvas = document.createElement("canvas").getContext("2d");
    if (!canvas) return 0;
    let adjusted = 0;

    for (const cap of caps) {
      const para = cap.closest<HTMLElement>("p");
      if (!para) continue;

      const bodyWalker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
      let body: Text | null = null;
      while (bodyWalker.nextNode()) {
        const node = bodyWalker.currentNode as Text;
        if (cap.contains(node) || !node.data.trim()) continue;
        body = node;
        break;
      }
      if (!body) continue;

      const bodyRange = document.createRange();
      bodyRange.setStart(body, 0);
      bodyRange.setEnd(body, Math.min(20, body.data.length));
      const firstBodyRect = bodyRange.getClientRects()[0];
      if (!firstBodyRect) continue;

      const bodyStyle = getComputedStyle(para);
      canvas.font = `${bodyStyle.fontStyle} ${bodyStyle.fontWeight} ${bodyStyle.fontSize} ${bodyStyle.fontFamily}`;
      const bodyMetrics = canvas.measureText("Hh");
      const bodyAsc = bodyMetrics.fontBoundingBoxAscent || bodyMetrics.actualBoundingBoxAscent;
      const bodyDesc = bodyMetrics.fontBoundingBoxDescent || bodyMetrics.actualBoundingBoxDescent;
      const bodyLineHeight = bodyStyle.lineHeight === "normal"
        ? bodyAsc + bodyDesc
        : Number.parseFloat(bodyStyle.lineHeight) || bodyAsc + bodyDesc;
      const bodyBaseline =
        firstBodyRect.top +
        (bodyLineHeight - (bodyAsc + bodyDesc)) / 2 +
        bodyAsc;
      const bodyInkTop = bodyBaseline - bodyMetrics.actualBoundingBoxAscent;

      let capStyle = getComputedStyle(cap);
      canvas.font = `${capStyle.fontStyle} ${capStyle.fontWeight} ${capStyle.fontSize} ${capStyle.fontFamily}`;
      const capMetrics = canvas.measureText(cap.textContent || "H");
      const capAsc = capMetrics.fontBoundingBoxAscent || capMetrics.actualBoundingBoxAscent;
      const capDesc = capMetrics.fontBoundingBoxDescent || capMetrics.actualBoundingBoxDescent;
      const capLineHeight = capStyle.lineHeight === "normal"
        ? capAsc + capDesc
        : Number.parseFloat(capStyle.lineHeight) || capAsc + capDesc;

      const capRect0 = cap.getBoundingClientRect();
      const capBaseline0 =
        capRect0.top +
        Number.parseFloat(capStyle.paddingTop || "0") +
        (capLineHeight - (capAsc + capDesc)) / 2 +
        capAsc;
      const capInkTop0 = capBaseline0 - capMetrics.actualBoundingBoxAscent;
      const topDelta = capInkTop0 - bodyInkTop;
      let capAdjusted = false;

      if (Math.abs(topDelta) > 0.25) {
        cap.style.marginTop = `${Number.parseFloat(capStyle.marginTop || "0") - topDelta}px`;
        void para.offsetHeight;
        capAdjusted = true;
      }

      // Work from the visible glyph bottom after optical top seating.
      capStyle = getComputedStyle(cap);
      const capRect = cap.getBoundingClientRect();
      const capBaseline =
        capRect.top +
        Number.parseFloat(capStyle.paddingTop || "0") +
        (capLineHeight - (capAsc + capDesc)) / 2 +
        capAsc;
      const capInkBottom = capBaseline + capMetrics.actualBoundingBoxDescent;
      const bodyLineBoxTop =
        firstBodyRect.top - Math.max(0, (bodyLineHeight - firstBodyRect.height) / 2);
      const visibleDepth = Math.max(1, capInkBottom - bodyLineBoxTop);
      const seatLines = Math.max(
        2,
        Math.min(6, Math.ceil((visibleDepth + 0.75) / Math.max(1, bodyLineHeight))),
      );

      const paraRect = para.getBoundingClientRect();
      const contentLeft =
        paraRect.left +
        Number.parseFloat(bodyStyle.borderLeftWidth || "0") +
        Number.parseFloat(bodyStyle.paddingLeft || "0");

      const wrappedLineCount = () => {
        const lineLefts = new Map<number, number>();
        const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          if (cap.contains(node) || !node.data.trim()) continue;
          const range = document.createRange();
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

      // Put the float boundary just before the first line that should return to
      // the normal measure, then calibrate against Chromium's actual wrap.
      const desiredFloatBottom =
        bodyLineBoxTop + seatLines * bodyLineHeight - 1.25;
      let marginBottom = desiredFloatBottom - capRect.bottom;
      cap.style.marginBottom = `${marginBottom}px`;
      void para.offsetHeight;

      const step = Math.max(1, bodyLineHeight * 0.10);
      let wrappedLines = wrappedLineCount();
      for (let pass = 0; pass < 16 && wrappedLines !== seatLines; pass++) {
        marginBottom += wrappedLines > seatLines ? -step : step;
        cap.style.marginBottom = `${marginBottom}px`;
        void para.offsetHeight;
        wrappedLines = wrappedLineCount();
        capAdjusted = true;
      }

      cap.dataset.folioDropcapLines = String(seatLines);
      cap.dataset.folioDropcapWrappedLines = String(wrappedLines);
      cap.dataset.folioDropcapSeated = "true";
      if (capAdjusted) adjusted++;
    }

    return adjusted;
  });
}

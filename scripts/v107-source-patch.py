from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(path: str, old: str, new: str) -> None:
    target = ROOT / path
    value = target.read_text(encoding="utf-8")
    if new in value:
        print(f"{path}: already patched")
        return
    if old not in value:
        raise RuntimeError(f"expected patch marker missing in {path}")
    target.write_text(value.replace(old, new, 1), encoding="utf-8")


# --- Live preview compositor -------------------------------------------------
patch(
    "web/src/compositor.ts",
    """type LineFit = {
  wordSpacing: number;
  tracking: number;
  badness: number;
  fitness: number;
};
""",
    """type LineFit = {
  wordSpacing: number;
  tracking: number;
  glyphScale: number;
  badness: number;
  fitness: number;
};
""",
)
patch(
    "web/src/compositor.ts",
    """  wordSpacing: number;
  tracking: number;
  hyphenated: boolean;
""",
    """  wordSpacing: number;
  tracking: number;
  glyphScale: number;
  hyphenated: boolean;
""",
)

web_fit_old = """function fitLine(
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
    : Math.min(spaceWidth * 0.50, fontSize * 0.115);
  const minWordSpacing = -Math.min(spaceWidth * 0.18, fontSize * 0.045);
  const maxTracking = fontSize * (emergency ? 0.007 : 0.0055);
  const minTracking = -fontSize * 0.0045;

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
"""
web_fit_new = """function fitLine(
  adjustment: number,
  gaps: number,
  trackingOps: number,
  spaceWidth: number,
  fontSize: number,
  naturalWidth: number,
  emergency = false,
): LineFit | null {
  if (gaps <= 0) return null;

  const maxWordSpacing = emergency
    ? Math.min(spaceWidth * 0.48, fontSize * 0.14)
    : Math.min(spaceWidth * 0.50, fontSize * 0.115);
  const minWordSpacing = -Math.min(spaceWidth * 0.18, fontSize * 0.045);
  const maxTracking = fontSize * (emergency ? 0.007 : 0.0055);
  const minTracking = -fontSize * 0.0045;
  const maxGlyphScaleDelta = 0.02;
  const available = naturalWidth + adjustment;
  const direction = adjustment >= 0 ? 1 : -1;
  let best: LineFit | null = null;

  // pdfTeX/microtype-style font expansion: use at most ±2%, and only in the
  // direction that reduces the required interword/tracking correction.
  for (let step = 0; step <= 20; step++) {
    const glyphScale = 1 + direction * step * 0.001;
    if (Math.abs(glyphScale - 1) > maxGlyphScaleDelta + 0.000001) continue;
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
    const badness = 100 * Math.pow(Math.abs(spaceRatio) / 0.20, 3)
      + 55 * Math.pow(Math.abs(trackingRatio) / 0.0035, 3)
      + 42 * Math.pow(scaleRatio, 3);
    const fitness = spaceRatio < -0.04 ? 0 : spaceRatio <= 0.10 ? 1 : spaceRatio <= 0.22 ? 2 : 3;
    const candidate = { wordSpacing, tracking, glyphScale, badness, fitness };
    if (!best || candidate.badness < best.badness) best = candidate;
  }
  return best;
}
"""
patch("web/src/compositor.ts", web_fit_old, web_fit_new)

web_gap_old = """function gapPositions(
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
"""
web_gap_new = """function gapPositions(
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
"""
patch("web/src/compositor.ts", web_gap_old, web_gap_new)
patch(
    "web/src/compositor.ts",
    """    wordSpacing: 0,
    tracking: 0,
    hyphenated: false,
""",
    """    wordSpacing: 0,
    tracking: 0,
    glyphScale: 1,
    hyphenated: false,
""",
)
patch(
    "web/src/compositor.ts",
    """          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, false)
          : null;
        const fit = strictFit ?? (emergency && !last
          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, true)
""",
    """          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, false)
          : null;
        const fit = strictFit ?? (emergency && !last
          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, true)
""",
)
patch(
    "web/src/compositor.ts",
    """        const currentGaps = gapPositions(words, start, end + 1, offset, spaceWidth, lineFit);
        const rivers = riverCost(currentGaps, previous, spaceWidth);
        const cost = previous.cost
""",
    """        const glyphScaleDelta = lineFit ? Math.abs(lineFit.glyphScale - previous.glyphScale) : 0;
        const glyphContinuityPenalty = line === 0 || !lineFit ? 0 : 45 * Math.pow(glyphScaleDelta / 0.01, 2);
        const currentGaps = gapPositions(words, start, end + 1, offset, spaceWidth, lineFit);
        const rivers = riverCost(currentGaps, previous, spaceWidth);
        const cost = previous.cost
""",
)
patch(
    "web/src/compositor.ts",
    """          + fitnessPenalty
          + rivers.cost;
""",
    """          + fitnessPenalty
          + glyphContinuityPenalty
          + rivers.cost;
""",
)
patch(
    "web/src/compositor.ts",
    """            wordSpacing: lineFit?.wordSpacing ?? 0,
            tracking: lineFit?.tracking ?? 0,
            hyphenated: hyphenBreak,
""",
    """            wordSpacing: lineFit?.wordSpacing ?? 0,
            tracking: lineFit?.tracking ?? 0,
            glyphScale: lineFit?.glyphScale ?? 1,
            hyphenated: hyphenBreak,
""",
)
patch(
    "web/src/compositor.ts",
    """      wordSpacing: state.wordSpacing,
      tracking: state.tracking,
      hyphenated: state.hyphenated,
""",
    """      wordSpacing: state.wordSpacing,
      tracking: state.tracking,
      glyphScale: state.glyphScale,
      hyphenated: state.hyphenated,
""",
)
web_render_old = """    if (lineBreak.emergency) line.dataset.folioEmergency = \"true\";
    line.append(cloneLineFragment(paragraph.ownerDocument, words, start, lineBreak.end));
    if (lineBreak.end < words.length && words[lineBreak.end].hyphenBefore) line.append(\"-\");
    line.style.marginLeft = `${lineBreak.offset}px`;
    line.style.width = `${lineBreak.available}px`;
    if (lineBreak.justified) {
      line.style.wordSpacing = `${baseWordSpacing + lineBreak.wordSpacing}px`;
      line.style.letterSpacing = `${baseTracking + lineBreak.tracking}px`;
      line.dataset.folioWordSpacing = String(lineBreak.wordSpacing);
      line.dataset.folioTracking = String(lineBreak.tracking);
    }
"""
web_render_new = """    if (lineBreak.emergency) line.dataset.folioEmergency = \"true\";
    const content = paragraph.ownerDocument.createElement(\"span\");
    content.className = \"folio-line-content\";
    content.style.display = \"inline-block\";
    content.style.transformOrigin = \"left center\";
    content.append(cloneLineFragment(paragraph.ownerDocument, words, start, lineBreak.end));
    if (lineBreak.end < words.length && words[lineBreak.end].hyphenBefore) content.append(\"-\");
    line.append(content);
    line.style.marginLeft = `${lineBreak.offset}px`;
    line.style.width = `${lineBreak.available}px`;
    if (lineBreak.justified) {
      line.style.wordSpacing = `${baseWordSpacing + lineBreak.wordSpacing}px`;
      line.style.letterSpacing = `${baseTracking + lineBreak.tracking}px`;
      if (Math.abs(lineBreak.glyphScale - 1) > 0.00001) content.style.transform = `scaleX(${lineBreak.glyphScale})`;
      line.dataset.folioWordSpacing = String(lineBreak.wordSpacing);
      line.dataset.folioTracking = String(lineBreak.tracking);
      line.dataset.folioGlyphScale = String(lineBreak.glyphScale);
    }
"""
patch("web/src/compositor.ts", web_render_old, web_render_new)

# --- PDF/print compositor mirror ---------------------------------------------
patch(
    "server/pipeline/compositor.ts",
    """    type LineFit = { wordSpacing: number; tracking: number; badness: number; fitness: number };
""",
    """    type LineFit = { wordSpacing: number; tracking: number; glyphScale: number; badness: number; fitness: number };
""",
)
patch(
    "server/pipeline/compositor.ts",
    """      wordSpacing: number;
      tracking: number;
      hyphenated: boolean;
""",
    """      wordSpacing: number;
      tracking: number;
      glyphScale: number;
      hyphenated: boolean;
""",
)

server_fit_old = """    const fitLine = (
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
        : Math.min(spaceWidth * 0.50, fontSize * 0.115);
      const minWordSpacing = -Math.min(spaceWidth * 0.18, fontSize * 0.045);
      const maxTracking = fontSize * (emergency ? 0.007 : 0.0055);
      const minTracking = -fontSize * 0.0045;

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
"""
server_fit_new = """    const fitLine = (
      adjustment: number,
      gaps: number,
      trackingOps: number,
      spaceWidth: number,
      fontSize: number,
      naturalWidth: number,
      emergency = false,
    ): LineFit | null => {
      if (gaps <= 0) return null;
      const maxWordSpacing = emergency
        ? Math.min(spaceWidth * 0.48, fontSize * 0.14)
        : Math.min(spaceWidth * 0.50, fontSize * 0.115);
      const minWordSpacing = -Math.min(spaceWidth * 0.18, fontSize * 0.045);
      const maxTracking = fontSize * (emergency ? 0.007 : 0.0055);
      const minTracking = -fontSize * 0.0045;
      const maxGlyphScaleDelta = 0.02;
      const available = naturalWidth + adjustment;
      const direction = adjustment >= 0 ? 1 : -1;
      let best: LineFit | null = null;

      for (let step = 0; step <= 20; step++) {
        const glyphScale = 1 + direction * step * 0.001;
        if (Math.abs(glyphScale - 1) > maxGlyphScaleDelta + 0.000001) continue;
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
        const badness = 100 * Math.pow(Math.abs(spaceRatio) / 0.20, 3)
          + 55 * Math.pow(Math.abs(trackingRatio) / 0.0035, 3)
          + 42 * Math.pow(scaleRatio, 3);
        const fitness = spaceRatio < -0.04 ? 0 : spaceRatio <= 0.10 ? 1 : spaceRatio <= 0.22 ? 2 : 3;
        const candidate = { wordSpacing, tracking, glyphScale, badness, fitness };
        if (!best || candidate.badness < best.badness) best = candidate;
      }
      return best;
    };
"""
patch("server/pipeline/compositor.ts", server_fit_old, server_fit_new)

server_gap_old = """    const lineGapPositions = (
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
"""
server_gap_new = """    const lineGapPositions = (
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
"""
patch("server/pipeline/compositor.ts", server_gap_old, server_gap_new)
patch(
    "server/pipeline/compositor.ts",
    """        wordSpacing: 0,
        tracking: 0,
        hyphenated: false,
""",
    """        wordSpacing: 0,
        tracking: 0,
        glyphScale: 1,
        hyphenated: false,
""",
)
patch(
    "server/pipeline/compositor.ts",
    """              ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, false)
              : null;
            const fit = strictFit ?? (emergency && !last
              ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, true)
""",
    """              ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, false)
              : null;
            const fit = strictFit ?? (emergency && !last
              ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, true)
""",
)
patch(
    "server/pipeline/compositor.ts",
    """            const currentGaps = lineGapPositions(words, start, end + 1, offset, spaceWidth, lineFit);
            const rivers = riverCost(currentGaps, previous, spaceWidth);
            const cost = previous.cost + (lineFit?.badness ?? 0) + rescuePenalty + hyphenPenalty + punctuationPenalty + shortLastPenalty + fitnessPenalty + rivers.cost;
""",
    """            const glyphScaleDelta = lineFit ? Math.abs(lineFit.glyphScale - previous.glyphScale) : 0;
            const glyphContinuityPenalty = lineNo === 0 || !lineFit ? 0 : 45 * Math.pow(glyphScaleDelta / 0.01, 2);
            const currentGaps = lineGapPositions(words, start, end + 1, offset, spaceWidth, lineFit);
            const rivers = riverCost(currentGaps, previous, spaceWidth);
            const cost = previous.cost + (lineFit?.badness ?? 0) + rescuePenalty + hyphenPenalty + punctuationPenalty + shortLastPenalty + fitnessPenalty + glyphContinuityPenalty + rivers.cost;
""",
)
patch(
    "server/pipeline/compositor.ts",
    """              wordSpacing: lineFit?.wordSpacing ?? 0,
              tracking: lineFit?.tracking ?? 0,
              hyphenated: hyphenBreak,
""",
    """              wordSpacing: lineFit?.wordSpacing ?? 0,
              tracking: lineFit?.tracking ?? 0,
              glyphScale: lineFit?.glyphScale ?? 1,
              hyphenated: hyphenBreak,
""",
)
patch(
    "server/pipeline/compositor.ts",
    """          wordSpacing: state.wordSpacing,
          tracking: state.tracking,
          hyphenated: state.hyphenated,
""",
    """          wordSpacing: state.wordSpacing,
          tracking: state.tracking,
          glyphScale: state.glyphScale,
          hyphenated: state.hyphenated,
""",
)
server_render_old = """        if (lineBreak.emergency) line.dataset.folioEmergency = \"true\";
        line.append(fragments[lineNo]);
        if (lineBreak.end < words.length && words[lineBreak.end].hyphenBefore) line.append(\"-\");
        line.style.marginLeft = `${lineBreak.offset}px`;
        line.style.width = `${lineBreak.available}px`;
        if (lineBreak.justified) {
          line.style.wordSpacing = `${baseWordSpacing + lineBreak.wordSpacing}px`;
          line.style.letterSpacing = `${baseTracking + lineBreak.tracking}px`;
          line.dataset.folioWordSpacing = String(lineBreak.wordSpacing);
          line.dataset.folioTracking = String(lineBreak.tracking);
        }
"""
server_render_new = """        if (lineBreak.emergency) line.dataset.folioEmergency = \"true\";
        const content = document.createElement(\"span\");
        content.className = \"folio-line-content\";
        content.style.display = \"inline-block\";
        content.style.transformOrigin = \"left center\";
        content.append(fragments[lineNo]);
        if (lineBreak.end < words.length && words[lineBreak.end].hyphenBefore) content.append(\"-\");
        line.append(content);
        line.style.marginLeft = `${lineBreak.offset}px`;
        line.style.width = `${lineBreak.available}px`;
        if (lineBreak.justified) {
          line.style.wordSpacing = `${baseWordSpacing + lineBreak.wordSpacing}px`;
          line.style.letterSpacing = `${baseTracking + lineBreak.tracking}px`;
          if (Math.abs(lineBreak.glyphScale - 1) > 0.00001) content.style.transform = `scaleX(${lineBreak.glyphScale})`;
          line.dataset.folioWordSpacing = String(lineBreak.wordSpacing);
          line.dataset.folioTracking = String(lineBreak.tracking);
          line.dataset.folioGlyphScale = String(lineBreak.glyphScale);
        }
"""
patch("server/pipeline/compositor.ts", server_render_old, server_render_new)

# --- QA: bound the new microtype degree of freedom ---------------------------
patch(
    "scripts/v107-visual-qa.ts",
    """      let maxTrackingEm = 0;
      let maxSemanticGapEm = 0;
""",
    """      let maxTrackingEm = 0;
      let maxGlyphScaleDelta = 0;
      let maxAdjacentGlyphScaleDelta = 0;
      let maxSemanticGapEm = 0;
""",
)
patch(
    "scripts/v107-visual-qa.ts",
    """        let streak = 0;
        let previousSpacing: number | null = null;
""",
    """        let streak = 0;
        let previousSpacing: number | null = null;
        let previousGlyphScale: number | null = null;
""",
)
patch(
    "scripts/v107-visual-qa.ts",
    """            maxTrackingEm = Math.max(maxTrackingEm, Math.abs(Number(line.dataset.folioTracking ?? 0) / fontSize));
            if (previousSpacing !== null) maxAdjacentSpacingDeltaEm = Math.max(maxAdjacentSpacingDeltaEm, Math.abs(spacing - previousSpacing));
            previousSpacing = spacing;
""",
    """            maxTrackingEm = Math.max(maxTrackingEm, Math.abs(Number(line.dataset.folioTracking ?? 0) / fontSize));
            const glyphScale = Number(line.dataset.folioGlyphScale ?? 1);
            maxGlyphScaleDelta = Math.max(maxGlyphScaleDelta, Math.abs(glyphScale - 1));
            if (previousGlyphScale !== null) maxAdjacentGlyphScaleDelta = Math.max(maxAdjacentGlyphScaleDelta, Math.abs(glyphScale - previousGlyphScale));
            previousGlyphScale = glyphScale;
            if (previousSpacing !== null) maxAdjacentSpacingDeltaEm = Math.max(maxAdjacentSpacingDeltaEm, Math.abs(spacing - previousSpacing));
            previousSpacing = spacing;
""",
)
patch(
    "scripts/v107-visual-qa.ts",
    """        maxTrackingEm,
        maxSemanticGapEm,
""",
    """        maxTrackingEm,
        maxGlyphScaleDelta,
        maxAdjacentGlyphScaleDelta,
        maxSemanticGapEm,
""",
)
patch(
    "scripts/v107-visual-qa.ts",
    """      report.maxWordSpacingEm > 0.116 || report.maxTrackingEm > 0.0057 || report.maxSemanticGapEm > 0.43 ||
      report.maxAdjacentSpacingDeltaEm > 0.22 || report.hyphenRate > 0.45 || report.maxHyphenStreak > 2 ||
""",
    """      report.maxWordSpacingEm > 0.116 || report.maxTrackingEm > 0.0057 || report.maxGlyphScaleDelta > 0.0201 ||
      report.maxAdjacentGlyphScaleDelta > 0.025 || report.maxSemanticGapEm > 0.43 ||
      report.maxAdjacentSpacingDeltaEm > 0.22 || report.hyphenRate > 0.45 || report.maxHyphenStreak > 2 ||
""",
)

print("Applied bounded ±2% glyph expansion to preview/export and added QA bounds")

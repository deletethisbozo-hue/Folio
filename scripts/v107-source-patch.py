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


# Make glyph expansion part of the line-fit optimisation itself. The previous
# implementation chose a locally optimal scale first and only then penalised
# the jump from the preceding line, so DP could not choose a slightly less
# aggressive scale for the same breakpoint to preserve paragraph colour.
patch(
    "web/src/compositor.ts",
    """  naturalWidth: number,
  emergency = false,
): LineFit | null {
""",
    """  naturalWidth: number,
  previousGlyphScale = 1,
  emergency = false,
): LineFit | null {
""",
)
patch(
    "web/src/compositor.ts",
    """  const available = naturalWidth + adjustment;
  const direction = adjustment >= 0 ? 1 : -1;
  let best: LineFit | null = null;

  // pdfTeX/microtype-style font expansion: use at most ±2%, and only in the
  // direction that reduces the required interword/tracking correction.
  for (let step = 0; step <= 20; step++) {
    const glyphScale = 1 + direction * step * 0.001;
""",
    """  const available = naturalWidth + adjustment;
  let best: LineFit | null = null;

  // Search the full ±2% microtype window. Usually the scale that helps the
  // spacing wins, but the continuity term can select a gentler neighbouring
  // scale when that preserves a more even paragraph colour.
  for (let step = -20; step <= 20; step++) {
    const glyphScale = 1 + step * 0.001;
""",
)
patch(
    "web/src/compositor.ts",
    """    const scaleRatio = Math.abs(glyphScale - 1) / 0.01;
    const badness = 100 * Math.pow(Math.abs(spaceRatio) / 0.20, 3)
      + 55 * Math.pow(Math.abs(trackingRatio) / 0.0035, 3)
      + 42 * Math.pow(scaleRatio, 3);
""",
    """    const scaleRatio = Math.abs(glyphScale - 1) / 0.01;
    const scaleJumpRatio = Math.abs(glyphScale - previousGlyphScale) / 0.01;
    const badness = 100 * Math.pow(Math.abs(spaceRatio) / 0.20, 3)
      + 55 * Math.pow(Math.abs(trackingRatio) / 0.0035, 3)
      + 42 * Math.pow(scaleRatio, 3)
      + 90 * Math.pow(scaleJumpRatio, 2);
""",
)
patch(
    "web/src/compositor.ts",
    """          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, false)
          : null;
        const fit = strictFit ?? (emergency && !last
          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, true)
""",
    """          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, previous.glyphScale, false)
          : null;
        const fit = strictFit ?? (emergency && !last
          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, previous.glyphScale, true)
""",
)
patch(
    "web/src/compositor.ts",
    """        const glyphScaleDelta = lineFit ? Math.abs(lineFit.glyphScale - previous.glyphScale) : 0;
        const glyphContinuityPenalty = line === 0 || !lineFit ? 0 : 45 * Math.pow(glyphScaleDelta / 0.01, 2);
        const currentGaps = gapPositions(words, start, end + 1, offset, spaceWidth, lineFit);
""",
    """        const currentGaps = gapPositions(words, start, end + 1, offset, spaceWidth, lineFit);
""",
)
patch(
    "web/src/compositor.ts",
    """          + fitnessPenalty
          + glyphContinuityPenalty
          + rivers.cost;
""",
    """          + fitnessPenalty
          + rivers.cost;
""",
)

patch(
    "server/pipeline/compositor.ts",
    """      naturalWidth: number,
      emergency = false,
    ): LineFit | null => {
""",
    """      naturalWidth: number,
      previousGlyphScale = 1,
      emergency = false,
    ): LineFit | null => {
""",
)
patch(
    "server/pipeline/compositor.ts",
    """      const available = naturalWidth + adjustment;
      const direction = adjustment >= 0 ? 1 : -1;
      let best: LineFit | null = null;

      for (let step = 0; step <= 20; step++) {
        const glyphScale = 1 + direction * step * 0.001;
""",
    """      const available = naturalWidth + adjustment;
      let best: LineFit | null = null;

      for (let step = -20; step <= 20; step++) {
        const glyphScale = 1 + step * 0.001;
""",
)
patch(
    "server/pipeline/compositor.ts",
    """        const scaleRatio = Math.abs(glyphScale - 1) / 0.01;
        const badness = 100 * Math.pow(Math.abs(spaceRatio) / 0.20, 3)
          + 55 * Math.pow(Math.abs(trackingRatio) / 0.0035, 3)
          + 42 * Math.pow(scaleRatio, 3);
""",
    """        const scaleRatio = Math.abs(glyphScale - 1) / 0.01;
        const scaleJumpRatio = Math.abs(glyphScale - previousGlyphScale) / 0.01;
        const badness = 100 * Math.pow(Math.abs(spaceRatio) / 0.20, 3)
          + 55 * Math.pow(Math.abs(trackingRatio) / 0.0035, 3)
          + 42 * Math.pow(scaleRatio, 3)
          + 90 * Math.pow(scaleJumpRatio, 2);
""",
)
patch(
    "server/pipeline/compositor.ts",
    """              ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, false)
              : null;
            const fit = strictFit ?? (emergency && !last
              ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, true)
""",
    """              ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, previous.glyphScale, false)
              : null;
            const fit = strictFit ?? (emergency && !last
              ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, previous.glyphScale, true)
""",
)
patch(
    "server/pipeline/compositor.ts",
    """            const glyphScaleDelta = lineFit ? Math.abs(lineFit.glyphScale - previous.glyphScale) : 0;
            const glyphContinuityPenalty = lineNo === 0 || !lineFit ? 0 : 45 * Math.pow(glyphScaleDelta / 0.01, 2);
            const currentGaps = lineGapPositions(words, start, end + 1, offset, spaceWidth, lineFit);
            const rivers = riverCost(currentGaps, previous, spaceWidth);
            const cost = previous.cost + (lineFit?.badness ?? 0) + rescuePenalty + hyphenPenalty + punctuationPenalty + shortLastPenalty + fitnessPenalty + glyphContinuityPenalty + rivers.cost;
""",
    """            const currentGaps = lineGapPositions(words, start, end + 1, offset, spaceWidth, lineFit);
            const rivers = riverCost(currentGaps, previous, spaceWidth);
            const cost = previous.cost + (lineFit?.badness ?? 0) + rescuePenalty + hyphenPenalty + punctuationPenalty + shortLastPenalty + fitnessPenalty + rivers.cost;
""",
)

# Keep exact scale values in diagnostics so future regressions are explainable.
patch(
    "scripts/v107-visual-qa.ts",
    """        trackingEm: number;
        gaps: number;
      }> = [];
""",
    """        trackingEm: number;
        glyphScale: number;
        gaps: number;
      }> = [];
""",
)
patch(
    "scripts/v107-visual-qa.ts",
    """            trackingEm: Number(line.dataset.folioTracking ?? 0) / fontSize,
            gaps: diagnosticWords.slice(1).filter((word) => word.dataset.folioSpaceBefore === \"true\").length,
""",
    """            trackingEm: Number(line.dataset.folioTracking ?? 0) / fontSize,
            glyphScale: Number(line.dataset.folioGlyphScale ?? 1),
            gaps: diagnosticWords.slice(1).filter((word) => word.dataset.folioSpaceBefore === \"true\").length,
""",
)

print("Integrated glyph-scale continuity into line-fit optimisation")

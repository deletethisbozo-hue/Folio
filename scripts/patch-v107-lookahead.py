from pathlib import Path

path = Path("web/src/compositor.ts")
text = path.read_text(encoding="utf-8")

helper_marker = "function chooseBreaks(\n"
helper = r'''function hasFeasibleNextLine(
  words: Word[],
  start: number,
  line: number,
  geometry: Geometry,
  spaceWidth: number,
  hyphenWidth: number,
  fontSize: number,
  previousGlyphScale: number,
  previousHyphenStreak: number,
  language: string,
): boolean {
  const count = words.length;
  if (start >= count) return true;
  const { available } = lineGeometry(line, geometry);
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
    if (hyphenBreak && previousHyphenStreak >= 2) continue;
    if (!canBreak) continue;

    const natural = wordWidth + gaps * spaceWidth + (hyphenBreak ? hyphenWidth : 0);
    const rightProtrusion = hyphenBreak
      ? Math.min(2.55, hyphenWidth * 0.51)
      : words[end].rightProtrusion;
    const appliedRightProtrusion = natural >= available ? rightProtrusion : 0;
    const opticalAvailable = available + appliedRightProtrusion;
    const adjustment = opticalAvailable - natural;
    const trackingOps = Math.max(0, characters + gaps - 1);
    const semanticWordsOnLine = 1 + words
      .slice(start + 1, end + 1)
      .filter((word) => word.spaceBefore).length;

    if (last) {
      if (semanticWordsOnLine < 2) return false;
      if (natural <= available + 0.75) return true;
      return Boolean(fitLine(
        adjustment, gaps, trackingOps, spaceWidth, fontSize, natural,
        previousGlyphScale, false, true, language,
      ));
    }

    const fit = fitLine(
      adjustment, gaps, trackingOps, spaceWidth, fontSize, natural,
      previousGlyphScale, false, false, language,
    );
    if (fit) return true;
    if (natural > available + 0.75) break;
  }
  return false;
}

'''
if text.count(helper_marker) != 1:
    raise SystemExit(f"chooseBreaks marker count={text.count(helper_marker)}")
text = text.replace(helper_marker, helper + helper_marker, 1)

cache_marker = "  const rejectedBreaks: Array<Record<string, unknown>> = [];\n"
cache_replacement = cache_marker + "  const nextLineFeasibility = new Map<string, boolean>();\n"
if text.count(cache_marker) != 1:
    raise SystemExit(f"rejectedBreaks marker count={text.count(cache_marker)}")
text = text.replace(cache_marker, cache_replacement, 1)

state_marker = """        const nextLine = line + 1;
        const nextStreak = hyphenBreak ? Math.min(2, previousHyphenStreak + 1) : 0;
        const nextHyphenCount = previousHyphenCount + (hyphenBreak ? 1 : 0);
        const nextKey = encodeState(nextLine, nextStreak, currentFitness, lineFit?.glyphScale ?? 1, nextHyphenCount);
"""
state_replacement = """        const nextLine = line + 1;
        const nextStreak = hyphenBreak ? Math.min(2, previousHyphenStreak + 1) : 0;
        const nextHyphenCount = previousHyphenCount + (hyphenBreak ? 1 : 0);
        if (!last && !emergency && lineFit) {
          const feasibilityKey = `${end + 1}:${nextLine}:${nextStreak}:${glyphScaleBucket(lineFit.glyphScale)}`;
          let feasible = nextLineFeasibility.get(feasibilityKey);
          if (feasible === undefined) {
            feasible = hasFeasibleNextLine(
              words, end + 1, nextLine, geometry, spaceWidth, hyphenWidth, fontSize,
              lineFit.glyphScale, nextStreak, language,
            );
            nextLineFeasibility.set(feasibilityKey, feasible);
          }
          if (!feasible) {
            if (rejectedBreaks.length < 160) rejectedBreaks.push({
              reason: "dead-end-lookahead", start, end, line, nextLine, nextStreak,
              startText: (words[start].node.textContent ?? "").replace(/\\u00ad/g, ""),
              endText: (words[end].node.textContent ?? "").replace(/\\u00ad/g, ""),
              nextText: (words[end + 1]?.node.textContent ?? "").replace(/\\u00ad/g, ""),
            });
            continue;
          }
        }
        const nextKey = encodeState(nextLine, nextStreak, currentFitness, lineFit?.glyphScale ?? 1, nextHyphenCount);
"""
if text.count(state_marker) != 1:
    raise SystemExit(f"state marker count={text.count(state_marker)}")
text = text.replace(state_marker, state_replacement, 1)

path.write_text(text, encoding="utf-8")

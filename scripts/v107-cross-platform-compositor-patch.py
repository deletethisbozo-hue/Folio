from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

for relative in ["web/src/compositor.ts", "server/pipeline/compositor.ts"]:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")

    # Keep the already-qualified composition envelope and paragraph rules.
    if "const minWordSpacing = -Math.min(spaceWidth * 0.22, fontSize * 0.055);" not in value:
        raise RuntimeError(f"expected word-spacing envelope missing in {relative}")
    if "1800 + (previous.hyphenated ? 1200 : 0) + 600 * Math.pow(1 - fill, 2)" not in value:
        raise RuntimeError(f"widow penalty missing in {relative}")
    if "const correctedScale = Math.max(0.98, Math.min(1.02, currentScale * measure / rendered));" not in value:
        raise RuntimeError(f"cross-platform calibration missing in {relative}")

    if relative == "web/src/compositor.ts":
        old_codec = '''function encodeState(
  line: number,
  hyphenStreak: number,
  fitness: number,
  glyphScale: number,
  previousLineStart: number,
  stride: number,
): number {
  const base = (line * HYPHEN_STREAK_COUNT + hyphenStreak) * FITNESS_COUNT + fitness;
  const packed = base * GLYPH_SCALE_COUNT + glyphScaleBucket(glyphScale);
  return packed * stride + previousLineStart;
}

function decodeState(key: number, stride: number): { line: number; hyphenStreak: number; fitness: number; glyphScale: number; previousLineStart: number } {
  const previousLineStart = key % stride;
  const packed = Math.floor(key / stride);
  const glyphBucket = packed % GLYPH_SCALE_COUNT;
  const base = Math.floor(packed / GLYPH_SCALE_COUNT);
  return {
    line: Math.floor(base / (HYPHEN_STREAK_COUNT * FITNESS_COUNT)),
    hyphenStreak: Math.floor(base / FITNESS_COUNT) % HYPHEN_STREAK_COUNT,
    fitness: base % FITNESS_COUNT,
    glyphScale: GLYPH_SCALE_MIN + glyphBucket * GLYPH_SCALE_STEP,
    previousLineStart,
  };
}'''
        new_codec = '''const HYPHEN_COUNT_COUNT = 16;

function encodeState(
  line: number,
  hyphenStreak: number,
  fitness: number,
  glyphScale: number,
  hyphenCount: number,
): number {
  const base = (line * HYPHEN_STREAK_COUNT + hyphenStreak) * FITNESS_COUNT + fitness;
  const packed = base * GLYPH_SCALE_COUNT + glyphScaleBucket(glyphScale);
  return packed * HYPHEN_COUNT_COUNT + Math.max(0, Math.min(HYPHEN_COUNT_COUNT - 1, hyphenCount));
}

function decodeState(key: number): { line: number; hyphenStreak: number; fitness: number; glyphScale: number; hyphenCount: number } {
  const hyphenCount = key % HYPHEN_COUNT_COUNT;
  const packed = Math.floor(key / HYPHEN_COUNT_COUNT);
  const glyphBucket = packed % GLYPH_SCALE_COUNT;
  const base = Math.floor(packed / GLYPH_SCALE_COUNT);
  return {
    line: Math.floor(base / (HYPHEN_STREAK_COUNT * FITNESS_COUNT)),
    hyphenStreak: Math.floor(base / FITNESS_COUNT) % HYPHEN_STREAK_COUNT,
    fitness: base % FITNESS_COUNT,
    glyphScale: GLYPH_SCALE_MIN + glyphBucket * GLYPH_SCALE_STEP,
    hyphenCount,
  };
}'''
        if old_codec in value:
            value = value.replace(old_codec, new_codec, 1)
        elif new_codec not in value:
            raise RuntimeError("preview DP codec not found")

        value = value.replace("  const stateStride = count + 1;\n", "", 1)
        value = value.replace(
            "states[0].set(encodeState(0, 0, initialFitness, 1, 0, stateStride),",
            "states[0].set(encodeState(0, 0, initialFitness, 1, 0),",
            1,
        )
        value = value.replace("const decoded = decodeState(stateKey, stateStride);", "const decoded = decodeState(stateKey);", 1)
        value = value.replace(
            "      const previousFitness = decoded.fitness;",
            "      const previousFitness = decoded.fitness;\n      const previousHyphenCount = decoded.hyphenCount;",
            1,
        )
        value = value.replace(
            '''        const hyphenPenalty = hyphenBreak
          ? 240 + previousHyphenStreak * 950
          : 0;''',
            '''        // Hyphenation is evaluated across the paragraph, not only as a
        // local streak. Keeping cumulative count in the DP state preserves a
        // slightly more expensive low-hyphen path instead of merging it away.
        const hyphenPenalty = hyphenBreak
          ? 240 + previousHyphenStreak * 950 + previousHyphenCount * 180
          : 0;''',
            1,
        )
        value = value.replace(
            '''        const nextLine = line + 1;
        const nextStreak = hyphenBreak ? Math.min(2, previousHyphenStreak + 1) : 0;
        const nextKey = encodeState(nextLine, nextStreak, currentFitness, lineFit?.glyphScale ?? 1, start, stateStride);''',
            '''        const nextLine = line + 1;
        const nextStreak = hyphenBreak ? Math.min(2, previousHyphenStreak + 1) : 0;
        const nextHyphenCount = Math.min(HYPHEN_COUNT_COUNT - 1, previousHyphenCount + (hyphenBreak ? 1 : 0));
        const nextKey = encodeState(nextLine, nextStreak, currentFitness, lineFit?.glyphScale ?? 1, nextHyphenCount);''',
            1,
        )
        value = value.replace("decodeState(stateKey, stateStride)", "decodeState(stateKey)")

        if "previousLineStart" in value or "stateStride" in value:
            raise RuntimeError("preview still contains unbounded previous-line DP state")
        if "previousHyphenCount * 180" not in value or "nextHyphenCount" not in value:
            raise RuntimeError("preview cumulative hyphen state was not installed")
    else:
        old_codec = '''    const encodeState = (line: number, hyphenStreak: number, fitness: number, glyphScale: number, previousLineStart: number, stride: number) => {
      const base = (line * HYPHEN_STREAK_COUNT + hyphenStreak) * FITNESS_COUNT + fitness;
      const packed = base * GLYPH_SCALE_COUNT + glyphScaleBucket(glyphScale);
      return packed * stride + previousLineStart;
    };
    const decodeState = (key: number, stride: number) => {
      const previousLineStart = key % stride;
      const packed = Math.floor(key / stride);
      const glyphBucket = packed % GLYPH_SCALE_COUNT;
      const base = Math.floor(packed / GLYPH_SCALE_COUNT);
      return {
        line: Math.floor(base / (HYPHEN_STREAK_COUNT * FITNESS_COUNT)),
        hyphenStreak: Math.floor(base / FITNESS_COUNT) % HYPHEN_STREAK_COUNT,
        fitness: base % FITNESS_COUNT,
        glyphScale: GLYPH_SCALE_MIN + glyphBucket * GLYPH_SCALE_STEP,
        previousLineStart,
      };
    };'''
        new_codec = '''    const HYPHEN_COUNT_COUNT = 16;
    const encodeState = (line: number, hyphenStreak: number, fitness: number, glyphScale: number, hyphenCount: number) => {
      const base = (line * HYPHEN_STREAK_COUNT + hyphenStreak) * FITNESS_COUNT + fitness;
      const packed = base * GLYPH_SCALE_COUNT + glyphScaleBucket(glyphScale);
      return packed * HYPHEN_COUNT_COUNT + Math.max(0, Math.min(HYPHEN_COUNT_COUNT - 1, hyphenCount));
    };
    const decodeState = (key: number) => {
      const hyphenCount = key % HYPHEN_COUNT_COUNT;
      const packed = Math.floor(key / HYPHEN_COUNT_COUNT);
      const glyphBucket = packed % GLYPH_SCALE_COUNT;
      const base = Math.floor(packed / GLYPH_SCALE_COUNT);
      return {
        line: Math.floor(base / (HYPHEN_STREAK_COUNT * FITNESS_COUNT)),
        hyphenStreak: Math.floor(base / FITNESS_COUNT) % HYPHEN_STREAK_COUNT,
        fitness: base % FITNESS_COUNT,
        glyphScale: GLYPH_SCALE_MIN + glyphBucket * GLYPH_SCALE_STEP,
        hyphenCount,
      };
    };'''
        if old_codec in value:
            value = value.replace(old_codec, new_codec, 1)
        elif new_codec not in value:
            raise RuntimeError("export DP codec not found")

        value = value.replace("      const stateStride = words.length + 1;\n", "", 1)
        value = value.replace(
            "states[0].set(encodeState(0, 0, initialFitness, 1, 0, stateStride),",
            "states[0].set(encodeState(0, 0, initialFitness, 1, 0),",
            1,
        )
        value = value.replace("const decoded = decodeState(stateKey, stateStride);", "const decoded = decodeState(stateKey);", 1)
        value = value.replace(
            "          const previousFitness = decoded.fitness;",
            "          const previousFitness = decoded.fitness;\n          const previousHyphenCount = decoded.hyphenCount;",
            1,
        )
        value = value.replace(
            "const hyphenPenalty = hyphenBreak ? 240 + previousHyphenStreak * 950 : 0;",
            "const hyphenPenalty = hyphenBreak ? 240 + previousHyphenStreak * 950 + previousHyphenCount * 180 : 0;",
            1,
        )
        value = value.replace(
            '''            const nextLine = lineNo + 1;
            const nextStreak = hyphenBreak ? Math.min(2, previousHyphenStreak + 1) : 0;
            const nextKey = encodeState(nextLine, nextStreak, currentFitness, lineFit?.glyphScale ?? 1, start, stateStride);''',
            '''            const nextLine = lineNo + 1;
            const nextStreak = hyphenBreak ? Math.min(2, previousHyphenStreak + 1) : 0;
            const nextHyphenCount = Math.min(HYPHEN_COUNT_COUNT - 1, previousHyphenCount + (hyphenBreak ? 1 : 0));
            const nextKey = encodeState(nextLine, nextStreak, currentFitness, lineFit?.glyphScale ?? 1, nextHyphenCount);''',
            1,
        )
        if "previousLineStart" in value or "stateStride" in value:
            raise RuntimeError("export still contains unbounded previous-line DP state")
        if "previousHyphenCount * 180" not in value or "nextHyphenCount" not in value:
            raise RuntimeError("export cumulative hyphen state was not installed")

    path.write_text(value, encoding="utf-8")
    print(f"installed bounded cumulative-hyphen DP state in {relative}")

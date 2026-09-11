from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

for relative in ["web/src/compositor.ts", "server/pipeline/compositor.ts"]:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")

    old_spacing = "const minWordSpacing = -Math.min(spaceWidth * 0.18, fontSize * 0.045);"
    new_spacing = "const minWordSpacing = -Math.min(spaceWidth * 0.22, fontSize * 0.055);"
    if old_spacing in value:
        value = value.replace(old_spacing, new_spacing, 1)
    elif new_spacing not in value:
        raise RuntimeError(f"minimum word-spacing envelope not found in {relative}")

    for old in [
        "? 900 + previousHyphenStreak * 950",
        "? 400 + previousHyphenStreak * 950",
    ]:
        if old in value:
            value = value.replace(old, "? 240 + previousHyphenStreak * 950", 1)
            break
    if "240 + previousHyphenStreak * 950" not in value:
        raise RuntimeError(f"moderate hyphen penalty not found in {relative}")

    if "1800 + (previous.hyphenated ? 1200 : 0) + 600 * Math.pow(1 - fill, 2)" not in value:
        pattern = re.compile(
            r"(?P<indent>[ \t]*)const shortLastPenalty = last\n"
            r"(?P=indent)  \? \(wordsOnLine === 1 \? 180 : fill < 0\.28 \? 80 \* Math\.pow\(\(0\.28 - fill\) / 0\.28, 2\) : 0\)\n"
            r"(?P=indent)  : 0;"
        )
        match = pattern.search(value)
        if not match:
            raise RuntimeError(f"final-line widow penalty block not found in {relative}")
        indent = match.group("indent")
        replacement = (
            f"{indent}// A stranded final word is a real book-composition defect, especially\n"
            f"{indent}// when the preceding line was itself hyphenated. Preserve feasible\n"
            f"{indent}// alternatives instead of buying an ugly paragraph ending for a\n"
            f"{indent}// slightly cheaper local line fit.\n"
            f"{indent}const shortLastPenalty = last\n"
            f"{indent}  ? wordsOnLine === 1\n"
            f"{indent}    ? 1800 + (previous.hyphenated ? 1200 : 0) + 600 * Math.pow(1 - fill, 2)\n"
            f"{indent}    : fill < 0.28 ? 220 * Math.pow((0.28 - fill) / 0.28, 2) : 0\n"
            f"{indent}  : 0;"
        )
        value = value[:match.start()] + replacement + value[match.end():]

    if relative == "web/src/compositor.ts":
        old_passes = '''  // Three deliberately separate passes. Natural rescue must never compete
  // on cost with an available justified solution.
  let breaks = chooseBreaks(words, geometry, spaceWidth, hyphenWidth, fontSize, false, paragraph, false);
  if (!breaks) breaks = chooseBreaks(words, geometry, spaceWidth, hyphenWidth, fontSize, true, paragraph, false);
  if (!breaks) breaks = chooseBreaks(words, geometry, spaceWidth, hyphenWidth, fontSize, true, null, true);'''
        new_passes = '''  // Let the controlled relaxed envelope participate in the same global
  // optimisation as strict lines. Each relaxed line still carries a large
  // penalty, so it is selected only when it improves the paragraph as a whole
  // (for example by avoiding excessive hyphenation or a stranded final word).
  // Natural rescue remains a separate last resort and never competes on cost.
  let breaks = chooseBreaks(words, geometry, spaceWidth, hyphenWidth, fontSize, true, paragraph, false);
  if (!breaks) breaks = chooseBreaks(words, geometry, spaceWidth, hyphenWidth, fontSize, true, null, true);'''
        if old_passes in value:
            value = value.replace(old_passes, new_passes, 1)
        elif new_passes not in value:
            raise RuntimeError("preview pass-order block not found")

        old_state_codec = '''function encodeState(line: number, hyphenStreak: number, fitness: number, glyphScale: number): number {
  const base = (line * HYPHEN_STREAK_COUNT + hyphenStreak) * FITNESS_COUNT + fitness;
  return base * GLYPH_SCALE_COUNT + glyphScaleBucket(glyphScale);
}

function decodeState(key: number): { line: number; hyphenStreak: number; fitness: number; glyphScale: number } {
  const glyphBucket = key % GLYPH_SCALE_COUNT;
  const base = Math.floor(key / GLYPH_SCALE_COUNT);
  return {
    line: Math.floor(base / (HYPHEN_STREAK_COUNT * FITNESS_COUNT)),
    hyphenStreak: Math.floor(base / FITNESS_COUNT) % HYPHEN_STREAK_COUNT,
    fitness: base % FITNESS_COUNT,
    glyphScale: GLYPH_SCALE_MIN + glyphBucket * GLYPH_SCALE_STEP,
  };
}'''
        new_state_codec = '''function encodeState(
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
        if old_state_codec in value:
            value = value.replace(old_state_codec, new_state_codec, 1)
        elif new_state_codec not in value:
            raise RuntimeError("preview DP state codec not found")

        value = value.replace(
            "  const count = words.length;\n  const states: Array<Map<number, State>>",
            "  const count = words.length;\n  const stateStride = count + 1;\n  const states: Array<Map<number, State>>",
            1,
        )
        value = value.replace(
            "states[0].set(encodeState(0, 0, initialFitness, 1),",
            "states[0].set(encodeState(0, 0, initialFitness, 1, 0, stateStride),",
            1,
        )
        value = value.replace("decodeState(stateKey)", "decodeState(stateKey, stateStride)")
        value = value.replace(
            "const nextKey = encodeState(nextLine, nextStreak, currentFitness, lineFit?.glyphScale ?? 1);",
            "const nextKey = encodeState(nextLine, nextStreak, currentFitness, lineFit?.glyphScale ?? 1, start, stateStride);",
            1,
        )
        if "previousLineStart: number" not in value or "start, stateStride" not in value:
            raise RuntimeError("preview previous-line DP context was not installed")
    else:
        old_passes = "const breaks = runBreaker(false, false) ?? runBreaker(true, false) ?? runBreaker(true, true);"
        new_passes = "const breaks = runBreaker(true, false) ?? runBreaker(true, true);"
        if old_passes in value:
            value = value.replace(old_passes, new_passes, 1)
        elif new_passes not in value:
            raise RuntimeError("export pass-order block not found")

        old_state_codec = '''    const encodeState = (line: number, hyphenStreak: number, fitness: number, glyphScale: number) => {
      const base = (line * HYPHEN_STREAK_COUNT + hyphenStreak) * FITNESS_COUNT + fitness;
      return base * GLYPH_SCALE_COUNT + glyphScaleBucket(glyphScale);
    };
    const decodeState = (key: number) => {
      const glyphBucket = key % GLYPH_SCALE_COUNT;
      const base = Math.floor(key / GLYPH_SCALE_COUNT);
      return {
        line: Math.floor(base / (HYPHEN_STREAK_COUNT * FITNESS_COUNT)),
        hyphenStreak: Math.floor(base / FITNESS_COUNT) % HYPHEN_STREAK_COUNT,
        fitness: base % FITNESS_COUNT,
        glyphScale: GLYPH_SCALE_MIN + glyphBucket * GLYPH_SCALE_STEP,
      };
    };'''
        new_state_codec = '''    const encodeState = (line: number, hyphenStreak: number, fitness: number, glyphScale: number, previousLineStart: number, stride: number) => {
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
        if old_state_codec in value:
            value = value.replace(old_state_codec, new_state_codec, 1)
        elif new_state_codec not in value:
            raise RuntimeError("export DP state codec not found")

        value = value.replace(
            "      const states: Array<Map<number, State>> = Array.from({ length: words.length + 1 }, () => new Map());",
            "      const stateStride = words.length + 1;\n      const states: Array<Map<number, State>> = Array.from({ length: words.length + 1 }, () => new Map());",
            1,
        )
        value = value.replace(
            "states[0].set(encodeState(0, 0, initialFitness, 1),",
            "states[0].set(encodeState(0, 0, initialFitness, 1, 0, stateStride),",
            1,
        )
        value = value.replace("decodeState(stateKey)", "decodeState(stateKey, stateStride)")
        value = value.replace(
            "const nextKey = encodeState(nextLine, nextStreak, currentFitness, lineFit?.glyphScale ?? 1);",
            "const nextKey = encodeState(nextLine, nextStreak, currentFitness, lineFit?.glyphScale ?? 1, start, stateStride);",
            1,
        )
        if "previousLineStart: number" not in value and "previousLineStart, stride" not in value:
            raise RuntimeError("export previous-line DP context was not installed")
        if "start, stateStride" not in value:
            raise RuntimeError("export previous-line start was not included in state key")

    if "const correctedScale = Math.max(0.98, Math.min(1.02, currentScale * measure / rendered));" not in value:
        raise RuntimeError(f"cross-platform line calibration missing in {relative}")

    path.write_text(value, encoding="utf-8")
    print(f"applied cross-platform composition calibration in {relative}")

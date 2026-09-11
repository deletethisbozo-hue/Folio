from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"missing marker: {label}")
    return text.replace(old, new, 1)


def patch_web(path: Path) -> None:
    value = path.read_text(encoding="utf-8")

    value = replace_once(
        value,
        '''type State = Break & {\n  cost: number;\n  from: number;\n  fromKey: number;\n  fitness: number;\n  gapPositions: number[];\n  riverPositions: number[];\n};''',
        '''type State = Break & {\n  cost: number;\n  from: number;\n  fromKey: number;\n  fitness: number;\n  hyphenCount: number;\n  gapPositions: number[];\n  riverPositions: number[];\n};''',
        "web State.hyphenCount",
    )

    old_codec = '''const HYPHEN_COUNT_COUNT = 16;\n\nfunction encodeState(\n  line: number,\n  hyphenStreak: number,\n  fitness: number,\n  glyphScale: number,\n  hyphenCount: number,\n): number {\n  const base = (line * HYPHEN_STREAK_COUNT + hyphenStreak) * FITNESS_COUNT + fitness;\n  const packed = base * GLYPH_SCALE_COUNT + glyphScaleBucket(glyphScale);\n  return packed * HYPHEN_COUNT_COUNT + Math.max(0, Math.min(HYPHEN_COUNT_COUNT - 1, hyphenCount));\n}\n\nfunction decodeState(key: number): { line: number; hyphenStreak: number; fitness: number; glyphScale: number; hyphenCount: number } {\n  const hyphenCount = key % HYPHEN_COUNT_COUNT;\n  const packed = Math.floor(key / HYPHEN_COUNT_COUNT);\n  const glyphBucket = packed % GLYPH_SCALE_COUNT;\n  const base = Math.floor(packed / GLYPH_SCALE_COUNT);\n  return {\n    line: Math.floor(base / (HYPHEN_STREAK_COUNT * FITNESS_COUNT)),\n    hyphenStreak: Math.floor(base / FITNESS_COUNT) % HYPHEN_STREAK_COUNT,\n    fitness: base % FITNESS_COUNT,\n    glyphScale: GLYPH_SCALE_MIN + glyphBucket * GLYPH_SCALE_STEP,\n    hyphenCount,\n  };\n}'''
    new_codec = '''const HYPHEN_BUCKET_COUNT = 4;\n\nfunction hyphenCountBucket(hyphenCount: number): number {\n  if (hyphenCount <= 4) return 0;\n  if (hyphenCount === 5) return 1;\n  if (hyphenCount === 6) return 2;\n  return 3;\n}\n\nfunction encodeState(\n  line: number,\n  hyphenStreak: number,\n  fitness: number,\n  glyphScale: number,\n  hyphenCount: number,\n): number {\n  const base = (line * HYPHEN_STREAK_COUNT + hyphenStreak) * FITNESS_COUNT + fitness;\n  const packed = base * GLYPH_SCALE_COUNT + glyphScaleBucket(glyphScale);\n  return packed * HYPHEN_BUCKET_COUNT + hyphenCountBucket(hyphenCount);\n}\n\nfunction decodeState(key: number): { line: number; hyphenStreak: number; fitness: number; glyphScale: number; hyphenBucket: number } {\n  const hyphenBucket = key % HYPHEN_BUCKET_COUNT;\n  const packed = Math.floor(key / HYPHEN_BUCKET_COUNT);\n  const glyphBucket = packed % GLYPH_SCALE_COUNT;\n  const base = Math.floor(packed / GLYPH_SCALE_COUNT);\n  return {\n    line: Math.floor(base / (HYPHEN_STREAK_COUNT * FITNESS_COUNT)),\n    hyphenStreak: Math.floor(base / FITNESS_COUNT) % HYPHEN_STREAK_COUNT,\n    fitness: base % FITNESS_COUNT,\n    glyphScale: GLYPH_SCALE_MIN + glyphBucket * GLYPH_SCALE_STEP,\n    hyphenBucket,\n  };\n}'''
    value = replace_once(value, old_codec, new_codec, "web hyphen bucket codec")

    value = replace_once(
        value,
        '''    fitness: initialFitness,\n    gapPositions: [],''',
        '''    fitness: initialFitness,\n    hyphenCount: 0,\n    gapPositions: [],''',
        "web initial hyphenCount",
    )
    value = replace_once(
        value,
        '''      const previousFitness = decoded.fitness;\n      const previousHyphenCount = decoded.hyphenCount;''',
        '''      const previousFitness = decoded.fitness;\n      const previousHyphenCount = previous.hyphenCount;''',
        "web previous hyphen count",
    )
    value = replace_once(
        value,
        '''        const nextHyphenCount = Math.min(HYPHEN_COUNT_COUNT - 1, previousHyphenCount + (hyphenBreak ? 1 : 0));''',
        '''        const nextHyphenCount = previousHyphenCount + (hyphenBreak ? 1 : 0);''',
        "web exact next hyphen count",
    )
    value = replace_once(
        value,
        '''            fitness: currentFitness,\n            gapPositions: currentGaps,''',
        '''            fitness: currentFitness,\n            hyphenCount: nextHyphenCount,\n            gapPositions: currentGaps,''',
        "web stored next hyphen count",
    )

    path.write_text(value, encoding="utf-8")


def patch_server(path: Path) -> None:
    value = path.read_text(encoding="utf-8")

    value = replace_once(
        value,
        '''    type State = Break & {\n      cost: number;\n      from: number;\n      fromKey: number;\n      fitness: number;\n      gapPositions: number[];\n      riverPositions: number[];\n    };''',
        '''    type State = Break & {\n      cost: number;\n      from: number;\n      fromKey: number;\n      fitness: number;\n      hyphenCount: number;\n      gapPositions: number[];\n      riverPositions: number[];\n    };''',
        "server State.hyphenCount",
    )

    old_codec = '''    const HYPHEN_COUNT_COUNT = 16;\n    const encodeState = (line: number, hyphenStreak: number, fitness: number, glyphScale: number, hyphenCount: number) => {\n      const base = (line * HYPHEN_STREAK_COUNT + hyphenStreak) * FITNESS_COUNT + fitness;\n      const packed = base * GLYPH_SCALE_COUNT + glyphScaleBucket(glyphScale);\n      return packed * HYPHEN_COUNT_COUNT + Math.max(0, Math.min(HYPHEN_COUNT_COUNT - 1, hyphenCount));\n    };\n    const decodeState = (key: number) => {\n      const hyphenCount = key % HYPHEN_COUNT_COUNT;\n      const packed = Math.floor(key / HYPHEN_COUNT_COUNT);\n      const glyphBucket = packed % GLYPH_SCALE_COUNT;\n      const base = Math.floor(packed / GLYPH_SCALE_COUNT);\n      return {\n        line: Math.floor(base / (HYPHEN_STREAK_COUNT * FITNESS_COUNT)),\n        hyphenStreak: Math.floor(base / FITNESS_COUNT) % HYPHEN_STREAK_COUNT,\n        fitness: base % FITNESS_COUNT,\n        glyphScale: GLYPH_SCALE_MIN + glyphBucket * GLYPH_SCALE_STEP,\n        hyphenCount,\n      };\n    };'''
    new_codec = '''    const HYPHEN_BUCKET_COUNT = 4;\n    const hyphenCountBucket = (hyphenCount: number) =>\n      hyphenCount <= 4 ? 0 : hyphenCount === 5 ? 1 : hyphenCount === 6 ? 2 : 3;\n    const encodeState = (line: number, hyphenStreak: number, fitness: number, glyphScale: number, hyphenCount: number) => {\n      const base = (line * HYPHEN_STREAK_COUNT + hyphenStreak) * FITNESS_COUNT + fitness;\n      const packed = base * GLYPH_SCALE_COUNT + glyphScaleBucket(glyphScale);\n      return packed * HYPHEN_BUCKET_COUNT + hyphenCountBucket(hyphenCount);\n    };\n    const decodeState = (key: number) => {\n      const hyphenBucket = key % HYPHEN_BUCKET_COUNT;\n      const packed = Math.floor(key / HYPHEN_BUCKET_COUNT);\n      const glyphBucket = packed % GLYPH_SCALE_COUNT;\n      const base = Math.floor(packed / GLYPH_SCALE_COUNT);\n      return {\n        line: Math.floor(base / (HYPHEN_STREAK_COUNT * FITNESS_COUNT)),\n        hyphenStreak: Math.floor(base / FITNESS_COUNT) % HYPHEN_STREAK_COUNT,\n        fitness: base % FITNESS_COUNT,\n        glyphScale: GLYPH_SCALE_MIN + glyphBucket * GLYPH_SCALE_STEP,\n        hyphenBucket,\n      };\n    };'''
    value = replace_once(value, old_codec, new_codec, "server hyphen bucket codec")

    value = replace_once(
        value,
        '''        fitness: initialFitness,\n        gapPositions: [],''',
        '''        fitness: initialFitness,\n        hyphenCount: 0,\n        gapPositions: [],''',
        "server initial hyphenCount",
    )
    value = replace_once(
        value,
        '''          const previousFitness = decoded.fitness;\n          const previousHyphenCount = decoded.hyphenCount;''',
        '''          const previousFitness = decoded.fitness;\n          const previousHyphenCount = previous.hyphenCount;''',
        "server previous hyphen count",
    )
    value = replace_once(
        value,
        '''            const nextHyphenCount = Math.min(HYPHEN_COUNT_COUNT - 1, previousHyphenCount + (hyphenBreak ? 1 : 0));''',
        '''            const nextHyphenCount = previousHyphenCount + (hyphenBreak ? 1 : 0);''',
        "server exact next hyphen count",
    )
    value = replace_once(
        value,
        '''              fitness: currentFitness,\n              gapPositions: currentGaps,''',
        '''              fitness: currentFitness,\n              hyphenCount: nextHyphenCount,\n              gapPositions: currentGaps,''',
        "server stored next hyphen count",
    )

    path.write_text(value, encoding="utf-8")


patch_web(ROOT / "web/src/compositor.ts")
patch_server(ROOT / "server/pipeline/compositor.ts")
print("Installed bounded 0-4 / 5 / 6 / 7+ hyphen DP buckets in preview and export compositor")

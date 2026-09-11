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


web_state_old = '''const FITNESS_COUNT = 4;
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
'''
web_state_new = '''const FITNESS_COUNT = 4;
const HYPHEN_STREAK_COUNT = 3;
const GLYPH_SCALE_MIN = 0.98;
const GLYPH_SCALE_STEP = 0.001;
const GLYPH_SCALE_COUNT = 41;

function glyphScaleBucket(glyphScale: number): number {
  return Math.max(0, Math.min(
    GLYPH_SCALE_COUNT - 1,
    Math.round((glyphScale - GLYPH_SCALE_MIN) / GLYPH_SCALE_STEP),
  ));
}

function encodeState(line: number, hyphenStreak: number, fitness: number, glyphScale: number): number {
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
}
'''
patch("web/src/compositor.ts", web_state_old, web_state_new)
patch(
    "web/src/compositor.ts",
    "states[0].set(encodeState(0, 0, initialFitness), {",
    "states[0].set(encodeState(0, 0, initialFitness, 1), {",
)
patch(
    "web/src/compositor.ts",
    "const nextKey = encodeState(nextLine, nextStreak, currentFitness);",
    "const nextKey = encodeState(nextLine, nextStreak, currentFitness, lineFit?.glyphScale ?? 1);",
)
# Remove a stale local continuity calculation. Continuity is already included
# inside fitLine's badness, where it can influence the chosen scale candidate.
patch(
    "web/src/compositor.ts",
    '''        const glyphScaleDelta = lineFit ? Math.abs(lineFit.glyphScale - previous.glyphScale) : 0;
        const glyphContinuityPenalty = line === 0 || !lineFit ? 0 : 45 * Math.pow(glyphScaleDelta / 0.01, 2);
''',
    "",
)

server_state_old = '''    const FITNESS_COUNT = 4;
    const HYPHEN_STREAK_COUNT = 3;
    const encodeState = (line: number, hyphenStreak: number, fitness: number) =>
      (line * HYPHEN_STREAK_COUNT + hyphenStreak) * FITNESS_COUNT + fitness;
    const decodeState = (key: number) => ({
      line: Math.floor(key / (HYPHEN_STREAK_COUNT * FITNESS_COUNT)),
      hyphenStreak: Math.floor(key / FITNESS_COUNT) % HYPHEN_STREAK_COUNT,
      fitness: key % FITNESS_COUNT,
    });
'''
server_state_new = '''    const FITNESS_COUNT = 4;
    const HYPHEN_STREAK_COUNT = 3;
    const GLYPH_SCALE_MIN = 0.98;
    const GLYPH_SCALE_STEP = 0.001;
    const GLYPH_SCALE_COUNT = 41;
    const glyphScaleBucket = (glyphScale: number) => Math.max(0, Math.min(
      GLYPH_SCALE_COUNT - 1,
      Math.round((glyphScale - GLYPH_SCALE_MIN) / GLYPH_SCALE_STEP),
    ));
    const encodeState = (line: number, hyphenStreak: number, fitness: number, glyphScale: number) => {
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
    };
'''
patch("server/pipeline/compositor.ts", server_state_old, server_state_new)
patch(
    "server/pipeline/compositor.ts",
    "states[0].set(encodeState(0, 0, initialFitness), {",
    "states[0].set(encodeState(0, 0, initialFitness, 1), {",
)
patch(
    "server/pipeline/compositor.ts",
    "const nextKey = encodeState(nextLine, nextStreak, currentFitness);",
    "const nextKey = encodeState(nextLine, nextStreak, currentFitness, lineFit?.glyphScale ?? 1);",
)

print("Made glyph scale part of the compositor DP state in preview and export")

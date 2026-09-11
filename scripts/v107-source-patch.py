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

qa_type_old = '''        wordSpacingEm: number;
        trackingEm: number;
      }> = [];
'''
qa_type_new = '''        wordSpacingEm: number;
        trackingEm: number;
        tokens: Array<{ text: string; spaceBefore: boolean; hyphenBefore: boolean; widthPx: number }>;
        nextLineTokens: Array<{ text: string; spaceBefore: boolean; hyphenBefore: boolean; widthPx: number }>;
      }> = [];
'''
patch("scripts/v107-visual-qa.ts", qa_type_old, qa_type_new)

qa_push_old = '''              wordSpacingEm: Number(line.dataset.folioWordSpacing ?? 0) / fontSize,
              trackingEm: Number(line.dataset.folioTracking ?? 0) / fontSize,
            });
'''
qa_push_new = '''              wordSpacingEm: Number(line.dataset.folioWordSpacing ?? 0) / fontSize,
              trackingEm: Number(line.dataset.folioTracking ?? 0) / fontSize,
              tokens: words.map((word) => ({
                text: (word.textContent ?? "").replace(/\\u00ad/g, ""),
                spaceBefore: word.dataset.folioSpaceBefore === "true",
                hyphenBefore: word.dataset.folioHyphenBefore === "true",
                widthPx: word.getBoundingClientRect().width,
              })),
              nextLineTokens: [...(lines[lineIndex + 1]?.querySelectorAll<HTMLElement>(".folio-word") ?? [])].map((word) => ({
                text: (word.textContent ?? "").replace(/\\u00ad/g, ""),
                spaceBefore: word.dataset.folioSpaceBefore === "true",
                hyphenBefore: word.dataset.folioHyphenBefore === "true",
                widthPx: word.getBoundingClientRect().width,
              })),
            });
'''
patch("scripts/v107-visual-qa.ts", qa_push_old, qa_push_new)

# Temporary strict-pass reachability trace. The breaker is deterministic, so a
# compact tail of reachable token boundaries is enough to show exactly where a
# paragraph stops being feasible without weakening any typography limits.
choose_sig_old = '''function chooseBreaks(
  words: Word[],
  geometry: Geometry,
  spaceWidth: number,
  hyphenWidth: number,
  fontSize: number,
  emergency = false,
): Break[] | null {
'''
choose_sig_new = '''function chooseBreaks(
  words: Word[],
  geometry: Geometry,
  spaceWidth: number,
  hyphenWidth: number,
  fontSize: number,
  emergency = false,
  debugTarget: HTMLElement | null = null,
): Break[] | null {
'''
patch("web/src/compositor.ts", choose_sig_old, choose_sig_new)

frontier_old = '''  if (bestKey < 0) return null;

  const reversed: Break[] = [];
'''
frontier_new = '''  if (bestKey < 0) {
    if (debugTarget && !emergency) {
      const reachable = states.map((stateMap, index) => {
        if (!stateMap.size) return null;
        const decodedStates = [...stateMap.keys()].map((stateKey) => decodeState(stateKey));
        return {
          index,
          nextToken: (words[index]?.node.textContent ?? "").replace(/\\u00ad/g, ""),
          stateCount: stateMap.size,
          lines: [...new Set(decodedStates.map((state) => state.line))],
          glyphScales: [...new Set(decodedStates.map((state) => Number(state.glyphScale.toFixed(3))))],
          fitness: [...new Set(decodedStates.map((state) => state.fitness))],
        };
      }).filter((entry) => entry !== null);
      debugTarget.dataset.folioStrictFailure = JSON.stringify({
        tokenCount: count,
        furthestIndex: reachable.length ? reachable[reachable.length - 1]!.index : 0,
        frontier: reachable.slice(-18),
      });
    }
    return null;
  }
  if (debugTarget && !emergency) delete debugTarget.dataset.folioStrictFailure;

  const reversed: Break[] = [];
'''
patch("web/src/compositor.ts", frontier_old, frontier_new)
patch(
    "web/src/compositor.ts",
    "let breaks = chooseBreaks(words, geometry, spaceWidth, hyphenWidth, fontSize, false);",
    "let breaks = chooseBreaks(words, geometry, spaceWidth, hyphenWidth, fontSize, false, paragraph);",
)

qa_frontier_type_old = '''        nextLineTokens: Array<{ text: string; spaceBefore: boolean; hyphenBefore: boolean; widthPx: number }>;
      }> = [];
'''
qa_frontier_type_new = '''        nextLineTokens: Array<{ text: string; spaceBefore: boolean; hyphenBefore: boolean; widthPx: number }>;
        strictFailure: unknown;
      }> = [];
'''
patch("scripts/v107-visual-qa.ts", qa_frontier_type_old, qa_frontier_type_new)

qa_frontier_push_old = '''              nextLineTokens: [...(lines[lineIndex + 1]?.querySelectorAll<HTMLElement>(".folio-word") ?? [])].map((word) => ({
                text: (word.textContent ?? "").replace(/\\u00ad/g, ""),
                spaceBefore: word.dataset.folioSpaceBefore === "true",
                hyphenBefore: word.dataset.folioHyphenBefore === "true",
                widthPx: word.getBoundingClientRect().width,
              })),
            });
'''
qa_frontier_push_new = '''              nextLineTokens: [...(lines[lineIndex + 1]?.querySelectorAll<HTMLElement>(".folio-word") ?? [])].map((word) => ({
                text: (word.textContent ?? "").replace(/\\u00ad/g, ""),
                spaceBefore: word.dataset.folioSpaceBefore === "true",
                hyphenBefore: word.dataset.folioHyphenBefore === "true",
                widthPx: word.getBoundingClientRect().width,
              })),
              strictFailure: paragraph.dataset.folioStrictFailure
                ? JSON.parse(paragraph.dataset.folioStrictFailure)
                : null,
            });
'''
patch("scripts/v107-visual-qa.ts", qa_frontier_push_old, qa_frontier_push_new)

print("Made glyph scale part of compositor DP state and added strict frontier diagnostics")

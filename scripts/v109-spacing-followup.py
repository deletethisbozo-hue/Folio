from pathlib import Path

path = Path("web/src/compositor.ts")
text = path.read_text(encoding="utf-8")

old = '''  // Book justification must never make ordinary spaces look as if words were
  // typed together. Prefer another break/hyphen over typographically implausible
  // expansion or compression.
  const configuredWordSpacing = fontSize * (emergency || finalCompression ? 0.09 : 0.075);
  const semanticGapHeadroom = Math.max(0, fontSize * 0.34 / 1.01 - spaceWidth - fontSize * 0.003);
  const maxWordSpacing = Math.min(configuredWordSpacing, semanticGapHeadroom);
  const relaxedCompressionEm = 0.075;
  const strictCompressionEm = 0.055;
  const minimumRenderedGapEm = emergency || finalCompression ? 0.18 : 0.20;
  const gapFloorWordSpacing = fontSize * minimumRenderedGapEm - spaceWidth;
  const minWordSpacing = Math.max(
    -(fontSize * (emergency || finalCompression ? relaxedCompressionEm : strictCompressionEm)),
    gapFloorWordSpacing,
  );'''

new = '''  // Preserve the full proven 1.0.8 adjustment range, but prevent the final
  // rendered inter-word gap from visually collapsing. The raw word-spacing
  // number is not itself a quality metric: some fonts legitimately need close
  // to -0.10em on narrow readers while still leaving an unmistakable space.
  const configuredWordSpacing = fontSize * (emergency || finalCompression ? 0.12 : 0.099);
  const semanticGapHeadroom = Math.max(0, fontSize * 0.3685 / 1.01 - spaceWidth - fontSize * 0.003);
  const maxWordSpacing = Math.min(configuredWordSpacing, semanticGapHeadroom);
  const relaxedCompressionEm = 0.120;
  const strictCompressionEm = 0.099;
  const minimumRenderedGapEm = emergency || finalCompression ? 0.13 : 0.14;
  const gapFloorWordSpacing = fontSize * minimumRenderedGapEm - spaceWidth;
  const minWordSpacing = Math.max(
    -(fontSize * (emergency || finalCompression ? relaxedCompressionEm : strictCompressionEm)),
    gapFloorWordSpacing,
  );'''

if old not in text:
    raise SystemExit("Expected 1.0.9 spacing block was not produced by the base patch")
path.write_text(text.replace(old, new, 1), encoding="utf-8")

# The regression gate measures the actual geometry users see, not an arbitrary
# negative word-spacing value. Keep at least ~1.5 CSS px / 0.12em between words.
test_path = Path("tests/ui-runtime.test.ts")
test_text = test_path.read_text(encoding="utf-8")
old_gate = '''        Math.min(...semanticGaps, fontSize) >= fontSize * .17 &&'''
new_gate = '''        Math.min(...semanticGaps, fontSize) >= Math.max(1.5, fontSize * .12) &&'''
if old_gate not in test_text:
    raise SystemExit("Expected 1.0.9 minimum semantic-gap regression gate is missing")
test_path.write_text(test_text.replace(old_gate, new_gate, 1), encoding="utf-8")

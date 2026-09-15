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

new = '''  // Preserve the normal expansion range needed for clean justified lines on
  // narrow readers, but put a hard floor under compression so ordinary spaces
  // can never visually collapse into run-together words.
  const configuredWordSpacing = fontSize * (emergency || finalCompression ? 0.12 : 0.099);
  const semanticGapHeadroom = Math.max(0, fontSize * 0.3685 / 1.01 - spaceWidth - fontSize * 0.003);
  const maxWordSpacing = Math.min(configuredWordSpacing, semanticGapHeadroom);
  const relaxedCompressionEm = 0.075;
  const strictCompressionEm = 0.055;
  const minimumRenderedGapEm = emergency || finalCompression ? 0.18 : 0.20;
  const gapFloorWordSpacing = fontSize * minimumRenderedGapEm - spaceWidth;
  const minWordSpacing = Math.max(
    -(fontSize * (emergency || finalCompression ? relaxedCompressionEm : strictCompressionEm)),
    gapFloorWordSpacing,
  );'''

if old not in text:
    raise SystemExit("Expected 1.0.9 spacing block was not produced by the base patch")
path.write_text(text.replace(old, new, 1), encoding="utf-8")

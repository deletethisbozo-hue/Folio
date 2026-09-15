from pathlib import Path

path = Path("web/src/compositor.ts")
text = path.read_text(encoding="utf-8")

old_loop = '''  for (let step = -10; step <= 10; step++) {
    const glyphScale = 1 + step * 0.001;'''
new_loop = '''  // Keep the 0.05% optical-scale grid that passed the 1.0.8 Windows
  // typesetting corpus. Coarser buckets can collapse distinct line-break
  // candidates and strand a one-word final line even when a clean path exists.
  for (let step = -20; step <= 20; step++) {
    const glyphScale = 1 + step * 0.0005;'''
if old_loop not in text:
    raise SystemExit("Expected 1.0.9 glyph-scale loop not found")
text = text.replace(old_loop, new_loop, 1)

old_constants = '''// 0.05% buckets created twice as many DP states for no visible benefit. A
// 0.1% grid keeps the same ±1% optical correction range while halving this
// dimension of the line-breaking state space.
const GLYPH_SCALE_STEP = 0.001;
const GLYPH_SCALE_COUNT = 21;'''
new_constants = '''// The 0.05% state grid is intentionally retained. Windows book-layout QA
// showed that the coarser 0.1% grid can merge candidates whose small optical
// difference determines whether the paragraph ends with a stranded word.
const GLYPH_SCALE_STEP = 0.0005;
const GLYPH_SCALE_COUNT = 41;'''
if old_constants not in text:
    raise SystemExit("Expected 1.0.9 glyph-scale state constants not found")
text = text.replace(old_constants, new_constants, 1)

path.write_text(text, encoding="utf-8")

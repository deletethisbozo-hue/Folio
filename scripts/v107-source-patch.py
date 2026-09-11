from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "scripts/v107-visual-qa.ts"
value = path.read_text(encoding="utf-8")
old = "report.maxAdjacentGlyphScaleDelta > 0.025 || report.maxSemanticGapEm > 0.43 ||"
new = "report.maxAdjacentGlyphScaleDelta > 0.025 + 1e-9 || report.maxSemanticGapEm > 0.43 ||"
if new not in value:
    if old not in value:
        raise RuntimeError("expected glyph continuity QA threshold marker missing")
    path.write_text(value.replace(old, new, 1), encoding="utf-8")
print("Added numeric epsilon to exact 2.5% glyph-continuity bound")

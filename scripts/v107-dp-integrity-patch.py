from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCES = [ROOT / "web/src/compositor.ts", ROOT / "server/pipeline/compositor.ts"]

for path in SOURCES:
    value = path.read_text(encoding="utf-8")

    # Preserve the exact early paragraph hyphen count, where composition choices
    # are most sensitive, while retaining a bounded 4+ bucket for large inputs.
    # This is only 5 buckets total, versus the previous 4, so the 100k-word UI
    # path remains bounded instead of regressing to unbounded DP state growth.
    web_old = '''const HYPHEN_BUCKET_COUNT = 4;\n\nfunction hyphenCountBucket(hyphenCount: number): number {\n  if (hyphenCount <= 4) return 0;\n  if (hyphenCount === 5) return 1;\n  if (hyphenCount === 6) return 2;\n  return 3;\n}'''
    web_new = '''const HYPHEN_BUCKET_COUNT = 5;\n\nfunction hyphenCountBucket(hyphenCount: number): number {\n  return Math.min(4, hyphenCount);\n}'''
    server_old = '''const HYPHEN_BUCKET_COUNT = 4;\n    const hyphenCountBucket = (hyphenCount: number) =>\n      hyphenCount <= 4 ? 0 : hyphenCount === 5 ? 1 : hyphenCount === 6 ? 2 : 3;'''
    server_new = '''const HYPHEN_BUCKET_COUNT = 5;\n    const hyphenCountBucket = (hyphenCount: number) => Math.min(4, hyphenCount);'''
    if web_old in value:
        value = value.replace(web_old, web_new, 1)
    elif server_old in value:
        value = value.replace(server_old, server_new, 1)
    elif "const HYPHEN_BUCKET_COUNT = 5;" not in value:
        raise RuntimeError(f"hyphen bucket marker missing in {path}")

    # QA already requires <=2.5% adjacent glyph-scale delta. Encode that same
    # professional continuity rule in the fitter so the optimiser cannot choose
    # a sudden expanded-to-compressed colour shift and hope post-render QA likes it.
    continuity_marker = "Math.abs(glyphScale - previousGlyphScale) > 0.025"
    if continuity_marker not in value:
        pattern = re.compile(
            r"(?P<i>[ \t]*)if \(Math\.abs\(glyphScale - 1\) > maxGlyphScaleDelta \+ 0\.000001\) continue;\n"
            r"(?P=i)const scaledAdjustment = available / glyphScale - naturalWidth;"
        )
        match = pattern.search(value)
        if not match:
            raise RuntimeError(f"glyph continuity marker missing in {path}")
        i = match.group("i")
        replacement = (
            f"{i}if (Math.abs(glyphScale - 1) > maxGlyphScaleDelta + 0.000001) continue;\n"
            f"{i}if (Math.abs(glyphScale - previousGlyphScale) > 0.025) continue;\n"
            f"{i}const scaledAdjustment = available / glyphScale - naturalWidth;"
        )
        value = value[:match.start()] + replacement + value[match.end():]

    path.write_text(value, encoding="utf-8")
    print(f"installed bounded DP integrity rules in {path}")

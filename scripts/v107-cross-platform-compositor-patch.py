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

    if "const correctedScale = Math.max(0.98, Math.min(1.02, currentScale * measure / rendered));" not in value:
        raise RuntimeError(f"cross-platform line calibration missing in {relative}")

    path.write_text(value, encoding="utf-8")
    print(f"applied cross-platform composition calibration in {relative}")

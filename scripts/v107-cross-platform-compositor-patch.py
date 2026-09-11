from pathlib import Path

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

    old_last = '''        const shortLastPenalty = last
          ? (wordsOnLine === 1 ? 180 : fill < 0.28 ? 80 * Math.pow((0.28 - fill) / 0.28, 2) : 0)
          : 0;'''
    new_last = '''        // A stranded final word is a real book-composition defect, especially
        // when the preceding line was itself hyphenated. Preserve feasible
        // alternatives instead of buying an ugly paragraph ending for a
        // slightly cheaper local line fit.
        const shortLastPenalty = last
          ? wordsOnLine === 1
            ? 1800 + (previous.hyphenated ? 1200 : 0) + 600 * Math.pow(1 - fill, 2)
            : fill < 0.28 ? 220 * Math.pow((0.28 - fill) / 0.28, 2) : 0
          : 0;'''
    if old_last in value:
        value = value.replace(old_last, new_last, 1)
    elif new_last not in value:
        raise RuntimeError(f"final-line widow penalty block not found in {relative}")

    if "const correctedScale = Math.max(0.98, Math.min(1.02, currentScale * measure / rendered));" not in value:
        raise RuntimeError(f"cross-platform line calibration missing in {relative}")

    path.write_text(value, encoding="utf-8")
    print(f"applied cross-platform composition calibration in {relative}")

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

for relative in ["web/src/compositor.ts", "server/pipeline/compositor.ts"]:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")

    # Isolated discretionary breaks remain available, but they must beat a
    # meaningful typographic cost rather than win merely because they shave a
    # little spacing badness. Seven hyphenated lines in fifteen justified lines
    # is visibly too dense even when every individual break is linguistically
    # legal, so prefer bounded microspacing before cutting another word.
    old_web = "const hyphenPenalty = hyphenBreak\n          ? 240 + previousHyphenStreak * 950\n          : 0;"
    new_web = "const hyphenPenalty = hyphenBreak\n          ? 400 + previousHyphenStreak * 950\n          : 0;"
    old_server = "const hyphenPenalty = hyphenBreak ? 240 + previousHyphenStreak * 950 : 0;"
    new_server = "const hyphenPenalty = hyphenBreak ? 400 + previousHyphenStreak * 950 : 0;"

    if old_web in value:
        value = value.replace(old_web, new_web, 1)
    elif old_server in value:
        value = value.replace(old_server, new_server, 1)
    elif "400 + previousHyphenStreak * 950" not in value:
        raise RuntimeError(f"current hyphen penalty block not found in {relative}")

    # The real-width cross-platform calibration must already be present from the
    # preceding patch. Refuse to silently alter just the penalty on an older file.
    if "const correctedScale = Math.max(0.98, Math.min(1.02, currentScale * measure / rendered));" not in value:
        raise RuntimeError(f"cross-platform line calibration missing in {relative}")

    path.write_text(value, encoding="utf-8")
    print(f"raised base discretionary hyphen cost in {relative}")

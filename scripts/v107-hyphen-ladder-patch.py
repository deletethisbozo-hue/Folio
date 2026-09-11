from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(path: Path) -> None:
    value = path.read_text(encoding="utf-8")

    old_guard = '''const hyphenBreak = !last && next!.hyphenBefore;\n        const natural = wordWidth + gaps * spaceWidth + (hyphenBreak ? hyphenWidth : 0);'''
    new_guard = '''const hyphenBreak = !last && next!.hyphenBefore;\n        // Professional prose never uses three consecutive discretionary\n        // hyphens when a justified/relaxed alternative exists. The final\n        // rescue pass may still recover pathological narrow measures.\n        if (hyphenBreak && previousHyphenStreak >= 2 && !allowNaturalRescue) continue;\n        const natural = wordWidth + gaps * spaceWidth + (hyphenBreak ? hyphenWidth : 0);'''
    if new_guard not in value:
        if old_guard not in value:
            raise RuntimeError(f"hyphen guard marker missing in {path}")
        value = value.replace(old_guard, new_guard, 1)

    old_penalty = '''const hyphenPenalty = hyphenBreak\n          ? 240 + previousHyphenStreak * 950 + previousHyphenCount * 180\n          : 0;'''
    new_penalty = '''const cumulativeHyphenPenalty = previousHyphenCount < 2\n          ? previousHyphenCount * 180\n          : 1400 * Math.pow(previousHyphenCount - 1, 2);\n        const hyphenPenalty = hyphenBreak\n          ? 240 + previousHyphenStreak * 950 + cumulativeHyphenPenalty\n          : 0;'''
    if new_penalty not in value:
        if old_penalty not in value:
            # Export currently keeps the same expression on one line.
            old_server = '''const hyphenPenalty = hyphenBreak ? 240 + previousHyphenStreak * 950 + previousHyphenCount * 180 : 0;'''
            new_server = '''const cumulativeHyphenPenalty = previousHyphenCount < 2\n              ? previousHyphenCount * 180\n              : 1400 * Math.pow(previousHyphenCount - 1, 2);\n            const hyphenPenalty = hyphenBreak ? 240 + previousHyphenStreak * 950 + cumulativeHyphenPenalty : 0;'''
            if old_server not in value:
                raise RuntimeError(f"cumulative hyphen penalty marker missing in {path}")
            value = value.replace(old_server, new_server, 1)
        else:
            value = value.replace(old_penalty, new_penalty, 1)

    old_relaxed = '''const relaxedPenalty = relaxedFit ? 420 : 0;'''
    new_relaxed = '''const relaxedPenalty = relaxedFit\n          ? Math.max(220, 420 - previousHyphenCount * 100)\n          : 0;'''
    if new_relaxed not in value:
        if old_relaxed not in value:
            raise RuntimeError(f"relaxed penalty marker missing in {path}")
        value = value.replace(old_relaxed, new_relaxed, 1)

    path.write_text(value, encoding="utf-8")
    print(f"installed professional hyphen ladder in {path}")


patch(ROOT / "web/src/compositor.ts")
patch(ROOT / "server/pipeline/compositor.ts")

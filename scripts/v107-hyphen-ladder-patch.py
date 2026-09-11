from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def patch(path: Path) -> None:
    value = path.read_text(encoding="utf-8")

    # Professional pass: never accept a third consecutive discretionary hyphen.
    # Rescue remains allowed for genuinely pathological narrow measures.
    guard_comment = "Professional prose never uses three consecutive discretionary"
    if guard_comment not in value:
        pattern = re.compile(
            r"(?P<i>[ \t]*)const hyphenBreak = !last && next!\.hyphenBefore;\n"
            r"(?P=i)const natural = wordWidth \+ gaps \* spaceWidth \+ \(hyphenBreak \? hyphenWidth : 0\);"
        )
        match = pattern.search(value)
        if not match:
            raise RuntimeError(f"hyphen guard marker missing in {path}")
        i = match.group("i")
        replacement = (
            f"{i}const hyphenBreak = !last && next!.hyphenBefore;\n"
            f"{i}// Professional prose never uses three consecutive discretionary\n"
            f"{i}// hyphens when a justified/relaxed alternative exists. The final\n"
            f"{i}// rescue pass may still recover pathological narrow measures.\n"
            f"{i}if (hyphenBreak && previousHyphenStreak >= 2 && !allowNaturalRescue) continue;\n"
            f"{i}const natural = wordWidth + gaps * spaceWidth + (hyphenBreak ? hyphenWidth : 0);"
        )
        value = value[:match.start()] + replacement + value[match.end():]

    # Make paragraph-wide hyphen density progressively expensive after the first
    # couple of discretionary breaks instead of treating the seventh almost like
    # the second. This preserves natural low-hyphen routes in bounded DP buckets.
    if "const cumulativeHyphenPenalty" not in value:
        pattern = re.compile(
            r"(?P<i>[ \t]*)const hyphenPenalty = hyphenBreak\s*\?\s*240 \+ previousHyphenStreak \* 950 \+ previousHyphenCount \* 180\s*:\s*0;"
        )
        match = pattern.search(value)
        if not match:
            raise RuntimeError(f"cumulative hyphen penalty marker missing in {path}")
        i = match.group("i")
        replacement = (
            f"{i}const cumulativeHyphenPenalty = previousHyphenCount < 2\n"
            f"{i}  ? previousHyphenCount * 180\n"
            f"{i}  : 1400 * Math.pow(previousHyphenCount - 1, 2);\n"
            f"{i}const hyphenPenalty = hyphenBreak\n"
            f"{i}  ? 240 + previousHyphenStreak * 950 + cumulativeHyphenPenalty\n"
            f"{i}  : 0;"
        )
        value = value[:match.start()] + replacement + value[match.end():]

    # Once a paragraph has already paid for several hyphens, controlled relaxed
    # spacing is the preferable professional escape hatch. Its hard limits are
    # unchanged; only the optimiser's choice among already-legal candidates moves.
    if "Math.max(220, 420 - previousHyphenCount * 100)" not in value:
        pattern = re.compile(r"(?P<i>[ \t]*)const relaxedPenalty = relaxedFit \? 420 : 0;")
        match = pattern.search(value)
        if not match:
            raise RuntimeError(f"relaxed penalty marker missing in {path}")
        i = match.group("i")
        replacement = (
            f"{i}const relaxedPenalty = relaxedFit\n"
            f"{i}  ? Math.max(220, 420 - previousHyphenCount * 100)\n"
            f"{i}  : 0;"
        )
        value = value[:match.start()] + replacement + value[match.end():]

    path.write_text(value, encoding="utf-8")
    print(f"installed professional hyphen ladder in {path}")


patch(ROOT / "web/src/compositor.ts")
patch(ROOT / "server/pipeline/compositor.ts")

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def patch(path: Path) -> None:
    value = path.read_text(encoding="utf-8")

    if "finalCompressed: boolean;" not in value:
        value, count = re.subn(
            r"(?P<i>^[ \t]*)relaxed: boolean;\n",
            lambda m: f"{m.group('i')}relaxed: boolean;\n{m.group('i')}finalCompressed: boolean;\n",
            value,
            count=1,
            flags=re.M,
        )
        if count != 1:
            raise RuntimeError(f"Break metadata marker missing in {path}")

    # Preview uses a named function and export uses an arrow function. The
    # argument line is identical, so patch only that line.
    if "finalCompression = false" not in value:
        value, count = re.subn(
            r"(?P<i>^[ \t]*)emergency = false,\n",
            lambda m: f"{m.group('i')}emergency = false,\n{m.group('i')}finalCompression = false,\n",
            value,
            count=1,
            flags=re.M,
        )
        if count != 1:
            raise RuntimeError(f"fitLine signature marker missing in {path}")

    if "? -Math.min(spaceWidth * 0.34, fontSize * 0.065)" not in value:
        pattern = re.compile(
            r"(?P<i>^[ \t]*)const minWordSpacing = -Math\.min\(spaceWidth \* 0\.22, fontSize \* 0\.055\);\n"
            r"(?P=i)const maxTracking = fontSize \* 0\.0055;\n"
            r"(?P=i)const minTracking = -fontSize \* 0\.0045;",
            re.M,
        )
        match = pattern.search(value)
        if not match:
            raise RuntimeError(f"fitLine compression limits marker missing in {path}")
        i = match.group("i")
        replacement = (
            f"{i}const minWordSpacing = finalCompression\n"
            f"{i}  ? -Math.min(spaceWidth * 0.34, fontSize * 0.065)\n"
            f"{i}  : -Math.min(spaceWidth * 0.22, fontSize * 0.055);\n"
            f"{i}const maxTracking = fontSize * 0.0055;\n"
            f"{i}const minTracking = -fontSize * (finalCompression ? 0.0055 : 0.0045);"
        )
        value = value[:match.start()] + replacement + value[match.end():]

    # Move semantic word count ahead of fit selection so final-line fitting can
    # reject real widows before considering compression.
    tracking_pattern = re.compile(r"(?P<i>^[ \t]*)const trackingOps = Math\.max\(0, characters \+ gaps - 1\);", re.M)
    tracking = tracking_pattern.search(value)
    if not tracking:
        raise RuntimeError(f"trackingOps marker missing in {path}")
    tracking_end = tracking.end()
    nearby = value[tracking_end:tracking_end + 260]
    if "const semanticWordsOnLine = 1 + words" not in nearby:
        i = tracking.group("i")
        insertion = (
            f"\n{i}const semanticWordsOnLine = 1 + words\n"
            f"{i}  .slice(start + 1, end + 1)\n"
            f"{i}  .filter((word) => word.spaceBefore).length;"
        )
        value = value[:tracking_end] + insertion + value[tracking_end:]

    semantic_pattern = re.compile(
        r"(?P<i>^[ \t]*)const semanticWordsOnLine = 1 \+ words\n"
        r"(?P=i)  \.slice\(start \+ 1, end \+ 1\)\n"
        r"(?P=i)  \.filter\(\(word\) => word\.spaceBefore\)\.length;\n",
        re.M,
    )
    matches = list(semantic_pattern.finditer(value))
    if len(matches) > 1:
        later = matches[1]
        value = value[:later.start()] + value[later.end():]
    elif len(matches) != 1:
        raise RuntimeError(f"semantic word count not normalized in {path}: {len(matches)}")

    if "const finalCompressionFit = last" not in value:
        pattern = re.compile(
            r"(?P<i>^[ \t]*)const strictFit = !last\n"
            r"(?P=i)  \? fitLine\(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, previous\.glyphScale, false\)\n"
            r"(?P=i)  : null;",
            re.M,
        )
        match = pattern.search(value)
        if not match:
            raise RuntimeError(f"strictFit marker missing in {path}")
        i = match.group("i")
        replacement = (
            f"{i}const finalCompressionFit = last\n"
            f"{i}  && semanticWordsOnLine >= 2\n"
            f"{i}  && adjustment < -0.75\n"
            f"{i}  && natural <= available * 1.05\n"
            f"{i}  ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, previous.glyphScale, false, true)\n"
            f"{i}  : null;\n"
            f"{i}const strictFit = !last\n"
            f"{i}  ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, previous.glyphScale, false)\n"
            f"{i}  : finalCompressionFit;"
        )
        value = value[:match.start()] + replacement + value[match.end():]

    if "finalCompressed: false," not in value:
        value, count = re.subn(
            r"(?P<i>^[ \t]*)relaxed: false,\n(?P=i)fitness: initialFitness,",
            lambda m: f"{m.group('i')}relaxed: false,\n{m.group('i')}finalCompressed: false,\n{m.group('i')}fitness: initialFitness,",
            value,
            count=1,
            flags=re.M,
        )
        if count != 1:
            raise RuntimeError(f"initial finalCompressed marker missing in {path}")

    if "const finalCompressionPenalty" not in value:
        value, count = re.subn(
            r"(?P<i>^[ \t]*)const relaxedPenalty = relaxedFit \? 420 : 0;",
            lambda m: (
                f"{m.group('i')}const relaxedPenalty = relaxedFit ? 420 : 0;\n"
                f"{m.group('i')}const finalCompressed = last && Boolean(finalCompressionFit);\n"
                f"{m.group('i')}const finalCompressionPenalty = finalCompressed ? 160 : 0;"
            ),
            value,
            count=1,
            flags=re.M,
        )
        if count != 1:
            raise RuntimeError(f"relaxedPenalty marker missing in {path}")

    if "+ finalCompressionPenalty" not in value:
        value, count = re.subn(
            r"(?P<i>^[ \t]*)\+ relaxedPenalty\n",
            lambda m: f"{m.group('i')}+ relaxedPenalty\n{m.group('i')}+ finalCompressionPenalty\n",
            value,
            count=1,
            flags=re.M,
        )
        if count == 0:
            old = "+ rescuePenalty + relaxedPenalty + hyphenPenalty"
            new = "+ rescuePenalty + relaxedPenalty + finalCompressionPenalty + hyphenPenalty"
            if old not in value:
                raise RuntimeError(f"cost marker missing in {path}")
            value = value.replace(old, new, 1)

    if re.search(r"^[ \t]*finalCompressed,$", value, re.M) is None:
        value, count = re.subn(
            r"(?P<i>^[ \t]*)relaxed: relaxedFit,\n(?P=i)fitness: currentFitness,",
            lambda m: f"{m.group('i')}relaxed: relaxedFit,\n{m.group('i')}finalCompressed,\n{m.group('i')}fitness: currentFitness,",
            value,
            count=1,
            flags=re.M,
        )
        if count != 1:
            raise RuntimeError(f"stored finalCompressed marker missing in {path}")

    if "finalCompressed: state.finalCompressed" not in value:
        value, count = re.subn(
            r"(?P<i>^[ \t]*)relaxed: state\.relaxed,\n",
            lambda m: f"{m.group('i')}relaxed: state.relaxed,\n{m.group('i')}finalCompressed: state.finalCompressed,\n",
            value,
            count=1,
            flags=re.M,
        )
        if count != 1:
            raise RuntimeError(f"Break reconstruction marker missing in {path}")

    if "folio-line-final-compressed" not in value:
        old = 'line.className = `folio-composed-line ${lineBreak.justified ? "folio-line-justified" : "folio-line-natural"}${lineBreak.relaxed ? " folio-line-relaxed" : ""}${lineBreak.emergency ? " folio-line-emergency" : ""}`;'
        new = 'line.className = `folio-composed-line ${lineBreak.justified ? "folio-line-justified" : "folio-line-natural"}${lineBreak.relaxed ? " folio-line-relaxed" : ""}${lineBreak.emergency ? " folio-line-emergency" : ""}${lineBreak.finalCompressed ? " folio-line-final-compressed" : ""}`;'
        if old not in value:
            raise RuntimeError(f"line class marker missing in {path}")
        value = value.replace(old, new, 1)

    if "if (lineBreak.justified || lineBreak.finalCompressed) {" not in value:
        if "if (lineBreak.justified) {" not in value:
            raise RuntimeError(f"render microtype marker missing in {path}")
        value = value.replace("if (lineBreak.justified) {", "if (lineBreak.justified || lineBreak.finalCompressed) {", 1)

    calibrated = 'if (!line.classList.contains("folio-line-justified") && !line.classList.contains("folio-line-final-compressed")) continue;'
    if calibrated not in value:
        old = 'if (!line.classList.contains("folio-line-justified")) continue;'
        if old not in value:
            raise RuntimeError(f"calibration marker missing in {path}")
        value = value.replace(old, calibrated, 1)

    path.write_text(value, encoding="utf-8")
    print(f"installed bounded final-line compression in {path}")


patch(ROOT / "web/src/compositor.ts")
patch(ROOT / "server/pipeline/compositor.ts")

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def patch(path: Path) -> None:
    value = path.read_text(encoding="utf-8")

    # Break/state metadata: a compressed final line remains semantically natural,
    # but its bounded microtype must be rendered and calibrated.
    if "finalCompressed: boolean;" not in value:
        value, count = re.subn(
            r"(?P<i>[ \t]*)relaxed: boolean;\n",
            lambda m: f"{m.group('i')}relaxed: boolean;\n{m.group('i')}finalCompressed: boolean;\n",
            value,
            count=1,
        )
        if count != 1:
            raise RuntimeError(f"Break metadata marker missing in {path}")

    # Let fitLine use a slightly deeper, still QA-bounded compression envelope
    # only for an overfull final line. Normal justified lines stay unchanged.
    if "finalCompression = false" not in value:
        value, count = re.subn(
            r"(?P<i>[ \t]*)emergency = false,\n(?P=i)\): LineFit \| null \{",
            lambda m: f"{m.group('i')}emergency = false,\n{m.group('i')}finalCompression = false,\n{m.group('i')}): LineFit | null {{",
            value,
            count=1,
        )
        if count != 1:
            raise RuntimeError(f"fitLine signature marker missing in {path}")

    old_limits = '''const minWordSpacing = -Math.min(spaceWidth * 0.22, fontSize * 0.055);\n  const maxTracking = fontSize * 0.0055;\n  const minTracking = -fontSize * 0.0045;'''
    new_limits = '''const minWordSpacing = finalCompression\n    ? -Math.min(spaceWidth * 0.34, fontSize * 0.065)\n    : -Math.min(spaceWidth * 0.22, fontSize * 0.055);\n  const maxTracking = fontSize * 0.0055;\n  const minTracking = -fontSize * (finalCompression ? 0.0055 : 0.0045);'''
    if new_limits not in value:
        if old_limits not in value:
            raise RuntimeError(f"fitLine compression limits marker missing in {path}")
        value = value.replace(old_limits, new_limits, 1)

    # Compute semantic word count before fitting, so a final-line compression
    # candidate can be considered without ever reclassifying a one-word widow.
    old_tracking = '''const trackingOps = Math.max(0, characters + gaps - 1);\n'''
    semantic = '''const trackingOps = Math.max(0, characters + gaps - 1);\n        const semanticWordsOnLine = 1 + words\n          .slice(start + 1, end + 1)\n          .filter((word) => word.spaceBefore).length;\n'''
    if semantic not in value:
        if old_tracking not in value:
            raise RuntimeError(f"trackingOps marker missing in {path}")
        value = value.replace(old_tracking, semantic, 1)

    # Remove the later duplicate semantic count left by the widow-control patch.
    duplicate = '''const semanticWordsOnLine = 1 + words\n          .slice(start + 1, end + 1)\n          .filter((word) => word.spaceBefore).length;\n        // Hyphenation splits one visible word into several compositor tokens.'''
    replacement = '''// Hyphenation splits one visible word into several compositor tokens.'''
    # After inserting the early declaration this sequence should occur exactly once later.
    if value.count("const semanticWordsOnLine = 1 + words") > 1:
        if duplicate not in value:
            raise RuntimeError(f"duplicate semantic count marker missing in {path}")
        value = value.replace(duplicate, replacement, 1)

    old_fit = '''const strictFit = !last\n          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, previous.glyphScale, false)\n          : null;'''
    new_fit = '''const finalCompressionFit = last\n          && semanticWordsOnLine >= 2\n          && adjustment < -0.75\n          && natural <= available * 1.05\n          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, previous.glyphScale, false, true)\n          : null;\n        const strictFit = !last\n          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, previous.glyphScale, false)\n          : finalCompressionFit;'''
    if new_fit not in value:
        if old_fit not in value:
            # Server indentation differs but core text is identical after stripping indentation.
            pattern = re.compile(
                r"(?P<i>[ \t]*)const strictFit = !last\n"
                r"(?P=i)  \? fitLine\(adjustment, gaps, trackingOps, spaceWidth, fontSize, natural, previous\.glyphScale, false\)\n"
                r"(?P=i)  : null;"
            )
            match = pattern.search(value)
            if not match:
                raise RuntimeError(f"strictFit marker missing in {path}")
            i = match.group("i")
            replacement_fit = (
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
            value = value[:match.start()] + replacement_fit + value[match.end():]
        else:
            value = value.replace(old_fit, new_fit, 1)

    # Initial state.
    if "finalCompressed: false," not in value:
        value, count = re.subn(
            r"(?P<i>[ \t]*)relaxed: false,\n(?P=i)fitness: initialFitness,",
            lambda m: f"{m.group('i')}relaxed: false,\n{m.group('i')}finalCompressed: false,\n{m.group('i')}fitness: initialFitness,",
            value,
            count=1,
        )
        if count != 1:
            raise RuntimeError(f"initial finalCompressed marker missing in {path}")

    # Cost and state storage.
    if "const finalCompressionPenalty" not in value:
        value, count = re.subn(
            r"(?P<i>[ \t]*)const relaxedPenalty = relaxedFit \? 420 : 0;",
            lambda m: f"{m.group('i')}const relaxedPenalty = relaxedFit ? 420 : 0;\n{m.group('i')}const finalCompressed = last && Boolean(finalCompressionFit);\n{m.group('i')}const finalCompressionPenalty = finalCompressed ? 160 : 0;",
            value,
            count=1,
        )
        if count != 1:
            raise RuntimeError(f"relaxedPenalty marker missing in {path}")

    if "+ finalCompressionPenalty" not in value:
        value, count = re.subn(
            r"(?P<i>[ \t]*)\+ relaxedPenalty\n",
            lambda m: f"{m.group('i')}+ relaxedPenalty\n{m.group('i')}+ finalCompressionPenalty\n",
            value,
            count=1,
        )
        if count == 0:
            # Server keeps the cost expression on one line.
            old = "+ rescuePenalty + relaxedPenalty + hyphenPenalty"
            new = "+ rescuePenalty + relaxedPenalty + finalCompressionPenalty + hyphenPenalty"
            if old not in value:
                raise RuntimeError(f"cost marker missing in {path}")
            value = value.replace(old, new, 1)

    if "finalCompressed," not in value:
        value, count = re.subn(
            r"(?P<i>[ \t]*)relaxed: relaxedFit,\n(?P=i)fitness: currentFitness,",
            lambda m: f"{m.group('i')}relaxed: relaxedFit,\n{m.group('i')}finalCompressed,\n{m.group('i')}fitness: currentFitness,",
            value,
            count=1,
        )
        if count != 1:
            raise RuntimeError(f"stored finalCompressed marker missing in {path}")

    # Reconstruction of the Break object.
    if "finalCompressed: state.finalCompressed" not in value:
        value, count = re.subn(
            r"(?P<i>[ \t]*)relaxed: state\.relaxed,\n",
            lambda m: f"{m.group('i')}relaxed: state.relaxed,\n{m.group('i')}finalCompressed: state.finalCompressed,\n",
            value,
            count=1,
        )
        if count != 1:
            raise RuntimeError(f"Break reconstruction marker missing in {path}")

    # Render as a natural final line, but apply its bounded microtype.
    if "folio-line-final-compressed" not in value:
        value, count = re.subn(
            r'(?P<i>[ \t]*)line\.className = `folio-composed-line \$\{lineBreak\.justified \? "folio-line-justified" : "folio-line-natural"\}\$\{lineBreak\.relaxed \? " folio-line-relaxed" : ""\}\$\{lineBreak\.emergency \? " folio-line-emergency" : ""\}`;',
            lambda m: f'{m.group("i")}line.className = `folio-composed-line ${{lineBreak.justified ? "folio-line-justified" : "folio-line-natural"}}${{lineBreak.relaxed ? " folio-line-relaxed" : ""}}${{lineBreak.emergency ? " folio-line-emergency" : ""}}${{lineBreak.finalCompressed ? " folio-line-final-compressed" : ""}}`;',
            value,
            count=1,
        )
        if count != 1:
            raise RuntimeError(f"line class marker missing in {path}")

    value = value.replace(
        "if (lineBreak.justified) {",
        "if (lineBreak.justified || lineBreak.finalCompressed) {",
        1,
    )
    value = value.replace(
        'if (!line.classList.contains("folio-line-justified")) continue;',
        'if (!line.classList.contains("folio-line-justified") && !line.classList.contains("folio-line-final-compressed")) continue;',
        1,
    )

    path.write_text(value, encoding="utf-8")
    print(f"installed bounded final-line compression in {path}")


patch(ROOT / "web/src/compositor.ts")
patch(ROOT / "server/pipeline/compositor.ts")

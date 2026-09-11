from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE_FILES = [ROOT / "web/src/compositor.ts", ROOT / "server/pipeline/compositor.ts"]
QA_FILE = ROOT / "scripts/v107-visual-qa.ts"


def patch_source(path: Path) -> None:
    value = path.read_text(encoding="utf-8")

    # Track measured right-edge optical protrusion on tokens and chosen breaks.
    if "rightProtrusion: number;" not in value:
        value, count = re.subn(
            r"(?P<i>[ \t]*)characters: number;\n",
            lambda m: f"{m.group('i')}characters: number;\n{m.group('i')}rightProtrusion: number;\n",
            value,
            count=1,
        )
        if count != 1:
            raise RuntimeError(f"Word type marker missing in {path}")
        value, count = re.subn(
            r"(?P<i>[ \t]*)finalCompressed: boolean;\n",
            lambda m: f"{m.group('i')}finalCompressed: boolean;\n{m.group('i')}rightProtrusion: number;\n",
            value,
            count=1,
        )
        if count != 1:
            raise RuntimeError(f"Break type marker missing in {path}")

    # Measure the actual terminal punctuation in the active font. This is
    # intentionally font-agnostic: Palatino, Baskerville, Georgia etc. each get
    # their own optical value rather than a platform-specific magic number.
    if "const terminalPunctuation = cleanText.match" not in value:
        pattern = re.compile(
            r"(?P<i>[ \t]*)const canBreakBefore = hyphenBefore \|\| \(spaceBefore && !\(atomicId && atomicId === previousAtomic\)\);\n"
            r"(?P=i)const word: Word = \{"
        )
        match = pattern.search(value)
        if not match:
            raise RuntimeError(f"token measurement marker missing in {path}")
        i = match.group("i")
        replacement = (
            f"{i}const canBreakBefore = hyphenBefore || (spaceBefore && !(atomicId && atomicId === previousAtomic));\n"
            f"{i}const rawText = node.textContent ?? \"\";\n"
            f"{i}const cleanText = rawText.replace(/\\u00ad/g, \"\");\n"
            f"{i}let rightProtrusion = 0;\n"
            f"{i}const terminalPunctuation = cleanText.match(/[.,;:!?…»”’)\\]]$/)?.[0];\n"
            f"{i}const textNode = node.firstChild;\n"
            f"{i}if (terminalPunctuation && textNode?.nodeType === Node.TEXT_NODE && textNode.textContent) {{\n"
            f"{i}  const terminalFactor = terminalPunctuation === \".\" || terminalPunctuation === \",\"\n"
            f"{i}    ? 0.72\n"
            f"{i}    : terminalPunctuation === \"…\" ? 0.50\n"
            f"{i}      : /[»”’)\\]]/.test(terminalPunctuation) ? 0.55 : 0.40;\n"
            f"{i}  const terminalRange = document.createRange();\n"
            f"{i}  const rawLength = textNode.textContent.length;\n"
            f"{i}  terminalRange.setStart(textNode, Math.max(0, rawLength - 1));\n"
            f"{i}  terminalRange.setEnd(textNode, rawLength);\n"
            f"{i}  rightProtrusion = Math.min(4.5, terminalRange.getBoundingClientRect().width * terminalFactor);\n"
            f"{i}}}\n"
            f"{i}const word: Word = {{"
        )
        value = value[:match.start()] + replacement + value[match.end():]

        # Reuse cleanText and persist protrusion on the token.
        value, count = re.subn(
            r"(?P<i>[ \t]*)characters: \(node\.textContent \?\? \"\"\)\.replace\(/\\u00ad/g, \"\"\)\.length,\n",
            lambda m: f"{m.group('i')}characters: cleanText.length,\n{m.group('i')}rightProtrusion,\n",
            value,
            count=1,
        )
        if count != 1:
            raise RuntimeError(f"Word object marker missing in {path}")

    # Initial state has no optical margin yet.
    if "rightProtrusion: 0," not in value:
        value, count = re.subn(
            r"(?P<i>[ \t]*)finalCompressed: false,\n(?P=i)fitness: initialFitness,",
            lambda m: f"{m.group('i')}finalCompressed: false,\n{m.group('i')}rightProtrusion: 0,\n{m.group('i')}fitness: initialFitness,",
            value,
            count=1,
        )
        if count != 1:
            raise RuntimeError(f"initial protrusion marker missing in {path}")

    # Use the optical edge for fit mathematics. A discretionary hyphen never
    # receives punctuation protrusion because the visible line ends in '-'.
    if "const opticalAvailable = available + rightProtrusion;" not in value:
        pattern = re.compile(
            r"(?P<i>[ \t]*)const natural = wordWidth \+ gaps \* spaceWidth \+ \(hyphenBreak \? hyphenWidth : 0\);\n\n?"
            r"(?P=i)const adjustment = available - natural;"
        )
        match = pattern.search(value)
        if not match:
            raise RuntimeError(f"fit geometry marker missing in {path}")
        i = match.group("i")
        replacement = (
            f"{i}const natural = wordWidth + gaps * spaceWidth + (hyphenBreak ? hyphenWidth : 0);\n"
            f"{i}const rightProtrusion = hyphenBreak ? 0 : words[end].rightProtrusion;\n"
            f"{i}const opticalAvailable = available + rightProtrusion;\n\n"
            f"{i}const adjustment = opticalAvailable - natural;"
        )
        value = value[:match.start()] + replacement + value[match.end():]

    # The hard fit envelope itself is the safety gate. The old 5% pre-filter can
    # reject a legal final line before measured punctuation protrusion is applied.
    value = value.replace("          && natural <= available * 1.05\n", "", 1)
    value = value.replace("              && natural <= available * 1.05\n", "", 1)

    # Preserve the selected optical margin in DP state and reconstructed break.
    if "rightProtrusion: lineFit ? rightProtrusion : 0," not in value:
        value, count = re.subn(
            r"(?P<i>[ \t]*)finalCompressed,\n(?P=i)fitness: currentFitness,",
            lambda m: f"{m.group('i')}finalCompressed,\n{m.group('i')}rightProtrusion: lineFit ? rightProtrusion : 0,\n{m.group('i')}fitness: currentFitness,",
            value,
            count=1,
        )
        if count != 1:
            raise RuntimeError(f"stored protrusion marker missing in {path}")

    if "rightProtrusion: state.rightProtrusion," not in value:
        value, count = re.subn(
            r"(?P<i>[ \t]*)finalCompressed: state\.finalCompressed,\n",
            lambda m: f"{m.group('i')}finalCompressed: state.finalCompressed,\n{m.group('i')}rightProtrusion: state.rightProtrusion,\n",
            value,
            count=1,
        )
        if count != 1:
            raise RuntimeError(f"reconstructed protrusion marker missing in {path}")

    # Render/calibrate against the optical measure, leaving punctuation to hang
    # visibly outside the physical text block rather than squeezing it back in.
    if "line.dataset.folioRightProtrusion" not in value:
        value, count = re.subn(
            r"(?P<i>[ \t]*)line\.style\.width = `\$\{lineBreak\.available\}px`;\n",
            lambda m: f"{m.group('i')}line.style.width = `${{lineBreak.available}}px`;\n{m.group('i')}if (lineBreak.rightProtrusion > 0) line.dataset.folioRightProtrusion = String(lineBreak.rightProtrusion);\n",
            value,
            count=1,
        )
        if count != 1:
            raise RuntimeError(f"render protrusion marker missing in {path}")

    if "const opticalMeasure = measure + protrusion;" not in value:
        pattern = re.compile(
            r"(?P<i>[ \t]*)const measure = line\.getBoundingClientRect\(\)\.width;\n"
            r"(?P=i)const currentScale = Number\(line\.dataset\.folioGlyphScale \?\? 1\);\n"
            r"(?P=i)if \(rendered <= 0 \|\| measure <= 0 \|\| !Number\.isFinite\(currentScale\)\) continue;\n"
            r"(?P=i)const correctedScale = Math\.max\(0\.98, Math\.min\(1\.02, currentScale \* measure / rendered\)\);"
        )
        match = pattern.search(value)
        if not match:
            raise RuntimeError(f"calibration marker missing in {path}")
        i = match.group("i")
        replacement = (
            f"{i}const measure = line.getBoundingClientRect().width;\n"
            f"{i}const protrusion = Number(line.dataset.folioRightProtrusion ?? 0);\n"
            f"{i}const opticalMeasure = measure + protrusion;\n"
            f"{i}const currentScale = Number(line.dataset.folioGlyphScale ?? 1);\n"
            f"{i}if (rendered <= 0 || opticalMeasure <= 0 || !Number.isFinite(currentScale)) continue;\n"
            f"{i}const correctedScale = Math.max(0.98, Math.min(1.02, currentScale * opticalMeasure / rendered));"
        )
        value = value[:match.start()] + replacement + value[match.end():]

    path.write_text(value, encoding="utf-8")
    print(f"installed optical margin composition in {path}")


def patch_qa(path: Path) -> None:
    value = path.read_text(encoding="utf-8")

    if "let maxRightProtrusionPx = 0;" not in value:
        value = value.replace(
            "      let maxRightErrorPx = 0;\n",
            "      let maxRightErrorPx = 0;\n      let maxRightProtrusionPx = 0;\n",
            1,
        )

    if "rightProtrusionPx: number;" not in value:
        value = value.replace(
            "        glyphScale: number;\n        gaps: number;\n",
            "        glyphScale: number;\n        rightProtrusionPx: number;\n        gaps: number;\n",
            1,
        )

    if "const rightProtrusionPx = Number(line.dataset.folioRightProtrusion ?? 0);" not in value:
        value = value.replace(
            "          const availableWidthPx = line.getBoundingClientRect().width;\n",
            "          const availableWidthPx = line.getBoundingClientRect().width;\n          const rightProtrusionPx = Number(line.dataset.folioRightProtrusion ?? 0);\n          maxRightProtrusionPx = Math.max(maxRightProtrusionPx, rightProtrusionPx);\n",
            1,
        )
        value = value.replace(
            "            glyphScale: Number(line.dataset.folioGlyphScale ?? 1),\n            gaps:",
            "            glyphScale: Number(line.dataset.folioGlyphScale ?? 1),\n            rightProtrusionPx,\n            gaps:",
            1,
        )

    old_error = "            maxRightErrorPx = Math.max(maxRightErrorPx, Math.abs(line.getBoundingClientRect().right - range.getBoundingClientRect().right));"
    new_error = "            maxRightErrorPx = Math.max(maxRightErrorPx, Math.abs(line.getBoundingClientRect().right + rightProtrusionPx - range.getBoundingClientRect().right));"
    if new_error not in value:
        if old_error not in value:
            raise RuntimeError("QA right-edge marker missing")
        value = value.replace(old_error, new_error, 1)

    if "        maxRightProtrusionPx," not in value:
        value = value.replace(
            "        maxRightErrorPx,\n",
            "        maxRightErrorPx,\n        maxRightProtrusionPx,\n",
            1,
        )

    # Protrusion is not a tolerance increase: assert a hard optical-margin cap.
    if "report.maxRightProtrusionPx > 4.51" not in value:
        value = value.replace(
            "      report.paragraphCount < 2 || report.justifiedLines < 6 || report.maxRightErrorPx > 1.75 ||\n",
            "      report.paragraphCount < 2 || report.justifiedLines < 6 || report.maxRightErrorPx > 1.75 || report.maxRightProtrusionPx > 4.51 ||\n",
            1,
        )

    path.write_text(value, encoding="utf-8")
    print(f"installed optical margin QA in {path}")


for source in SOURCE_FILES:
    patch_source(source)
patch_qa(QA_FILE)

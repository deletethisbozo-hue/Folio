from pathlib import Path
import re

path = Path("web/src/compositor.ts")
text = path.read_text(encoding="utf-8")

replacements = [
    (
        "  emergency = false,\n  debugTarget: HTMLElement | null = null,\n  allowNaturalRescue = emergency,\n",
        "  emergency = false,\n  allowNaturalRescue = emergency,\n",
    ),
    (
        "  const debugCandidates: Array<Record<string, unknown>> = [];\n",
        "",
    ),
    (
        "        const glyphScaleDelta = lineFit ? Math.abs(lineFit.glyphScale - previous.glyphScale) : 0;\n        const glyphContinuityPenalty = line === 0 || !lineFit ? 0 : 45 * Math.pow(glyphScaleDelta / 0.01, 2);\n",
        "",
    ),
    (
        "  let breaks = chooseBreaks(words, geometry, spaceWidth, hyphenWidth, fontSize, true, paragraph, false);\n  if (!breaks) breaks = chooseBreaks(words, geometry, spaceWidth, hyphenWidth, fontSize, true, null, true);\n",
        "  let breaks = chooseBreaks(words, geometry, spaceWidth, hyphenWidth, fontSize, true, false);\n  if (!breaks) breaks = chooseBreaks(words, geometry, spaceWidth, hyphenWidth, fontSize, true, true);\n",
    ),
]
for old, new in replacements:
    if old not in text:
        raise SystemExit(f"missing cleanup marker: {old[:80]!r}")
    text = text.replace(old, new, 1)

text, count = re.subn(
    r'        if \(debugTarget\) \{.*?\n        \}\n        if \(natural > available \+ 0\.75',
    '        if (natural > available + 0.75',
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"expected one debugCandidates block, got {count}")

start = text.find("  if (bestKey < 0) {\n    if (debugTarget && !allowNaturalRescue) {")
end_marker = "  if (debugTarget && !emergency) delete debugTarget.dataset.folioStrictFailure;\n"
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("missing failure-debug block")
end += len(end_marker)
text = text[:start] + "  if (bestKey < 0) return null;\n" + text[end:]

start = text.find("  if (debugTarget && emergency && !allowNaturalRescue) {")
end_marker = "  return result;\n"
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("missing composition-trace block")
text = text[:start] + text[end:]

for forbidden in [
    "debugTarget",
    "debugCandidates",
    "folioStrictFailure",
    "folioCompositionTrace",
    "glyphContinuityPenalty",
]:
    if forbidden in text:
        raise SystemExit(f"cleanup incomplete: {forbidden} remains")

path.write_text(text, encoding="utf-8")

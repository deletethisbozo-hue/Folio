from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web/src/compositor.ts"
QA = ROOT / "scripts/v107-visual-qa.ts"

web = WEB.read_text(encoding="utf-8")
old_return = "  return reversed.reverse();\n"
if "folioCompositionTrace" not in web:
    if old_return not in web:
        raise RuntimeError("successful return marker missing in web compositor")
    new_return = '''  const result = reversed.reverse();
  if (debugTarget && emergency && !allowNaturalRescue) {
    const nearWholeWord = debugCandidates.filter((candidate) => {
      const item = candidate as { hyphenBreak?: boolean; fill?: number; selectedFit?: unknown };
      const nearMeasure = typeof item.fill === "number" && item.fill >= 0.78 && item.fill <= 1.12;
      return item.hyphenBreak === false && (nearMeasure || Boolean(item.selectedFit));
    }).slice(-180);
    debugTarget.dataset.folioCompositionTrace = JSON.stringify({
      result: result.map((lineBreak, line) => ({
        line,
        end: lineBreak.end,
        hyphenated: lineBreak.hyphenated,
        wordSpacing: lineBreak.wordSpacing,
        tracking: lineBreak.tracking,
        glyphScale: lineBreak.glyphScale,
        relaxed: lineBreak.relaxed,
        finalCompressed: lineBreak.finalCompressed,
      })),
      candidates: nearWholeWord,
    });
  }
  return result;
'''
    web = web.replace(old_return, new_return, 1)
    WEB.write_text(web, encoding="utf-8")
    print("installed successful breakpoint trace in web compositor")
else:
    print("successful breakpoint trace already installed")

qa = QA.read_text(encoding="utf-8")
if "const compositionTraces:" not in qa:
    marker = "      const compositionFailures: Array<{ paragraphIndex: number; failure: unknown }> = [];\n"
    if marker not in qa:
        raise RuntimeError("compositionFailures declaration marker missing")
    qa = qa.replace(marker, marker + "      const compositionTraces: Array<{ paragraphIndex: number; trace: unknown }> = [];\n", 1)

    loop_marker = "      for (const paragraph of paragraphs) {\n        const rawFailure = paragraph.dataset.folioStrictFailure;\n"
    if loop_marker not in qa:
        raise RuntimeError("paragraph loop marker missing")
    loop_replacement = '''      for (const paragraph of paragraphs) {
        const rawTrace = paragraph.dataset.folioCompositionTrace;
        if (rawTrace) {
          let trace: unknown = rawTrace;
          try { trace = JSON.parse(rawTrace); } catch { /* keep raw diagnostic */ }
          compositionTraces.push({ paragraphIndex: paragraphs.indexOf(paragraph), trace });
        }
        const rawFailure = paragraph.dataset.folioStrictFailure;
'''
    qa = qa.replace(loop_marker, loop_replacement, 1)

    return_marker = "        compositionFailures,\n        lineDetails,\n"
    if return_marker not in qa:
        raise RuntimeError("report return marker missing")
    qa = qa.replace(return_marker, "        compositionFailures,\n        compositionTraces,\n        lineDetails,\n", 1)
    QA.write_text(qa, encoding="utf-8")
    print("installed composition trace reporting in QA")
else:
    print("composition trace reporting already installed")

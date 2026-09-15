from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / "web/src/compositor.ts"
text = path.read_text(encoding="utf-8")

anchor = """  const count = words.length;\n  lastBreakFailure = null;\n"""
replacement = """  const count = words.length;\n  // Find the first fragment of the final semantic word once. A discretionary\n  // hyphen inside that word must never create a final line containing only its\n  // continuation (for example `de-` / `cyzji.`). Do this once, outside the DP\n  // loops, so the widow guard is O(1) per candidate and does not trade quality\n  // for render speed.\n  let finalSemanticWordStart = Math.max(0, count - 1);\n  while (finalSemanticWordStart > 0 && !words[finalSemanticWordStart].spaceBefore) {\n    finalSemanticWordStart--;\n  }\n  lastBreakFailure = null;\n"""
if text.count(anchor) != 1:
    raise SystemExit(f"chooseBreaks anchor count: {text.count(anchor)}")
text = text.replace(anchor, replacement)

anchor2 = """        const hyphenBreak = !last && next!.hyphenBefore;\n        const hyphenStreakOverflow = hyphenBreak && previousHyphenStreak >= 2;\n"""
replacement2 = """        const hyphenBreak = !last && next!.hyphenBefore;\n        const strandsFinalHyphenFragment = hyphenBreak && end >= finalSemanticWordStart;\n        // A line may hyphenate earlier words, but never split the paragraph's\n        // final semantic word. That path can only end with an orphaned word\n        // fragment on the last line, so remove it from the graph entirely and\n        // make the optimiser rebalance an earlier line instead.\n        if (strandsFinalHyphenFragment) continue;\n        const hyphenStreakOverflow = hyphenBreak && previousHyphenStreak >= 2;\n"""
if text.count(anchor2) != 1:
    raise SystemExit(f"hyphen break anchor count: {text.count(anchor2)}")
text = text.replace(anchor2, replacement2)
path.write_text(text, encoding="utf-8")
print("Applied terminal-hyphen widow guard.")

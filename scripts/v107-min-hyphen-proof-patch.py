from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web/src/compositor.ts"

text = WEB.read_text(encoding="utf-8")
old = '''    debugTarget.dataset.folioCompositionTrace = JSON.stringify({
      result: result.map((lineBreak, line) => ({
'''
new = '''    const reachableHyphenCounts = [...new Set(
      [...states[count].values()].map((state) => state.hyphenCount),
    )].sort((a, b) => a - b);
    debugTarget.dataset.folioCompositionTrace = JSON.stringify({
      minimumReachableHyphens: reachableHyphenCounts[0] ?? null,
      reachableHyphenCounts,
      result: result.map((lineBreak, line) => ({
'''
if "minimumReachableHyphens" in text:
    print("minimum-hyphen proof already installed")
elif old not in text:
    raise RuntimeError("composition trace marker missing")
else:
    text = text.replace(old, new, 1)
    WEB.write_text(text, encoding="utf-8")
    print("installed minimum-hyphen proof")

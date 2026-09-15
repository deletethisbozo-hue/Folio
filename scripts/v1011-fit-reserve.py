from pathlib import Path

root = Path(__file__).resolve().parents[1]
compositor = root / "server/pipeline/compositor.ts"
text = compositor.read_text(encoding="utf-8")

old = '        const physicalGapFloor = Math.max(1.5, fontSize * 0.12);\n'
new = '''        // Reserve a small amount above the release floor while choosing the\n        // break. Chromium/Paged.js can shave roughly 0.4 px from the modeled\n        // inline-space geometry on Georgia at 11pt even though the final gate\n        // still measures the real 0.12em floor. This reserve changes the chosen\n        // break instead of masking the problem with post-render distortion.\n        const physicalGapFloor = Math.max(1.5, fontSize * 0.12) + Math.min(0.45, fontSize * 0.03);\n'''

if text.count(old) != 1:
    raise SystemExit(f"physical gap reserve anchor: expected 1, found {text.count(old)}")

compositor.write_text(text.replace(old, new), encoding="utf-8")
print("Applied conservative pre-break semantic-gap reserve.")

from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / "web/src/compositor.ts"
text = path.read_text(encoding="utf-8")
old = "  const minimumRenderedGapEm = emergency || finalCompression ? 0.13 : 0.14;"
new = "  const minimumRenderedGapEm = emergency || finalCompression ? 0.12 : 0.13;"
if text.count(old) != 1:
    raise SystemExit(f"expected exactly one rendered-gap floor, found {text.count(old)}")
path.write_text(text.replace(old, new), encoding="utf-8")
print("Adjusted rendered inter-word gap floor to 0.13em strict / 0.12em rescue.")

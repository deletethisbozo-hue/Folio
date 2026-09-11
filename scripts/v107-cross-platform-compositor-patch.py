from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

for relative in ["web/src/compositor.ts", "server/pipeline/compositor.ts"]:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")

    old_spacing = "const minWordSpacing = -Math.min(spaceWidth * 0.18, fontSize * 0.045);"
    new_spacing = "const minWordSpacing = -Math.min(spaceWidth * 0.22, fontSize * 0.055);"
    if old_spacing in value:
        value = value.replace(old_spacing, new_spacing, 1)
    elif new_spacing not in value:
        raise RuntimeError(f"minimum word-spacing envelope not found in {relative}")

    for old in [
        "? 900 + previousHyphenStreak * 950",
        "? 400 + previousHyphenStreak * 950",
    ]:
        if old in value:
            value = value.replace(old, "? 240 + previousHyphenStreak * 950", 1)
            break
    if "240 + previousHyphenStreak * 950" not in value:
        raise RuntimeError(f"moderate hyphen penalty not found in {relative}")

    if "const correctedScale = Math.max(0.98, Math.min(1.02, currentScale * measure / rendered));" not in value:
        raise RuntimeError(f"cross-platform line calibration missing in {relative}")

    path.write_text(value, encoding="utf-8")
    print(f"expanded QA-safe compression envelope in {relative}")

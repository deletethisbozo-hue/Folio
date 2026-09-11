from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

for relative in ["web/src/compositor.ts", "server/pipeline/compositor.ts"]:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")

    # Use a moderate base penalty for a discretionary break while keeping a
    # strong surcharge for consecutive hyphenated lines. Larger base values did
    # not change the Windows breakpoint set and can make a geometrically worse
    # fallback win when the hyphenation dictionary is deliberately conservative.
    replacements = [
        ("? 900 + previousHyphenStreak * 950", "? 240 + previousHyphenStreak * 950"),
        ("? 400 + previousHyphenStreak * 950", "? 240 + previousHyphenStreak * 950"),
    ]
    changed = False
    for old, new in replacements:
        if old in value:
            value = value.replace(old, new, 1)
            changed = True
            break

    if not changed and "240 + previousHyphenStreak * 950" not in value:
        raise RuntimeError(f"current hyphen penalty block not found in {relative}")

    # The real-width cross-platform calibration must already be present.
    if "const correctedScale = Math.max(0.98, Math.min(1.02, currentScale * measure / rendered));" not in value:
        raise RuntimeError(f"cross-platform line calibration missing in {relative}")

    path.write_text(value, encoding="utf-8")
    print(f"restored moderate discretionary hyphen cost in {relative}")

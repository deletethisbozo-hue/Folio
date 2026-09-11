from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

for relative in ["web/src/compositor.ts", "server/pipeline/compositor.ts"]:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")

    # Prefer clean whole-word breaks unless the spacing cost would become genuinely
    # worse. The compositor badness function is cubic, so a 400-point break cost was
    # still too small to compete with otherwise QA-safe spacing on Windows. Keep a
    # separate strong surcharge for repeated hyphenated lines.
    replacements = [
        ("? 400 + previousHyphenStreak * 950", "? 900 + previousHyphenStreak * 950"),
        ("? 240 + previousHyphenStreak * 950", "? 900 + previousHyphenStreak * 950"),
        ("? 240 + previousHyphenStreak * 560", "? 900 + previousHyphenStreak * 950"),
    ]
    changed = False
    for old, new in replacements:
        if old in value:
            value = value.replace(old, new, 1)
            changed = True
            break

    if not changed and "900 + previousHyphenStreak * 950" not in value:
        raise RuntimeError(f"current hyphen penalty block not found in {relative}")

    # The real-width cross-platform calibration must already be present from the
    # preceding patch. Refuse to silently alter just the penalty on an older file.
    if "const correctedScale = Math.max(0.98, Math.min(1.02, currentScale * measure / rendered));" not in value:
        raise RuntimeError(f"cross-platform line calibration missing in {relative}")

    path.write_text(value, encoding="utf-8")
    print(f"raised base discretionary hyphen cost in {relative}")

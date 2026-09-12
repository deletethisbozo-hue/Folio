from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} occurrence(s) of {old!r}, found {count}")
    file.write_text(text.replace(old, new), encoding="utf-8")


for compositor in ("web/src/compositor.ts", "server/pipeline/compositor.ts"):
    replace_exact(
        compositor,
        'const relaxedCompressionEm = normalizedLanguage.startsWith("en") ? 0.07 : 0.0595;',
        'const relaxedCompressionEm = 0.120;',
    )
    replace_exact(
        compositor,
        '? -Math.min(spaceWidth * 0.28, fontSize * relaxedCompressionEm)',
        '? -(fontSize * relaxedCompressionEm)',
    )

print("Made the bounded relaxed compositor envelope symmetric at +/-0.120em in preview and export.")

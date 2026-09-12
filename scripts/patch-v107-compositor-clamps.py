from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} occurrence(s) of {old!r}, found {count}")
    file.write_text(text.replace(old, new), encoding="utf-8")


for compositor in ("web/src/compositor.ts", "server/pipeline/compositor.ts"):
    # The release gate is expressed in em. A second cap based on the font's
    # measured space glyph rejects lines that are still inside that published
    # envelope, especially with EB Garamond. Keep the same 0.120em rescue limit
    # and let it be the binding constraint.
    replace_exact(
        compositor,
        "? Math.min(spaceWidth * 0.55, fontSize * 0.120)",
        "? fontSize * 0.120",
    )

    # Likewise, strict Polish compression is already bounded at 0.085em, below
    # the 0.101em release ceiling. Do not tighten it again according to the raw
    # width of one rendered space glyph.
    replace_exact(
        compositor,
        ": -Math.min(spaceWidth * 0.40, fontSize * strictCompressionEm);",
        ": -(fontSize * strictCompressionEm);",
    )

print("Removed redundant font-space clamps while preserving all em-based QA limits.")

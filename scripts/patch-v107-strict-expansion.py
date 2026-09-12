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
        ": Math.min(spaceWidth * 0.50, fontSize * 0.10);",
        ": fontSize * 0.10;",
    )

print("Removed redundant strict positive space-width clamp in preview and export compositors.")

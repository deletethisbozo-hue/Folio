from pathlib import Path

FILES = [Path("web/src/compositor.ts"), Path("server/pipeline/compositor.ts")]
OLD = "? Math.min(spaceWidth * 0.46, fontSize * 0.113)"
NEW = "? Math.min(spaceWidth * 0.50, fontSize * 0.120)"

changed = 0
for path in FILES:
    text = path.read_text(encoding="utf-8")
    if NEW in text:
        continue
    count = text.count(OLD)
    if count != 1:
        raise SystemExit(f"{path}: expected one relaxed-spacing target, found {count}")
    path.write_text(text.replace(OLD, NEW, 1), encoding="utf-8")
    changed += 1

print(f"updated {changed} compositor file(s)")

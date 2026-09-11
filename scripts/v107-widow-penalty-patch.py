from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = [ROOT / "web/src/compositor.ts", ROOT / "server/pipeline/compositor.ts"]

OLD = "        if (last && semanticWordsOnLine === 1 && !allowNaturalRescue) continue;\n"
NEW = "        // A one-word final line is undesirable, but not composition failure.\n        // Let the existing high widow penalty compare it against alternative paths\n        // instead of forcing the entire paragraph into the emergency rescue pass.\n"

for path in FILES:
    text = path.read_text(encoding="utf-8")
    if OLD not in text:
        if "A one-word final line is undesirable, but not composition failure." in text:
            print(f"widow penalty already active in {path}")
            continue
        raise RuntimeError(f"widow hard-reject marker missing in {path}")
    text = text.replace(OLD, NEW, 1)
    path.write_text(text, encoding="utf-8")
    print(f"activated scored widow handling in {path}")

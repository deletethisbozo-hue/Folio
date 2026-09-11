from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = [ROOT / "web/src/hyphenation.ts", ROOT / "server/pipeline/hyphenation.ts"]
OLD = '  pl: { minimumWord: 4, left: 2, right: 2 },\n'
NEW = '  pl: { minimumWord: 7, left: 3, right: 3 },\n'

for path in FILES:
    text = path.read_text(encoding="utf-8")
    if NEW in text:
        print(f"Polish 7/3/3 limits already active in {path}")
        continue
    if OLD not in text:
        raise RuntimeError(f"Polish hyphenation limit marker missing in {path}")
    text = text.replace(OLD, NEW, 1)
    path.write_text(text, encoding="utf-8")
    print(f"aligned Polish hyphenation limits with base.css in {path}")

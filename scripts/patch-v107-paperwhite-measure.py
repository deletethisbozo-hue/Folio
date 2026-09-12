from pathlib import Path

path = Path("web/src/preview-runtime.ts")
text = path.read_text(encoding="utf-8")
old = '"kindle-paperwhite": { width: 412, height: 549, baseFont: 17.5, padding: [34, 31, 46, 31], wordsPerPage: 270 },'
new = '"kindle-paperwhite": { width: 412, height: 549, baseFont: 17.5, padding: [34, 21, 46, 21], wordsPerPage: 270 },'
count = text.count(old)
if count != 1:
    raise SystemExit(f"expected exactly one Paperwhite profile, found {count}")
path.write_text(text.replace(old, new), encoding="utf-8")
print("Expanded Paperwhite prose measure by reducing side insets from 31 to 21 logical px.")

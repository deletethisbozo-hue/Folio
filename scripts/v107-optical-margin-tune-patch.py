from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = [ROOT / "web/src/compositor.ts", ROOT / "server/pipeline/compositor.ts"]
QA = ROOT / "scripts/v107-visual-qa.ts"

for path in SOURCES:
    value = path.read_text(encoding="utf-8")
    old = '    ? 0.72\n'
    new = '    ? 0.75\n'
    if old in value:
        value = value.replace(old, new, 1)
    elif new not in value:
        # Server indentation differs, so fall back to the semantic fragment.
        old_any = '? 0.72\n'
        if old_any not in value:
            raise RuntimeError(f"period/comma protrusion factor marker missing in {path}")
        value = value.replace(old_any, '? 0.75\n', 1)
    path.write_text(value, encoding="utf-8")
    print(f"set period/comma protrusion to 75% in {path}")

value = QA.read_text(encoding="utf-8")
old = '''          if (justified) {\n            justifiedLines++;\n            const range = doc.createRange();'''
new = '''          if (justified) justifiedLines++;\n          const microtyped = justified || line.classList.contains("folio-line-final-compressed");\n          if (microtyped) {\n            const range = doc.createRange();'''
if old in value:
    value = value.replace(old, new, 1)
elif 'const microtyped = justified || line.classList.contains("folio-line-final-compressed");' not in value:
    raise RuntimeError("QA microtyped-line marker missing")
QA.write_text(value, encoding="utf-8")
print("included final-compressed lines in microtype QA")

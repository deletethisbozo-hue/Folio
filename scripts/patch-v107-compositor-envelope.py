from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} occurrence(s) of {old!r}, found {count}")
    file.write_text(text.replace(old, new), encoding="utf-8")


# The compositor already has stricter em-based release limits than these
# secondary space-width clamps. Let the explicit em envelope be the binding
# constraint so legal lines are not discarded before QA evaluates them.
for compositor in ("web/src/compositor.ts", "server/pipeline/compositor.ts"):
    replace_exact(
        compositor,
        "? Math.min(spaceWidth * 0.50, fontSize * 0.120)",
        "? Math.min(spaceWidth * 0.55, fontSize * 0.120)",
    )
    replace_exact(
        compositor,
        ": -Math.min(spaceWidth * 0.34, fontSize * strictCompressionEm);",
        ": -Math.min(spaceWidth * 0.40, fontSize * strictCompressionEm);",
    )

# 37px was a diagnostic geometry probe and made composition worse. Restore the
# best measured Paperwhite calibration before testing the corrected solver.
replace_exact(
    "web/src/preview-runtime.ts",
    '"kindle-paperwhite": { width: 412, height: 549, baseFont: 17.5, padding: [34, 37, 46, 37], wordsPerPage: 270 },',
    '"kindle-paperwhite": { width: 412, height: 549, baseFont: 17.5, padding: [34, 31, 46, 31], wordsPerPage: 270 },',
)

print("Patched web/export compositor spacing envelope and restored Paperwhite 31px inset.")

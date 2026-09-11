from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    value = target.read_text(encoding="utf-8")
    if new in value and old not in value:
        print(f"{path}: already patched")
        return
    if old not in value:
        raise RuntimeError(f"expected marker missing in {path}: {old!r}")
    target.write_text(value.replace(old, new, 1), encoding="utf-8")


for path in ("web/src/compositor.ts", "server/pipeline/compositor.ts"):
    replace_once(
        path,
        'Math.min(spaceWidth * 0.56, fontSize * 0.13)',
        'Math.min(spaceWidth * 0.56, fontSize * 0.14)',
    )

replace_once(
    "scripts/v107-visual-qa.ts",
    'report.maxWordSpacingEm > 0.131 || report.maxStrictWordSpacingEm > 0.116 || report.maxRelaxedWordSpacingEm > 0.131 ||',
    'report.maxWordSpacingEm > 0.141 || report.maxStrictWordSpacingEm > 0.116 || report.maxRelaxedWordSpacingEm > 0.141 ||',
)

print("Aligned relaxed word-spacing em cap with the existing 56% space-width envelope")

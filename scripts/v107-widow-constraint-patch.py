from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(path: Path, server: bool) -> None:
    value = path.read_text(encoding="utf-8")
    indent = "            " if server else "        "
    old = f'''{indent}const wordsOnLine = end - start + 1;\n{indent}const fill = Math.min(1, natural / Math.max(1, available));'''
    new = f'''{indent}const wordsOnLine = end - start + 1;\n{indent}// A one-token final line is a true widow, and a discretionary\n{indent}// hyphen continuation there is worse still. Do not accept it in the\n{indent}// professional justified pass. The final rescue pass may still use it\n{indent}// when the paragraph has no feasible alternative at all.\n{indent}if (last && wordsOnLine === 1 && !allowNaturalRescue) continue;\n{indent}const fill = Math.min(1, natural / Math.max(1, available));'''
    if new in value:
        print(f"{path.name}: already patched")
        return
    if old not in value:
        raise RuntimeError(f"wordsOnLine marker not found in {path}")
    path.write_text(value.replace(old, new, 1), encoding="utf-8")
    print(f"patched {path}")


patch(ROOT / "web/src/compositor.ts", False)
patch(ROOT / "server/pipeline/compositor.ts", True)

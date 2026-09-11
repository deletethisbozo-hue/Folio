from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(path: Path) -> None:
    value = path.read_text(encoding="utf-8")
    old = '''const wordsOnLine = end - start + 1;\n        // A one-token final line is a true widow, and a discretionary\n        // hyphen continuation there is worse still. Do not accept it in the\n        // professional justified pass. The final rescue pass may still use it\n        // when the paragraph has no feasible alternative at all.\n        if (last && wordsOnLine === 1 && !allowNaturalRescue) continue;'''
    new = '''const semanticWordsOnLine = 1 + words\n          .slice(start + 1, end + 1)\n          .filter((word) => word.spaceBefore).length;\n        // Hyphenation splits one visible word into several compositor tokens.\n        // Widow control must count semantic words, not discretionary pieces,\n        // otherwise endings such as `de-` / `cyzji.` evade the rule entirely.\n        if (last && semanticWordsOnLine === 1 && !allowNaturalRescue) continue;'''

    # Server code has four extra spaces before the same block, but the inner text
    # is otherwise identical, so replacing the unindented core works for both.
    if new not in value:
        if old not in value:
            raise RuntimeError(f"semantic widow marker missing in {path}")
        value = value.replace(old, new, 1)

    old_penalty = '''? wordsOnLine === 1\n            ? 1800'''
    new_penalty = '''? semanticWordsOnLine === 1\n            ? 1800'''
    if new_penalty not in value:
        if old_penalty not in value:
            raise RuntimeError(f"widow penalty marker missing in {path}")
        value = value.replace(old_penalty, new_penalty, 1)

    path.write_text(value, encoding="utf-8")
    print(f"patched semantic widow detection in {path}")


patch(ROOT / "web/src/compositor.ts")
patch(ROOT / "server/pipeline/compositor.ts")

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def patch(path: Path) -> None:
    value = path.read_text(encoding="utf-8")

    if "const semanticWordsOnLine = 1 + words" not in value:
        pattern = re.compile(
            r"(?P<i>[ \t]*)const wordsOnLine = end - start \+ 1;\n"
            r"(?P=i)// A one-token final line is a true widow, and a discretionary\n"
            r"(?P=i)// hyphen continuation there is worse still\. Do not accept it in the\n"
            r"(?P=i)// professional justified pass\. The final rescue pass may still use it\n"
            r"(?P=i)// when the paragraph has no feasible alternative at all\.\n"
            r"(?P=i)if \(last && wordsOnLine === 1 && !allowNaturalRescue\) continue;"
        )
        match = pattern.search(value)
        if not match:
            raise RuntimeError(f"semantic widow marker missing in {path}")
        i = match.group("i")
        replacement = (
            f"{i}const semanticWordsOnLine = 1 + words\n"
            f"{i}  .slice(start + 1, end + 1)\n"
            f"{i}  .filter((word) => word.spaceBefore).length;\n"
            f"{i}// Hyphenation splits one visible word into several compositor tokens.\n"
            f"{i}// Widow control must count semantic words, not discretionary pieces,\n"
            f"{i}// otherwise endings such as `de-` / `cyzji.` evade the rule entirely.\n"
            f"{i}if (last && semanticWordsOnLine === 1 && !allowNaturalRescue) continue;"
        )
        value = value[:match.start()] + replacement + value[match.end():]

    if "? semanticWordsOnLine === 1" not in value:
        value, count = re.subn(
            r"(const shortLastPenalty = last\n(?P<i>[ \t]*)  )\? wordsOnLine === 1",
            r"\1? semanticWordsOnLine === 1",
            value,
            count=1,
        )
        if count != 1:
            raise RuntimeError(f"widow penalty marker missing in {path}")

    if "wordsOnLine" in value:
        # No remaining composition decision should depend on token-piece count.
        remaining = [line for line in value.splitlines() if "wordsOnLine" in line]
        if remaining:
            raise RuntimeError(f"stale token widow count remains in {path}: {remaining}")

    path.write_text(value, encoding="utf-8")
    print(f"patched semantic widow detection in {path}")


patch(ROOT / "web/src/compositor.ts")
patch(ROOT / "server/pipeline/compositor.ts")

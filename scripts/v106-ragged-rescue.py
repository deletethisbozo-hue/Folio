from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(path: str, old: str, new: str, count: int = 1) -> None:
    target = ROOT / path
    value = target.read_text(encoding="utf-8")
    if value.count(old) < count:
        raise RuntimeError(f"expected rescue marker missing in {path}: {old[:160]!r}")
    target.write_text(value.replace(old, new, count), encoding="utf-8")


# In the second-pass breaker, a line that cannot possibly reach full measure
# inside even the bounded emergency limits is allowed to stay natural. This is
# deliberately preferable to giant inter-word holes. The huge penalty means a
# justified route always wins when one exists.
for path in ["web/src/compositor.ts", "server/pipeline/compositor.ts"]:
    patch(
        path,
        "        if (!last && !fit) continue;\n\n        const wordsOnLine = end - start + 1;\n        const fill = Math.min(1, natural / Math.max(1, available));",
        "        const rescueNatural = emergency && !last && !fit && natural <= available + 0.75;\n        if (!last && !fit && !rescueNatural) continue;\n\n        const wordsOnLine = end - start + 1;\n        const fill = Math.min(1, natural / Math.max(1, available));",
    )
    patch(
        path,
        "        const cost = previous.cost\n          + (fit?.badness ?? 0)\n          + hyphenPenalty",
        "        const rescuePenalty = rescueNatural ? 900 + 700 * Math.pow(1 - fill, 2) : 0;\n        const cost = previous.cost\n          + (fit?.badness ?? 0)\n          + rescuePenalty\n          + hyphenPenalty",
    )
    patch(
        path,
        "            justified: !last,\n            wordSpacing: fit?.wordSpacing ?? 0,",
        "            justified: !last && Boolean(fit),\n            wordSpacing: fit?.wordSpacing ?? 0,",
    )

print("Folio 1.0.6 safe natural-line rescue applied")

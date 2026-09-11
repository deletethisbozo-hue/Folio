from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(path: str, old: str, new: str) -> None:
    target = ROOT / path
    value = target.read_text(encoding="utf-8")
    if new in value:
        print(f"{path}: already patched")
        return
    if old not in value:
        raise RuntimeError(f"expected patch marker missing in {path}")
    target.write_text(value.replace(old, new, 1), encoding="utf-8")


# American English TeX patterns conventionally use 2/3 fragment minima.
# Folio's previous 3/3 + 7-letter floor discarded legal dictionary breaks
# and could force an otherwise avoidable emergency line.
patch(
    "web/src/hyphenation.ts",
    '''  // Keep English deliberately conservative for book prose.\n  en: { minimumWord: 7, left: 3, right: 3 },''',
    '''  // U.S. English TeX convention: lefthyphenmin=2, righthyphenmin=3.\n  en: { minimumWord: 5, left: 2, right: 3 },''',
)
patch(
    "web/src/hyphenation.ts",
    '''/** Keep only dictionary breakpoints that respect language-specific fragment\n * minima. Polish follows the maintained TeX 2/2 convention; English remains\n * intentionally stricter at 3/3 with a seven-letter word floor. */''',
    '''/** Keep only dictionary breakpoints that respect language-specific fragment\n * minima. Polish follows TeX 2/2; U.S. English follows the standard 2/3\n * convention used by the corresponding TeX hyphenation patterns. */''',
)
patch(
    "server/pipeline/hyphenation.ts",
    '''  en: { minimumWord: 7, left: 3, right: 3 },''',
    '''  en: { minimumWord: 5, left: 2, right: 3 },''',
)

# Turn the language rule into a regression test instead of relying on a vague
# "conservative" invariant that accidentally encoded the old 3/3 policy.
patch(
    "tests/typesetting-language.test.ts",
    '''function validThreeThree(value: string): boolean {\n  const plainLength = value.replace(/\\u00ad/g, "").length;\n  const points = breakpoints(value);\n  return points.length > 0 && points.every((point) => point >= 3 && plainLength - point >= 3);\n}\n''',
    '''function validMinima(value: string, left: number, right: number): boolean {\n  const plainLength = value.replace(/\\u00ad/g, "").length;\n  const points = breakpoints(value);\n  return points.length > 0 && points.every((point) => point >= left && plainLength - point >= right);\n}\n''',
)
patch(
    "tests/typesetting-language.test.ts",
    '''test("seven-to-nine-letter Polish words can provide conservative breakpoints", () => {\n  const candidates = ["czytanie", "pisanie", "rozdział", "książkami", "wydanie"];\n  const hyphenated = candidates.map((word) => conservativeHyphenation(pl, word));\n  assert.ok(hyphenated.some((word) => validThreeThree(word)), hyphenated.join(" | "));\n  assert.ok(hyphenated.every((word) => word === word.replace(/\\u00ad/g, "") || validThreeThree(word)));\n});\n\ntest("seven-to-nine-letter English words can provide conservative breakpoints", () => {\n  const candidates = ["reading", "writing", "chapter", "printer", "spacing"];\n  const hyphenated = candidates.map((word) => conservativeHyphenation(en, word));\n  assert.ok(hyphenated.some((word) => validThreeThree(word)), hyphenated.join(" | "));\n  assert.ok(hyphenated.every((word) => word === word.replace(/\\u00ad/g, "") || validThreeThree(word)));\n});''',
    '''test("Polish dictionary breakpoints respect the 2/2 TeX minima", () => {\n  const candidates = ["czytanie", "pisanie", "rozdział", "książkami", "wydanie"];\n  const hyphenated = candidates.map((word) => conservativeHyphenation(pl, word, 2, 2, 4));\n  assert.ok(hyphenated.some((word) => validMinima(word, 2, 2)), hyphenated.join(" | "));\n  assert.ok(hyphenated.every((word) => word === word.replace(/\\u00ad/g, "") || validMinima(word, 2, 2)));\n});\n\ntest("U.S. English dictionary breakpoints respect the standard 2/3 TeX minima", () => {\n  const candidates = ["ordinary", "contained", "reading", "writing", "chapter", "printer", "spacing"];\n  const hyphenated = candidates.map((word) => conservativeHyphenation(en, word, 2, 3, 5));\n  assert.ok(hyphenated.some((word) => validMinima(word, 2, 3)), hyphenated.join(" | "));\n  assert.ok(hyphenated.every((word) => word === word.replace(/\\u00ad/g, "") || validMinima(word, 2, 3)));\n  assert.ok(breakpoints(conservativeHyphenation(en, "ordinary", 2, 3, 5)).includes(2));\n});''',
)

print("Applied TeX-standard U.S. English 2/3 hyphenation minima and regression tests")

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
FILES = [ROOT / "web/src/compositor.ts", ROOT / "server/pipeline/compositor.ts"]

for path in FILES:
    text = path.read_text(encoding="utf-8")
    if "const shortHyphenFragmentPenalty" in text:
        print(f"hyphen fragment quality already installed in {path}")
        continue

    pattern = re.compile(
        r'(?P<i>[ \t]*)const hyphenPenalty = hyphenBreak\n'
        r'(?P=i)  \? 240 \+ previousHyphenStreak \* 950 \+ cumulativeHyphenPenalty\n'
        r'(?P=i)  : 0;'
    )
    match = pattern.search(text)
    if not match:
        raise RuntimeError(f"hyphen penalty marker missing in {path}")
    i = match.group("i")
    replacement = (
        f'{i}// Legal hyphenation points are not equally attractive. Very short visible\n'
        f'{i}// prefixes create a choppy book page, so prefer longer fragments without\n'
        f'{i}// banning language-valid 2/2 breaks when a narrow measure truly needs one.\n'
        f'{i}const shortHyphenFragmentPenalty = hyphenBreak\n'
        f'{i}  ? words[end].characters <= 2 ? 850 : words[end].characters === 3 ? 420 : 0\n'
        f'{i}  : 0;\n'
        f'{i}const hyphenPenalty = hyphenBreak\n'
        f'{i}  ? 240 + previousHyphenStreak * 950 + cumulativeHyphenPenalty + shortHyphenFragmentPenalty\n'
        f'{i}  : 0;'
    )
    text = text[:match.start()] + replacement + text[match.end():]
    path.write_text(text, encoding="utf-8")
    print(f"installed hyphen fragment quality in {path}")

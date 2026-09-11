from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = [ROOT / "web/src/compositor.ts", ROOT / "server/pipeline/compositor.ts"]

for path in SOURCES:
    value = path.read_text(encoding="utf-8")

    old_word = '''const minWordSpacing = finalCompression\n    ? -Math.min(spaceWidth * 0.34, fontSize * 0.065)\n    : -Math.min(spaceWidth * 0.22, fontSize * 0.055);'''
    new_word = '''const minWordSpacing = emergency || finalCompression\n    ? -Math.min(spaceWidth * 0.34, fontSize * 0.065)\n    : -Math.min(spaceWidth * 0.22, fontSize * 0.055);'''
    old_tracking = '''const minTracking = -fontSize * (finalCompression ? 0.0055 : 0.0045);'''
    new_tracking = '''const minTracking = -fontSize * (emergency || finalCompression ? 0.0055 : 0.0045);'''

    if old_word in value:
        value = value.replace(old_word, new_word, 1)
    elif new_word not in value:
        # Server has deeper indentation but identical semantic text after leading spaces.
        old_word_compact = 'const minWordSpacing = finalCompression\n        ? -Math.min(spaceWidth * 0.34, fontSize * 0.065)\n        : -Math.min(spaceWidth * 0.22, fontSize * 0.055);'
        new_word_compact = 'const minWordSpacing = emergency || finalCompression\n        ? -Math.min(spaceWidth * 0.34, fontSize * 0.065)\n        : -Math.min(spaceWidth * 0.22, fontSize * 0.055);'
        if old_word_compact not in value:
            raise RuntimeError(f"relaxed word-spacing marker missing in {path}")
        value = value.replace(old_word_compact, new_word_compact, 1)

    if old_tracking in value:
        value = value.replace(old_tracking, new_tracking, 1)
    elif new_tracking not in value:
        raise RuntimeError(f"relaxed tracking marker missing in {path}")

    path.write_text(value, encoding="utf-8")
    print(f"enabled symmetric relaxed compression in {path}")

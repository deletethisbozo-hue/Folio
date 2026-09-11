from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(path: str, old: str, new: str) -> None:
    target = ROOT / path
    value = target.read_text(encoding="utf-8")
    if new in value:
        print(f"{path}: already patched")
        return
    if old not in value:
        raise RuntimeError(f"expected marker missing in {path}: {old[:100]!r}")
    target.write_text(value.replace(old, new, 1), encoding="utf-8")


# Live preview: keep the existing `emergency` argument as the switch that
# enables the relaxed justified fit, but gate natural rescue independently.
patch(
    "web/src/compositor.ts",
    '''  emergency = false,
  debugTarget: HTMLElement | null = null,
): Break[] | null {
''',
    '''  emergency = false,
  debugTarget: HTMLElement | null = null,
  allowNaturalRescue = emergency,
): Break[] | null {
''',
)
patch(
    "web/src/compositor.ts",
    '''        const emergencyRescue = emergency && !last && !fit && natural <= available + 0.75;
''',
    '''        const emergencyRescue = allowNaturalRescue && !last && !fit && natural <= available + 0.75;
''',
)
patch(
    "web/src/compositor.ts",
    '''  let breaks = chooseBreaks(words, geometry, spaceWidth, hyphenWidth, fontSize, false, paragraph);
  if (!breaks) breaks = chooseBreaks(words, geometry, spaceWidth, hyphenWidth, fontSize, true);
''',
    '''  // Three deliberately separate passes. Natural rescue must never compete
  // on cost with an available justified solution.
  let breaks = chooseBreaks(words, geometry, spaceWidth, hyphenWidth, fontSize, false, paragraph, false);
  if (!breaks) breaks = chooseBreaks(words, geometry, spaceWidth, hyphenWidth, fontSize, true, null, false);
  if (!breaks) breaks = chooseBreaks(words, geometry, spaceWidth, hyphenWidth, fontSize, true, null, true);
''',
)

# Print/PDF compositor mirrors the exact same pass hierarchy.
patch(
    "server/pipeline/compositor.ts",
    '''      const runBreaker = (emergency: boolean): Break[] | null => {
''',
    '''      const runBreaker = (emergency: boolean, allowNaturalRescue = emergency): Break[] | null => {
''',
)
patch(
    "server/pipeline/compositor.ts",
    '''            const emergencyRescue = emergency && !last && !fit && natural <= available + 0.75;
''',
    '''            const emergencyRescue = allowNaturalRescue && !last && !fit && natural <= available + 0.75;
''',
)
patch(
    "server/pipeline/compositor.ts",
    '''      const breaks = runBreaker(false) ?? runBreaker(true);
''',
    '''      // Keep rescue out of the cost graph until both strict and relaxed
      // justified composition have failed completely.
      const breaks = runBreaker(false, false) ?? runBreaker(true, false) ?? runBreaker(true, true);
''',
)

print("Separated strict, relaxed justified, and natural rescue breaker passes")

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(path: str, old: str, new: str) -> None:
    target = ROOT / path
    value = target.read_text(encoding="utf-8")
    if new in value:
        print(f"{path}: already patched")
        return
    if old not in value:
        raise RuntimeError(f"expected marker missing in {path}: {old[:140]!r}")
    target.write_text(value.replace(old, new, 1), encoding="utf-8")


patch(
    "web/src/compositor.ts",
    '''        if (debugTarget && !emergency && line <= 1) {
          debugCandidates.push({
''',
    '''        if (debugTarget) {
          debugCandidates.push({
            pass: emergency ? (allowNaturalRescue ? "emergency" : "relaxed") : "strict",
''',
)

patch(
    "web/src/compositor.ts",
    '''            strictFit: strictFit ? {
              wordSpacing: strictFit.wordSpacing,
              tracking: strictFit.tracking,
              glyphScale: strictFit.glyphScale,
              fitness: strictFit.fitness,
              badness: strictFit.badness,
            } : null,
          });
''',
    '''            strictFit: strictFit ? {
              wordSpacing: strictFit.wordSpacing,
              tracking: strictFit.tracking,
              glyphScale: strictFit.glyphScale,
              fitness: strictFit.fitness,
              badness: strictFit.badness,
            } : null,
            selectedFit: fit ? {
              wordSpacing: fit.wordSpacing,
              tracking: fit.tracking,
              glyphScale: fit.glyphScale,
              fitness: fit.fitness,
              badness: fit.badness,
            } : null,
          });
''',
)

patch(
    "web/src/compositor.ts",
    '''  if (bestKey < 0) {
    if (debugTarget && !emergency) {
      const reachable = states.map((stateMap, index) => {
        if (!stateMap.size) return null;
        const decodedStates = [...stateMap.keys()].map((stateKey) => decodeState(stateKey));
        return {
          index,
          nextToken: (words[index]?.node.textContent ?? "").replace(/\\u00ad/g, ""),
          stateCount: stateMap.size,
          lines: [...new Set(decodedStates.map((state) => state.line))],
          glyphScales: [...new Set(decodedStates.map((state) => Number(state.glyphScale.toFixed(3))))],
          fitness: [...new Set(decodedStates.map((state) => state.fitness))],
        };
      }).filter((entry) => entry !== null);
      debugTarget.dataset.folioStrictFailure = JSON.stringify({
        tokenCount: count,
        furthestIndex: reachable.length ? reachable[reachable.length - 1]!.index : 0,
        frontier: reachable.slice(-18),
        candidates: debugCandidates.slice(-80),
      });
    }
    return null;
  }
''',
    '''  if (bestKey < 0) {
    if (debugTarget && !allowNaturalRescue) {
      const reachable = states.map((stateMap, index) => {
        if (!stateMap.size) return null;
        const decodedStates = [...stateMap.keys()].map((stateKey) => decodeState(stateKey));
        return {
          index,
          nextToken: (words[index]?.node.textContent ?? "").replace(/\\u00ad/g, ""),
          stateCount: stateMap.size,
          lines: [...new Set(decodedStates.map((state) => state.line))],
          glyphScales: [...new Set(decodedStates.map((state) => Number(state.glyphScale.toFixed(3))))],
          fitness: [...new Set(decodedStates.map((state) => state.fitness))],
        };
      }).filter((entry) => entry !== null);
      const failure = {
        pass: emergency ? "relaxed" : "strict",
        tokenCount: count,
        furthestIndex: reachable.length ? reachable[reachable.length - 1]!.index : 0,
        frontier: reachable.slice(-24),
        candidates: debugCandidates.slice(-180),
      };
      if (emergency) {
        let strictFailure: Record<string, unknown> = {};
        try {
          strictFailure = debugTarget.dataset.folioStrictFailure
            ? JSON.parse(debugTarget.dataset.folioStrictFailure)
            : {};
        } catch {
          strictFailure = {};
        }
        debugTarget.dataset.folioStrictFailure = JSON.stringify({ ...strictFailure, relaxedFailure: failure });
      } else {
        debugTarget.dataset.folioStrictFailure = JSON.stringify(failure);
      }
    }
    return null;
  }
''',
)

patch(
    "web/src/compositor.ts",
    '''  if (!breaks) breaks = chooseBreaks(words, geometry, spaceWidth, hyphenWidth, fontSize, true, null, false);
''',
    '''  if (!breaks) breaks = chooseBreaks(words, geometry, spaceWidth, hyphenWidth, fontSize, true, paragraph, false);
''',
)

print("Added relaxed-pass frontier diagnostics to live compositor")

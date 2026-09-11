from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "web/src/compositor.ts"
value = path.read_text(encoding="utf-8")

old = '''  const count = words.length;
  const states: Array<Map<number, State>> = Array.from({ length: count + 1 }, () => new Map());
  const initialFitness = 1;
'''
new = '''  const count = words.length;
  const states: Array<Map<number, State>> = Array.from({ length: count + 1 }, () => new Map());
  const debugCandidates: Array<Record<string, unknown>> = [];
  const initialFitness = 1;
'''
if new not in value:
    if old not in value:
        raise RuntimeError("state initialization marker missing")
    value = value.replace(old, new, 1)

old = '''        if (!canBreak) continue;
        if (natural > available + 0.75 && !fit && (end > start || last)) break;
'''
new = '''        if (!canBreak) continue;
        if (debugTarget && !emergency && line <= 1) {
          debugCandidates.push({
            start,
            end,
            nextIndex: end + 1,
            line,
            currentText: (words[end].node.textContent ?? "").replace(/\\u00ad/g, ""),
            nextText: (next?.node.textContent ?? "").replace(/\\u00ad/g, ""),
            hyphenBreak,
            natural,
            available,
            adjustment,
            fill: natural / Math.max(1, available),
            gaps,
            characters,
            previousGlyphScale: previous.glyphScale,
            strictFit: strictFit ? {
              wordSpacing: strictFit.wordSpacing,
              tracking: strictFit.tracking,
              glyphScale: strictFit.glyphScale,
              fitness: strictFit.fitness,
              badness: strictFit.badness,
            } : null,
          });
        }
        if (natural > available + 0.75 && !fit && (end > start || last)) break;
'''
if new not in value:
    if old not in value:
        raise RuntimeError("candidate marker missing")
    value = value.replace(old, new, 1)

old = '''      debugTarget.dataset.folioStrictFailure = JSON.stringify({
        tokenCount: count,
        furthestIndex: reachable.length ? reachable[reachable.length - 1]!.index : 0,
        frontier: reachable.slice(-18),
      });
'''
new = '''      debugTarget.dataset.folioStrictFailure = JSON.stringify({
        tokenCount: count,
        furthestIndex: reachable.length ? reachable[reachable.length - 1]!.index : 0,
        frontier: reachable.slice(-18),
        candidates: debugCandidates.slice(-80),
      });
'''
if new not in value:
    if old not in value:
        raise RuntimeError("strict failure marker missing")
    value = value.replace(old, new, 1)

path.write_text(value, encoding="utf-8")
print("Added strict breakpoint near-miss diagnostics")

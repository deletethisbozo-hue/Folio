from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    value = target.read_text(encoding="utf-8")
    if value.count(old) != 1:
        raise RuntimeError(f"expected exactly one compositor marker in {path}, found {value.count(old)}")
    target.write_text(value.replace(old, new, 1), encoding="utf-8")


web_old = """        if (natural > available + 0.75 && end > start) break;
        if (!canBreak) continue;

        const adjustment = available - natural;
        const trackingOps = Math.max(0, characters + gaps - 1);
        const strictFit = !last && natural <= available + 0.75
          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, false)
          : null;
        const fit = strictFit ?? (emergency && !last && natural <= available + 0.75
          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, true)
          : null);
"""
web_new = """        const adjustment = available - natural;
        const trackingOps = Math.max(0, characters + gaps - 1);
        // fitLine already has strict lower bounds for word spacing and tracking.
        // Let it use those bounds for slightly overfull candidates too; the old
        // natural-width guard made all negative-spacing logic effectively dead.
        const strictFit = !last
          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, false)
          : null;
        const fit = strictFit ?? (emergency && !last
          ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, true)
          : null);
        if (!canBreak) continue;
        if (natural > available + 0.75 && !fit && (end > start || last)) break;
"""

server_old = """            if (natural > available + 0.75 && end > start) break;
            if (!canBreak) continue;

            const adjustment = available - natural;
            const trackingOps = Math.max(0, characters + gaps - 1);
            const strictFit = !last && natural <= available + 0.75
              ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, false)
              : null;
            const fit = strictFit ?? (emergency && !last && natural <= available + 0.75
              ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, true)
              : null);
"""
server_new = """            const adjustment = available - natural;
            const trackingOps = Math.max(0, characters + gaps - 1);
            // Mirror live preview: bounded compression is a normal composition
            // tool, not an unreachable branch hidden behind natural <= measure.
            const strictFit = !last
              ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, false)
              : null;
            const fit = strictFit ?? (emergency && !last
              ? fitLine(adjustment, gaps, trackingOps, spaceWidth, fontSize, true)
              : null);
            if (!canBreak) continue;
            if (natural > available + 0.75 && !fit && (end > start || last)) break;
"""

replace_once("web/src/compositor.ts", web_old, web_new)
replace_once("server/pipeline/compositor.ts", server_old, server_new)
print("Enabled bounded negative spacing in preview and export compositors")

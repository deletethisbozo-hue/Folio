from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

for relative in ["web/src/compositor.ts", "server/pipeline/compositor.ts"]:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")

    old_penalty = "const hyphenPenalty = hyphenBreak\n          ? 165 + previousHyphenStreak * 560\n          : 0;"
    old_penalty_server = "const hyphenPenalty = hyphenBreak ? 165 + previousHyphenStreak * 560 : 0;"
    if old_penalty in value:
        value = value.replace(
            old_penalty,
            "const hyphenPenalty = hyphenBreak\n          ? 240 + previousHyphenStreak * 560\n          : 0;",
        )
    elif old_penalty_server in value:
        value = value.replace(
            old_penalty_server,
            "const hyphenPenalty = hyphenBreak ? 240 + previousHyphenStreak * 560 : 0;",
        )
    elif "240 + previousHyphenStreak * 560" not in value:
        raise RuntimeError(f"hyphen penalty block not found in {relative}")

    if relative.startswith("web/"):
        old_append = '''  lines.forEach((line, index) => {
    paragraph.append(line);
    if (index < lines.length - 1 && !breaks[index].hyphenated) paragraph.append(" ");
  });
}'''
        new_append = '''  lines.forEach((line, index) => {
    paragraph.append(line);
    if (index < lines.length - 1 && !breaks[index].hyphenated) paragraph.append(" ");
  });

  // Browser font metrics are not perfectly algebraic across platforms. The DP
  // solves against measured token widths, word spacing, tracking and scale, but
  // Chromium can still land a transformed inline fragment a fraction of a glyph
  // away from the intended measure (notably with Windows Palatino/Georgia-class
  // serif metrics). Calibrate the final visual scale from the actual rendered
  // width. This stays inside the same ±2% microtype envelope and usually moves
  // the chosen scale closer to 1; it does not relax spacing or tracking limits.
  const corrections: Array<{ line: HTMLElement; content: HTMLElement; scale: number }> = [];
  for (const line of lines) {
    if (!line.classList.contains("folio-line-justified")) continue;
    const content = line.querySelector<HTMLElement>(":scope > .folio-line-content");
    if (!content) continue;
    const rendered = content.getBoundingClientRect().width;
    const measure = line.getBoundingClientRect().width;
    const currentScale = Number(line.dataset.folioGlyphScale ?? 1);
    if (rendered <= 0 || measure <= 0 || !Number.isFinite(currentScale)) continue;
    const correctedScale = Math.max(0.98, Math.min(1.02, currentScale * measure / rendered));
    if (Math.abs(correctedScale - currentScale) > 0.00001) {
      corrections.push({ line, content, scale: correctedScale });
    }
  }
  for (const correction of corrections) {
    correction.content.style.transform = Math.abs(correction.scale - 1) > 0.00001
      ? `scaleX(${correction.scale})`
      : "";
    correction.line.dataset.folioGlyphScale = String(correction.scale);
  }
}'''
    else:
        old_append = '''      lines.forEach((line, index) => {
        paragraph.append(line);
        if (index < lines.length - 1 && !breaks[index].hyphenated) paragraph.append(" ");
      });
    }
  });
}'''
        new_append = '''      lines.forEach((line, index) => {
        paragraph.append(line);
        if (index < lines.length - 1 && !breaks[index].hyphenated) paragraph.append(" ");
      });

      // Mirror live preview exactly: calibrate the final transformed fragment
      // against Chromium's real rendered width. Platform font rasterizers can
      // differ slightly from the algebraic width model; correcting scale after
      // layout keeps export and preview on the same professional measure without
      // widening any spacing/tracking envelope.
      const corrections: Array<{ line: HTMLElement; content: HTMLElement; scale: number }> = [];
      for (const line of lines) {
        if (!line.classList.contains("folio-line-justified")) continue;
        const content = line.querySelector<HTMLElement>(":scope > .folio-line-content");
        if (!content) continue;
        const rendered = content.getBoundingClientRect().width;
        const measure = line.getBoundingClientRect().width;
        const currentScale = Number(line.dataset.folioGlyphScale ?? 1);
        if (rendered <= 0 || measure <= 0 || !Number.isFinite(currentScale)) continue;
        const correctedScale = Math.max(0.98, Math.min(1.02, currentScale * measure / rendered));
        if (Math.abs(correctedScale - currentScale) > 0.00001) {
          corrections.push({ line, content, scale: correctedScale });
        }
      }
      for (const correction of corrections) {
        correction.content.style.transform = Math.abs(correction.scale - 1) > 0.00001
          ? `scaleX(${correction.scale})`
          : "";
        correction.line.dataset.folioGlyphScale = String(correction.scale);
      }
    }
  });
}'''

    if new_append not in value:
        if old_append not in value:
            raise RuntimeError(f"final line append block not found in {relative}")
        value = value.replace(old_append, new_append, 1)

    path.write_text(value, encoding="utf-8")
    print(f"patched {relative}")

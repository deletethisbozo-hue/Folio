from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    value = target.read_text(encoding="utf-8")
    if new in value:
        print(f"{path}: patch already present")
        return
    if old not in value:
        raise RuntimeError(f"expected marker missing in {path}: {old[:80]!r}")
    target.write_text(value.replace(old, new, 1), encoding="utf-8")


for path in ("web/src/compositor.ts", "server/pipeline/compositor.ts"):
    replace_once(
        path,
        "  emergency: boolean;\n};" if path.startswith("web/") else "      emergency: boolean;\n    };",
        "  emergency: boolean;\n  relaxed: boolean;\n};" if path.startswith("web/") else "      emergency: boolean;\n      relaxed: boolean;\n    };",
    )

    replace_once(
        path,
        '''  const maxWordSpacing = emergency
    ? Math.min(spaceWidth * 0.48, fontSize * 0.14)
    : Math.min(spaceWidth * 0.50, fontSize * 0.115);
  const minWordSpacing = -Math.min(spaceWidth * 0.18, fontSize * 0.045);
  const maxTracking = fontSize * (emergency ? 0.007 : 0.0055);
''' if path.startswith("web/") else '''      const maxWordSpacing = emergency
        ? Math.min(spaceWidth * 0.48, fontSize * 0.14)
        : Math.min(spaceWidth * 0.50, fontSize * 0.115);
      const minWordSpacing = -Math.min(spaceWidth * 0.18, fontSize * 0.045);
      const maxTracking = fontSize * (emergency ? 0.007 : 0.0055);
''',
        '''  // The second pass may stretch inter-word space only slightly beyond
  // strict composition. Tracking and glyph expansion stay at strict limits;
  // this is a controlled justified fallback, not an excuse for loose copy.
  const maxWordSpacing = emergency
    ? Math.min(spaceWidth * 0.56, fontSize * 0.13)
    : Math.min(spaceWidth * 0.50, fontSize * 0.115);
  const minWordSpacing = -Math.min(spaceWidth * 0.18, fontSize * 0.045);
  const maxTracking = fontSize * 0.0055;
''' if path.startswith("web/") else '''      // The second pass may stretch inter-word space only slightly beyond
      // strict composition. Tracking and glyph expansion stay at strict limits;
      // this is a controlled justified fallback, not an excuse for loose copy.
      const maxWordSpacing = emergency
        ? Math.min(spaceWidth * 0.56, fontSize * 0.13)
        : Math.min(spaceWidth * 0.50, fontSize * 0.115);
      const minWordSpacing = -Math.min(spaceWidth * 0.18, fontSize * 0.045);
      const maxTracking = fontSize * 0.0055;
''',
    )

    # Initial DP state is neither a rendered rescue nor a relaxed line.
    replace_once(
        path,
        "    emergency,\n    fitness: initialFitness," if path.startswith("web/") else "        emergency,\n        fitness: initialFitness,",
        "    emergency: false,\n    relaxed: false,\n    fitness: initialFitness," if path.startswith("web/") else "        emergency: false,\n        relaxed: false,\n        fitness: initialFitness,",
    )

    # Mark only a line that actually required the wider justified fit as relaxed.
    marker = '''        const rescueNatural = dropcapRescue || emergencyRescue;
        const lineFit = dropcapRescue ? null : fit;
        if (!last && !lineFit && !rescueNatural) continue;
''' if path.startswith("web/") else '''            const rescueNatural = dropcapRescue || emergencyRescue;
            const lineFit = dropcapRescue ? null : fit;
            if (!last && !lineFit && !rescueNatural) continue;
'''
    replacement = '''        const rescueNatural = dropcapRescue || emergencyRescue;
        const lineFit = dropcapRescue ? null : fit;
        const relaxedFit = !last && emergency && !strictFit && Boolean(lineFit);
        if (!last && !lineFit && !rescueNatural) continue;
''' if path.startswith("web/") else '''            const rescueNatural = dropcapRescue || emergencyRescue;
            const lineFit = dropcapRescue ? null : fit;
            const relaxedFit = !last && emergency && !strictFit && Boolean(lineFit);
            if (!last && !lineFit && !rescueNatural) continue;
'''
    replace_once(path, marker, replacement)

    # Penalize each relaxed line so the fallback pass minimizes their use.
    marker = '''        const rescuePenalty = dropcapRescue
          ? 115 + 260 * Math.pow(1 - fill, 2)
          : rescueNatural ? 1100 + 900 * Math.pow(1 - fill, 2) : 0;
''' if path.startswith("web/") else '''            const rescuePenalty = dropcapRescue
              ? 115 + 260 * Math.pow(1 - fill, 2)
              : rescueNatural ? 1100 + 900 * Math.pow(1 - fill, 2) : 0;
'''
    replacement = marker + ("        const relaxedPenalty = relaxedFit ? 420 : 0;\n" if path.startswith("web/") else "            const relaxedPenalty = relaxedFit ? 420 : 0;\n")
    replace_once(path, marker, replacement)

    if path.startswith("web/"):
        replace_once(
            path,
            '''          + rescuePenalty
          + hyphenPenalty
''',
            '''          + rescuePenalty
          + relaxedPenalty
          + hyphenPenalty
''',
        )
        replace_once(
            path,
            '''            emergency: !last && emergency && !dropcapRescue && (!strictFit || emergencyRescue),
            fitness: currentFitness,
''',
            '''            emergency: emergencyRescue,
            relaxed: relaxedFit,
            fitness: currentFitness,
''',
        )
        replace_once(
            path,
            '''      emergency: state.emergency,
    });
''',
            '''      emergency: state.emergency,
      relaxed: state.relaxed,
    });
''',
        )
        replace_once(
            path,
            '''    line.className = `folio-composed-line ${lineBreak.justified ? "folio-line-justified" : "folio-line-natural"}${lineBreak.emergency ? " folio-line-emergency" : ""}`;
    if (lineBreak.emergency) line.dataset.folioEmergency = "true";
''',
            '''    line.className = `folio-composed-line ${lineBreak.justified ? "folio-line-justified" : "folio-line-natural"}${lineBreak.relaxed ? " folio-line-relaxed" : ""}${lineBreak.emergency ? " folio-line-emergency" : ""}`;
    if (lineBreak.relaxed) line.dataset.folioRelaxed = "true";
    if (lineBreak.emergency) line.dataset.folioEmergency = "true";
''',
        )
    else:
        replace_once(
            path,
            '''            const cost = previous.cost + (lineFit?.badness ?? 0) + rescuePenalty + hyphenPenalty + punctuationPenalty + shortLastPenalty + fitnessPenalty + rivers.cost;
''',
            '''            const cost = previous.cost + (lineFit?.badness ?? 0) + rescuePenalty + relaxedPenalty + hyphenPenalty + punctuationPenalty + shortLastPenalty + fitnessPenalty + rivers.cost;
''',
        )
        replace_once(
            path,
            '''              emergency: !last && emergency && !dropcapRescue && (!strictFit || emergencyRescue),
              fitness: currentFitness,
''',
            '''              emergency: emergencyRescue,
              relaxed: relaxedFit,
              fitness: currentFitness,
''',
        )
        replace_once(
            path,
            '''          emergency: state.emergency,
        });
''',
            '''          emergency: state.emergency,
          relaxed: state.relaxed,
        });
''',
        )
        replace_once(
            path,
            '''        line.className = `folio-composed-line ${lineBreak.justified ? "folio-line-justified" : "folio-line-natural"}${lineBreak.emergency ? " folio-line-emergency" : ""}`;
        if (lineBreak.emergency) line.dataset.folioEmergency = "true";
''',
            '''        line.className = `folio-composed-line ${lineBreak.justified ? "folio-line-justified" : "folio-line-natural"}${lineBreak.relaxed ? " folio-line-relaxed" : ""}${lineBreak.emergency ? " folio-line-emergency" : ""}`;
        if (lineBreak.relaxed) line.dataset.folioRelaxed = "true";
        if (lineBreak.emergency) line.dataset.folioEmergency = "true";
''',
        )

# QA reports strict and relaxed spacing separately, while keeping the original
# global metric for easy inspection of the worst rendered line.
qa = "scripts/v107-visual-qa.ts"
replace_once(qa, "      let maxWordSpacingEm = 0;\n      let maxTrackingEm = 0;", "      let maxWordSpacingEm = 0;\n      let maxStrictWordSpacingEm = 0;\n      let maxRelaxedWordSpacingEm = 0;\n      let relaxedLines = 0;\n      let maxTrackingEm = 0;")
replace_once(qa, "        emergency: boolean;\n        wordSpacingEm: number;", "        emergency: boolean;\n        relaxed: boolean;\n        wordSpacingEm: number;")
replace_once(qa, "            emergency: line.dataset.folioEmergency === \"true\",\n            wordSpacingEm:", "            emergency: line.dataset.folioEmergency === \"true\",\n            relaxed: line.dataset.folioRelaxed === \"true\",\n            wordSpacingEm:")
replace_once(
    qa,
    '''            const spacing = Number(line.dataset.folioWordSpacing ?? 0) / fontSize;
            maxWordSpacingEm = Math.max(maxWordSpacingEm, Math.abs(spacing));
            maxTrackingEm = Math.max(maxTrackingEm, Math.abs(Number(line.dataset.folioTracking ?? 0) / fontSize));
''',
    '''            const spacing = Number(line.dataset.folioWordSpacing ?? 0) / fontSize;
            const relaxed = line.dataset.folioRelaxed === "true";
            maxWordSpacingEm = Math.max(maxWordSpacingEm, Math.abs(spacing));
            if (relaxed) {
              relaxedLines++;
              maxRelaxedWordSpacingEm = Math.max(maxRelaxedWordSpacingEm, Math.abs(spacing));
            } else {
              maxStrictWordSpacingEm = Math.max(maxStrictWordSpacingEm, Math.abs(spacing));
            }
            maxTrackingEm = Math.max(maxTrackingEm, Math.abs(Number(line.dataset.folioTracking ?? 0) / fontSize));
''',
)
replace_once(
    qa,
    '''        maxWordSpacingEm,
        maxTrackingEm,
''',
    '''        maxWordSpacingEm,
        maxStrictWordSpacingEm,
        maxRelaxedWordSpacingEm,
        relaxedLines,
        maxTrackingEm,
''',
)
replace_once(
    qa,
    '''      report.maxWordSpacingEm > 0.116 || report.maxTrackingEm > 0.0057 || report.maxGlyphScaleDelta > 0.0201 ||
''',
    '''      report.maxWordSpacingEm > 0.131 || report.maxStrictWordSpacingEm > 0.116 || report.maxRelaxedWordSpacingEm > 0.131 ||
      report.relaxedLines > 2 || report.maxTrackingEm > 0.0057 || report.maxGlyphScaleDelta > 0.0201 ||
''',
)

print("Added controlled relaxed justified pass and explicit QA guards")

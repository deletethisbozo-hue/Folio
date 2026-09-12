from pathlib import Path

path = Path("scripts/v107-theme-matrix.ts")
text = path.read_text(encoding="utf-8")

old = '''      let emergencyLines = 0;\n      let oneWordFinalLines = 0;\n      let compositionFailures = 0;\n      let strandedEnglishArticleLine = "";\n      let previousSpacing: number | null = null;\n      let previousGlyphScale: number | null = null;\n\n      for (const paragraph of paragraphs) {\n        if (paragraph.dataset.folioStrictFailure) compositionFailures++;\n        const lines = [...paragraph.querySelectorAll<HTMLElement>(":scope > .folio-composed-line")];\n'''
new = '''      let emergencyLines = 0;\n      let oneWordFinalLines = 0;\n      const compositionFailureDetails: Array<{ paragraphIndex: number; failure: unknown }> = [];\n      const emergencyDetails: Array<{ paragraphIndex: number; lineIndex: number; text: string; previousText: string | null; nextText: string | null; wordSpacingEm: number; trackingEm: number; glyphScale: number; strictFailure: unknown }> = [];\n      let strandedEnglishArticleLine = "";\n\n      for (const paragraph of paragraphs) {\n        const paragraphIndex = paragraphs.indexOf(paragraph);\n        const rawFailure = paragraph.dataset.folioStrictFailure;\n        let parsedFailure: unknown = null;\n        if (rawFailure) {\n          parsedFailure = rawFailure;\n          try { parsedFailure = JSON.parse(rawFailure); } catch { /* keep raw diagnostic */ }\n          compositionFailureDetails.push({ paragraphIndex, failure: parsedFailure });\n        }\n        const lines = [...paragraph.querySelectorAll<HTMLElement>(":scope > .folio-composed-line")];\n'''
if old not in text:
    raise SystemExit("diagnostic header block not found")
text = text.replace(old, new, 1)

old = '''        let streak = 0;\n        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {\n'''
new = '''        let streak = 0;\n        // Continuity is meaningful only within one paragraph. The compositor\n        // intentionally resets microtype continuity after the natural final line.\n        let previousSpacing: number | null = null;\n        let previousGlyphScale: number | null = null;\n        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {\n'''
if old not in text:
    raise SystemExit("paragraph continuity block not found")
text = text.replace(old, new, 1)

old = '''          if (line.dataset.folioEmergency === "true") emergencyLines++;\n          if (englishScenario && lineIndex < lines.length - 1 && /(?:^|\\s)(?:a|an|the)$/i.test(text)) strandedEnglishArticleLine ||= text;\n'''
new = '''          if (line.dataset.folioEmergency === "true") {\n            emergencyLines++;\n            emergencyDetails.push({\n              paragraphIndex,\n              lineIndex,\n              text,\n              previousText: lines[lineIndex - 1]?.textContent?.replace(/\\u00ad/g, "").trim() ?? null,\n              nextText: lines[lineIndex + 1]?.textContent?.replace(/\\u00ad/g, "").trim() ?? null,\n              wordSpacingEm: spacing,\n              trackingEm: tracking,\n              glyphScale,\n              strictFailure: parsedFailure,\n            });\n          }\n          if (englishScenario && lineIndex < lines.length - 1 && /(?:^|\\s)(?:a|an|the)$/i.test(text)) strandedEnglishArticleLine ||= text;\n'''
if old not in text:
    raise SystemExit("emergency diagnostic block not found")
text = text.replace(old, new, 1)

old = '''        emergencyLines,\n        oneWordFinalLines,\n        compositionFailures,\n        ornamentalBreaksOffCenter,\n'''
new = '''        emergencyLines,\n        oneWordFinalLines,\n        compositionFailures: compositionFailureDetails.length,\n        compositionFailureDetails,\n        emergencyDetails,\n        ornamentalBreaksOffCenter,\n'''
if old not in text:
    raise SystemExit("return diagnostic block not found")
text = text.replace(old, new, 1)

path.write_text(text, encoding="utf-8")

from pathlib import Path

path = Path(__file__).resolve().parents[1] / "scripts/v107-visual-qa.ts"
value = path.read_text(encoding="utf-8")

old_decl = '''      }> = [];\n      const lineDetails: Array<{'''
new_decl = '''      }> = [];\n      const compositionFailures: Array<{ paragraphIndex: number; failure: unknown }> = [];\n      const lineDetails: Array<{'''
if new_decl not in value:
    if old_decl not in value:
        raise RuntimeError("composition failure declaration marker missing")
    value = value.replace(old_decl, new_decl, 1)

old_loop = '''      for (const paragraph of paragraphs) {\n        const lines = [...paragraph.querySelectorAll<HTMLElement>(":scope > .folio-composed-line")];'''
new_loop = '''      for (const paragraph of paragraphs) {\n        const rawFailure = paragraph.dataset.folioStrictFailure;\n        if (rawFailure) {\n          let failure: unknown = rawFailure;\n          try { failure = JSON.parse(rawFailure); } catch { /* keep raw diagnostic */ }\n          compositionFailures.push({ paragraphIndex: paragraphs.indexOf(paragraph), failure });\n        }\n        const lines = [...paragraph.querySelectorAll<HTMLElement>(":scope > .folio-composed-line")];'''
if new_loop not in value:
    if old_loop not in value:
        raise RuntimeError("paragraph loop marker missing")
    value = value.replace(old_loop, new_loop, 1)

old_return = '''        emergencyLines,\n        emergencyDetails,\n        lineDetails,'''
new_return = '''        emergencyLines,\n        emergencyDetails,\n        compositionFailures,\n        lineDetails,'''
if new_return not in value:
    if old_return not in value:
        raise RuntimeError("report return marker missing")
    value = value.replace(old_return, new_return, 1)

path.write_text(value, encoding="utf-8")
print("Visual QA now reports professional-pass failures even when rescue lines are not flagged emergency")

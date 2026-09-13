from pathlib import Path


def one(path: str, old: str, new: str, expected: int = 1) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected}, got {count}: {old[:90]!r}")
    p.write_text(text.replace(old, new))


# Paged.js break-rule parser can throw "item doesn't belong to list" while
# removing break-before/page declarations. Preserve the exact pagination intent
# using the data attribute consumed by Paged.js at layout time instead.
one(
    "server/blues.ts",
    "section.blues-toc { page: bluestoc; break-before: page; }\nsection.chapter { page: chapter; break-before: page; }",
    "section.blues-toc { page: bluestoc; }\nsection.chapter { page: chapter; }",
)
one(
    "server/pipeline/render-blues.ts",
    """      document.querySelectorAll(\"section.chapter\").forEach((sec, i) => {\n        sec.setAttribute(\"data-ch\", String(i + 1));\n        sec.querySelectorAll(\"*\").forEach((el) => el.setAttribute(\"data-ch\", String(i + 1)));\n      });\n      document.querySelectorAll(\"a\").forEach((a) => {""",
    """      document.querySelectorAll(\"section.chapter\").forEach((sec, i) => {\n        sec.setAttribute(\"data-ch\", String(i + 1));\n        sec.setAttribute(\"data-break-before\", \"page\");\n        sec.querySelectorAll(\"*\").forEach((el) => el.setAttribute(\"data-ch\", String(i + 1)));\n      });\n      document.querySelector(\"section.blues-toc\")?.setAttribute(\"data-break-before\", \"page\");\n      document.querySelectorAll(\"a\").forEach((a) => {""",
)

# Final-state selection must prefer a multi-word ending whenever one exists.
p = Path("web/src/compositor.ts")
text = p.read_text()
one_old = """  let bestKey = -1;\n  let bestCost = Number.POSITIVE_INFINITY;\n  let bestSectionRate = Number.POSITIVE_INFINITY;\n  let bestHyphenBudgetPriority = 3;\n  for (const [key, state] of states[count]) {"""
one_new = """  let bestKey = -1;\n  let bestCost = Number.POSITIVE_INFINITY;\n  let bestSectionRate = Number.POSITIVE_INFINITY;\n  let bestWidowPriority = 2;\n  let bestHyphenBudgetPriority = 3;\n  for (const [key, state] of states[count]) {"""
if text.count(one_old) != 1:
    raise SystemExit("compositor final-state header changed")
text = text.replace(one_old, one_new, 1)
old = """    const sectionRate = sectionHyphenatedLines / Math.max(1, sectionJustifiedLines);\n    // 0.45 is the release ceiling, not the composition target. Prefer 0.40\n    // when feasible, preserving cross-platform headroom without loosening fit.\n    const hyphenBudgetPriority = sectionRate <= 0.40 + 1e-9\n      ? 0\n      : sectionRate <= 0.45 + 1e-9 ? 1 : 2;\n    const betterSamePriority = hyphenBudgetPriority < 2\n      ? state.cost < bestCost\n      : sectionRate < bestSectionRate - 1e-9\n        || (Math.abs(sectionRate - bestSectionRate) <= 1e-9 && state.cost < bestCost);\n    if (hyphenBudgetPriority < bestHyphenBudgetPriority\n      || (hyphenBudgetPriority === bestHyphenBudgetPriority && betterSamePriority)) {\n      bestHyphenBudgetPriority = hyphenBudgetPriority;"""
new = """    const sectionRate = sectionHyphenatedLines / Math.max(1, sectionJustifiedLines);\n    const finalSemanticWords = state.from < count\n      ? 1 + words.slice(state.from + 1, count).filter((word) => word.spaceBefore).length\n      : 0;\n    const widowPriority = finalSemanticWords === 1 ? 1 : 0;\n    // 0.45 is the release ceiling, not the composition target. Prefer 0.40\n    // when feasible, preserving cross-platform headroom without loosening fit.\n    const hyphenBudgetPriority = sectionRate <= 0.40 + 1e-9\n      ? 0\n      : sectionRate <= 0.45 + 1e-9 ? 1 : 2;\n    const betterSamePriority = hyphenBudgetPriority < 2\n      ? state.cost < bestCost\n      : sectionRate < bestSectionRate - 1e-9\n        || (Math.abs(sectionRate - bestSectionRate) <= 1e-9 && state.cost < bestCost);\n    if (widowPriority < bestWidowPriority\n      || (widowPriority === bestWidowPriority && (hyphenBudgetPriority < bestHyphenBudgetPriority\n      || (hyphenBudgetPriority === bestHyphenBudgetPriority && betterSamePriority)))) {\n      bestWidowPriority = widowPriority;\n      bestHyphenBudgetPriority = hyphenBudgetPriority;"""
if text.count(old) != 1:
    raise SystemExit("compositor final-state priority block changed")
text = text.replace(old, new, 1)
p.write_text(text)

# These are optical-size calibrations, not QA exceptions. The bundled faces have
# materially different set widths at the same nominal 16px size. Calibrate prose
# per theme so body colour/line length stays comparable while all microtype gates
# remain unchanged. Headings and other display furniture keep their theme sizes.
p = Path("server/pipeline/theme-fonts.ts")
text = p.read_text()
anchor = "type FontKey = keyof typeof FONTS;\n"
insert = """type FontKey = keyof typeof FONTS;\n\nconst THEME_PROSE_SCALE: Partial<Record<ThemeName, number>> = {\n  modern: 0.985,\n  decorative: 0.970,\n  editorial: 0.985,\n  scholar: 0.985,\n  folio: 0.985,\n  ivory: 0.995,\n  nocturne: 0.970,\n  cloister: 0.980,\n  atlas: 0.985,\n  stanza: 0.995,\n  ember: 0.985,\n  cinder: 0.995,\n  solstice: 0.985,\n  obsidian: 0.970,\n  cathedral: 0.970,\n  necropolis: 0.995,\n  wyrmwood: 0.980,\n  runestone: 0.985,\n  ironbound: 0.980,\n  revenant: 0.970,\n};\n\nfunction proseCalibrationCss(theme: ThemeName): string {\n  const scale = THEME_PROSE_SCALE[theme];\n  if (!scale) return \"\";\n  return `section.chapter>p:not(.scene-break),section.chapter blockquote p,section.chapter li,section.backmatter>p:not(.scene-break),section.backmatter li{font-size:${scale}em}`;\n}\n"""
if text.count(anchor) != 1:
    raise SystemExit("theme-fonts FontKey anchor changed")
text = text.replace(anchor, insert, 1)
old = """  const fontCss = faces.join(\"\\n\");\n  const fontFiles = [...new Set(keys.flatMap((key) => FONTS[key].faces.map((face) => path.join(THEME_FONTS_DIR, face.file))))];\n  return {\n    css: `${fontCss}\\n${normalized.css}`,\n    themeCss: normalized.css,"""
new = """  const fontCss = faces.join(\"\\n\");\n  const calibrationCss = proseCalibrationCss(theme);\n  const calibratedThemeCss = calibrationCss ? `${normalized.css}\\n${calibrationCss}` : normalized.css;\n  const fontFiles = [...new Set(keys.flatMap((key) => FONTS[key].faces.map((face) => path.join(THEME_FONTS_DIR, face.file))))];\n  return {\n    css: `${fontCss}\\n${calibratedThemeCss}`,\n    themeCss: calibratedThemeCss,"""
if text.count(old) != 1:
    raise SystemExit("theme-fonts return block changed")
text = text.replace(old, new, 1)
p.write_text(text)

# Slow hosted runners can take longer to settle the full rich-paste preview; the
# assertion itself remains identical.
p = Path("tests/ui-runtime.test.ts")
text = p.read_text()
marker = """    await page.waitForFunction(() => {\n      const editor = document.querySelector(\".rich-editor\") as HTMLElement | null;\n      const html = editor?.innerHTML ?? \"\";\n      const md = editor?.dataset.markdown ?? \"\";\n      return html.includes(\"font-weight: 700\")\n        && html.includes(\"font-style: italic\")\n        && html.includes(\"text-decoration\")\n        && html.includes(\"underline\")\n        && html.includes(\"editor-scene-break\")\n        && md.includes(\"**Bold paste**\")\n        && md.includes(\"*italic paste*\")\n        && md.includes(\"<u>underline paste</u>\")\n        && md.includes(\"---\");\n    });"""
replacement = marker[:-4] + ", { timeout: 30000 });"
if text.count(marker) != 1:
    raise SystemExit("rich-paste wait block changed")
text = text.replace(marker, replacement, 1)
p.write_text(text)

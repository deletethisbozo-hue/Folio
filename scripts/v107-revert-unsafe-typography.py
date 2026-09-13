from pathlib import Path


def one(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, got {count}")
    p.write_text(text.replace(old, new, 1))

one(
    "server/pipeline/theme-fonts.ts",
    '''type FontKey = keyof typeof FONTS;

const THEME_PROSE_SCALE: Partial<Record<ThemeName, number>> = {
  modern: 0.985,
  decorative: 0.970,
  editorial: 0.985,
  scholar: 0.985,
  folio: 0.985,
  ivory: 0.995,
  nocturne: 0.970,
  cloister: 0.980,
  atlas: 0.985,
  stanza: 0.995,
  ember: 0.985,
  cinder: 0.995,
  solstice: 0.985,
  obsidian: 0.970,
  cathedral: 0.970,
  necropolis: 0.995,
  wyrmwood: 0.980,
  runestone: 0.985,
  ironbound: 0.980,
  revenant: 0.970,
};

function proseCalibrationCss(theme: ThemeName): string {
  const scale = THEME_PROSE_SCALE[theme];
  if (!scale) return "";
  return `section.chapter>p:not(.scene-break),section.chapter blockquote p,section.chapter li,section.backmatter>p:not(.scene-break),section.backmatter li{font-size:${scale}em}`;
}
''',
    '''type FontKey = keyof typeof FONTS;
''',
)
one(
    "server/pipeline/theme-fonts.ts",
    '''  const fontCss = faces.join("\\n");
  const calibrationCss = proseCalibrationCss(theme);
  const calibratedThemeCss = calibrationCss ? `${normalized.css}\\n${calibrationCss}` : normalized.css;
  const fontFiles = [...new Set(keys.flatMap((key) => FONTS[key].faces.map((face) => path.join(THEME_FONTS_DIR, face.file))))];
  return {
    css: `${fontCss}\\n${calibratedThemeCss}`,
    themeCss: calibratedThemeCss,
''',
    '''  const fontCss = faces.join("\\n");
  const fontFiles = [...new Set(keys.flatMap((key) => FONTS[key].faces.map((face) => path.join(THEME_FONTS_DIR, face.file))))];
  return {
    css: `${fontCss}\\n${normalized.css}`,
    themeCss: normalized.css,
''',
)
one(
    "web/src/compositor.ts",
    '''  let bestSectionRate = Number.POSITIVE_INFINITY;
  let bestWidowPriority = 2;
  let bestHyphenBudgetPriority = 3;
''',
    '''  let bestSectionRate = Number.POSITIVE_INFINITY;
  let bestHyphenBudgetPriority = 3;
''',
)
one(
    "web/src/compositor.ts",
    '''    const sectionRate = sectionHyphenatedLines / Math.max(1, sectionJustifiedLines);
    const finalSemanticWords = state.from < count
      ? 1 + words.slice(state.from + 1, count).filter((word) => word.spaceBefore).length
      : 0;
    const widowPriority = finalSemanticWords === 1 ? 1 : 0;
    // 0.45 is the release ceiling, not the composition target. Prefer 0.40
''',
    '''    const sectionRate = sectionHyphenatedLines / Math.max(1, sectionJustifiedLines);
    // 0.45 is the release ceiling, not the composition target. Prefer 0.40
''',
)
one(
    "web/src/compositor.ts",
    '''    if (widowPriority < bestWidowPriority
      || (widowPriority === bestWidowPriority && (hyphenBudgetPriority < bestHyphenBudgetPriority
      || (hyphenBudgetPriority === bestHyphenBudgetPriority && betterSamePriority)))) {
      bestWidowPriority = widowPriority;
      bestHyphenBudgetPriority = hyphenBudgetPriority;
''',
    '''    if (hyphenBudgetPriority < bestHyphenBudgetPriority
      || (hyphenBudgetPriority === bestHyphenBudgetPriority && betterSamePriority)) {
      bestHyphenBudgetPriority = hyphenBudgetPriority;
''',
)

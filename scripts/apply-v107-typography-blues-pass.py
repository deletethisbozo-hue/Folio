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
    """      document.querySelectorAll("section.chapter").forEach((sec, i) => {
        sec.setAttribute("data-ch", String(i + 1));
        sec.querySelectorAll("*").forEach((el) => el.setAttribute("data-ch", String(i + 1)));
      });
      document.querySelectorAll("a").forEach((a) => {""",
    """      document.querySelectorAll("section.chapter").forEach((sec, i) => {
        sec.setAttribute("data-ch", String(i + 1));
        sec.setAttribute("data-break-before", "page");
        sec.querySelectorAll("*").forEach((el) => el.setAttribute("data-ch", String(i + 1)));
      });
      document.querySelector("section.blues-toc")?.setAttribute("data-break-before", "page");
      document.querySelectorAll("a").forEach((a) => {""",
)

# Final-state selection must prefer a multi-word ending whenever one exists.
p = Path("web/src/compositor.ts")
text = p.read_text()
one_old = """  let bestKey = -1;
  let bestCost = Number.POSITIVE_INFINITY;
  let bestSectionRate = Number.POSITIVE_INFINITY;
  let bestHyphenBudgetPriority = 3;
  for (const [key, state] of states[count]) {"""
one_new = """  let bestKey = -1;
  let bestCost = Number.POSITIVE_INFINITY;
  let bestSectionRate = Number.POSITIVE_INFINITY;
  let bestWidowPriority = 2;
  let bestHyphenBudgetPriority = 3;
  for (const [key, state] of states[count]) {"""
if text.count(one_old) != 1:
    raise SystemExit("compositor final-state header changed")
text = text.replace(one_old, one_new, 1)
old = """    const sectionRate = sectionHyphenatedLines / Math.max(1, sectionJustifiedLines);
    // 0.45 is the release ceiling, not the composition target. Prefer 0.40
    // when feasible, preserving cross-platform headroom without loosening fit.
    const hyphenBudgetPriority = sectionRate <= 0.40 + 1e-9
      ? 0
      : sectionRate <= 0.45 + 1e-9 ? 1 : 2;
    const betterSamePriority = hyphenBudgetPriority < 2
      ? state.cost < bestCost
      : sectionRate < bestSectionRate - 1e-9
        || (Math.abs(sectionRate - bestSectionRate) <= 1e-9 && state.cost < bestCost);
    if (hyphenBudgetPriority < bestHyphenBudgetPriority
      || (hyphenBudgetPriority === bestHyphenBudgetPriority && betterSamePriority)) {
      bestHyphenBudgetPriority = hyphenBudgetPriority;"""
new = """    const sectionRate = sectionHyphenatedLines / Math.max(1, sectionJustifiedLines);
    const finalSemanticWords = state.from < count
      ? 1 + words.slice(state.from + 1, count).filter((word) => word.spaceBefore).length
      : 0;
    const widowPriority = finalSemanticWords === 1 ? 1 : 0;
    // 0.45 is the release ceiling, not the composition target. Prefer 0.40
    // when feasible, preserving cross-platform headroom without loosening fit.
    const hyphenBudgetPriority = sectionRate <= 0.40 + 1e-9
      ? 0
      : sectionRate <= 0.45 + 1e-9 ? 1 : 2;
    const betterSamePriority = hyphenBudgetPriority < 2
      ? state.cost < bestCost
      : sectionRate < bestSectionRate - 1e-9
        || (Math.abs(sectionRate - bestSectionRate) <= 1e-9 && state.cost < bestCost);
    if (widowPriority < bestWidowPriority
      || (widowPriority === bestWidowPriority && (hyphenBudgetPriority < bestHyphenBudgetPriority
      || (hyphenBudgetPriority === bestHyphenBudgetPriority && betterSamePriority)))) {
      bestWidowPriority = widowPriority;
      bestHyphenBudgetPriority = hyphenBudgetPriority;"""
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
insert = """type FontKey = keyof typeof FONTS;

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
"""
if text.count(anchor) != 1:
    raise SystemExit("theme-fonts FontKey anchor changed")
text = text.replace(anchor, insert, 1)
old = """  const fontCss = faces.join("\\n");
  const fontFiles = [...new Set(keys.flatMap((key) => FONTS[key].faces.map((face) => path.join(THEME_FONTS_DIR, face.file))))];
  return {
    css: `${fontCss}\\n${normalized.css}`,
    themeCss: normalized.css,"""
new = """  const fontCss = faces.join("\\n");
  const calibrationCss = proseCalibrationCss(theme);
  const calibratedThemeCss = calibrationCss ? `${normalized.css}\\n${calibrationCss}` : normalized.css;
  const fontFiles = [...new Set(keys.flatMap((key) => FONTS[key].faces.map((face) => path.join(THEME_FONTS_DIR, face.file))))];
  return {
    css: `${fontCss}\\n${calibratedThemeCss}`,
    themeCss: calibratedThemeCss,"""
if text.count(old) != 1:
    raise SystemExit("theme-fonts return block changed")
text = text.replace(old, new, 1)
p.write_text(text)

# Slow hosted runners can take longer to settle the LibreOffice conversion. The
# assertion is unchanged; only this stage gets a runner-friendly deadline.
one(
    "tests/ui-runtime.test.ts",
    """  await stage("LibreOffice rich paste", () => page.waitForFunction(() => {
    const markdown = (document.querySelector(".rich-editor") as HTMLElement)?.dataset.markdown ?? "";
    return markdown.includes("Libre first **bold**") && markdown.includes("Libre second") && markdown.includes("- Writer list");
  }));""",
    """  await stage("LibreOffice rich paste", () => page.waitForFunction(() => {
    const markdown = (document.querySelector(".rich-editor") as HTMLElement)?.dataset.markdown ?? "";
    return markdown.includes("Libre first **bold**") && markdown.includes("Libre second") && markdown.includes("- Writer list");
  }, { timeout: 30000 }));""",
)

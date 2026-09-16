import { promises as fs } from "node:fs";

async function patch(file, replacements) {
  let source = await fs.readFile(file, "utf8");
  for (const [label, before, after] of replacements) {
    const at = source.indexOf(before);
    if (at < 0) throw new Error(`${file}: missing anchor: ${label}`);
    if (source.indexOf(before, at + before.length) >= 0) throw new Error(`${file}: non-unique anchor: ${label}`);
    source = source.slice(0, at) + after + source.slice(at + before.length);
  }
  await fs.writeFile(file, source, "utf8");
}

await patch("server/pipeline/themes.ts", [
  ["nocturne label", 'chapterLabel: "NIGHT I"', 'chapterLabel: "I"'],
  ["aubade label", 'chapterLabel: "DAWN ONE"', 'chapterLabel: "I"'],
  ["solstice label", 'chapterLabel: "SOLSTICE I"', 'chapterLabel: "I"'],
  ["obsidian label", 'chapterLabel: "SHARD I"', 'chapterLabel: "I"'],
  ["grimoire label", 'chapterLabel: "BOOK I"', 'chapterLabel: "I"'],
  ["witchlight label", 'chapterLabel: "HEX I"', 'chapterLabel: "I"'],
  ["revenant label", 'chapterLabel: "RETURN I"', 'chapterLabel: "I"'],
  [
    "supported theme registry",
    `export function hasTheme(name: string): name is ThemeName {\n  return Object.prototype.hasOwnProperty.call(THEMES, name);\n}\n\nexport function getTheme(name: string): ThemeConfig {\n  return THEMES[hasTheme(name) ? name : "folio"];\n}\n\nexport function themeList(): ThemeConfig[] {\n  return Object.values(THEMES);\n}`,
    `export const SUPPORTED_THEMES = [\n  "blackletter",\n  "stanza",\n  "witchlight",\n  "revenant",\n  "solstice",\n  "literary",\n  "nocturne",\n  "obsidian",\n  "grimoire",\n  "ivory",\n  "heritage",\n  "decorative",\n  "cathedral",\n  "aubade",\n] as const satisfies readonly ThemeName[];\n\nconst SUPPORTED_THEME_SET = new Set<string>(SUPPORTED_THEMES);\n\n/** Folio 2.0 exposes only the curated, production-qualified theme set. */\nexport function hasTheme(name: string): name is ThemeName {\n  return SUPPORTED_THEME_SET.has(name);\n}\n\nexport function getTheme(name: string): ThemeConfig {\n  return THEMES[hasTheme(name) ? name : "literary"];\n}\n\nexport function themeList(): ThemeConfig[] {\n  return SUPPORTED_THEMES.map((name) => THEMES[name]);\n}`,
  ],
]);

await patch("server/pipeline/ingest.ts", [
  ["2.0 theme fallback", 'const theme = (cfg.theme && hasTheme(cfg.theme) ? cfg.theme : "folio") as ThemeName;', 'const theme = (cfg.theme && hasTheme(cfg.theme) ? cfg.theme : "literary") as ThemeName;'],
]);

await patch("server/api.ts", [
  ["new book default theme", '        theme: "folio",', '        theme: "literary",'],
]);

await patch("tests/ui-runtime.test.ts", [
  ["theme count", 'check("style browser exposes all 29 visual themes", themeCount === 29, String(themeCount));', 'check("Folio 2.0 exposes only the 14 curated visual themes", themeCount === 14, String(themeCount));'],
  ["theme signature floor", 'check("theme cards have materially different visual signatures", distinctCards >= 24, String(distinctCards) + " distinct");', 'check("curated theme cards remain materially different", distinctCards >= 12, String(distinctCards) + " distinct");'],
  ["select editorial", '  await page.click(\'.theme-sample[data-theme="editorial"]\');\n  await stage("render Editorial theme", () => page.waitForFunction(() => {', '  await page.click(\'.theme-sample[data-theme="cathedral"]\');\n  await stage("render Cathedral theme", () => page.waitForFunction(() => {'],
  ["editorial variable", '  const editorial = await page.evaluate(() => {', '  const cathedral = await page.evaluate(() => {'],
  ["theme compare", '  check("selecting themes changes the actual book layout, not only the name", editorial !== blackletter, editorial + " / " + blackletter);', '  check("selecting themes changes the actual book layout, not only the name", cathedral !== blackletter, cathedral + " / " + blackletter);'],
]);

console.log("Applied Folio 2.0 curated theme cleanup.");

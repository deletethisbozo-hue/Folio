import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { NEW_PRODUCTION_THEMES, SUPPORTED_THEMES, THEMES, themeList } from "../server/pipeline/themes.ts";
import { buildThemeRuntimeCss } from "../server/pipeline/theme-fonts.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RETIRED = new Set([
  "modern", "editorial", "scholar", "folio", "cloister", "parchment", "atlas",
  "ember", "cinder", "timber", "bloodmoon", "necropolis", "wyrmwood",
  "runestone", "ironbound",
]);

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? passed++ : failed++;
};

console.log("\n30-theme production catalog gate");

check("exactly 30 themes are user-selectable", SUPPORTED_THEMES.length === 30, String(SUPPORTED_THEMES.length));
check("all 17 new themes are active", NEW_PRODUCTION_THEMES.every((theme) => SUPPORTED_THEMES.includes(theme)), NEW_PRODUCTION_THEMES.join(", "));
check("none of the 15 retired themes were reactivated", SUPPORTED_THEMES.every((theme) => !RETIRED.has(theme)), SUPPORTED_THEMES.filter((theme) => RETIRED.has(theme)).join(", "));
check("themeList exposes the same 30 stable entries", themeList().length === 30 && themeList().every((theme, i) => theme.name === SUPPORTED_THEMES[i]));

const labels = new Set(themeList().map((theme) => theme.label));
const descriptions = new Set(themeList().map((theme) => theme.description));
check("every visible theme has a unique label", labels.size === 30, String(labels.size));
check("every visible theme has its own description", descriptions.size === 30, String(descriptions.size));

const cssFingerprints = new Map<string, string>();
for (const theme of SUPPORTED_THEMES) {
  const file = path.join(ROOT, "themes", theme, "theme.css");
  let css = "";
  try { css = await fs.readFile(file, "utf8"); } catch {}
  check(`${theme}: theme.css exists and is substantive`, css.length >= 650, `${css.length} chars`);
  check(`${theme}: styles chapter openings`, /section\.chapter\s*>\s*h1/.test(css));
  if ((NEW_PRODUCTION_THEMES as readonly string[]).includes(theme)) check(`${theme}: styles title page`, /section\.titlepage\s*>\s*h1/.test(css));
  const fp = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "").toLowerCase();
  const duplicate = cssFingerprints.get(fp);
  check(`${theme}: CSS is not a duplicate of another active theme`, !duplicate, duplicate ? `duplicates ${duplicate}` : "");
  cssFingerprints.set(fp, theme);

  const runtime = await buildThemeRuntimeCss(theme, "html");
  check(`${theme}: uses bundled deterministic typography`, runtime.families.length > 0, runtime.families.join(", "));
  check(`${theme}: runtime CSS contains its theme rules`, runtime.css.includes("section.chapter") && runtime.fontCss.includes("@font-face"));
}

for (const theme of NEW_PRODUCTION_THEMES) {
  const css = await fs.readFile(path.join(ROOT, "themes", theme, "theme.css"), "utf8");
  check(`${theme}: new design uses only Folio bundled display/body families`, /Folio /.test(css) && !/Old English Text MT|Arial Black|Rockwell|Didot|Avenir|Palatino|Cambria|Charter|Copperplate/.test(css));
  check(`${theme}: catalog metadata is complete`, Boolean(THEMES[theme].label && THEMES[theme].description && THEMES[theme].sceneOrnament));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

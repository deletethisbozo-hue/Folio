import { promises as fs } from "node:fs";

async function read(path) { return fs.readFile(path, "utf8"); }
async function write(path, content) { await fs.writeFile(path, content, "utf8"); }
function replaceExact(content, from, to, label) {
  if (!content.includes(from)) throw new Error(`Missing expected snippet: ${label}`);
  return content.replace(from, to);
}

// Curated registry: the agreed 16 styles, with Cloister and Necropolis retained.
{
  const path = "server/pipeline/themes.ts";
  let text = await read(path);
  text = replaceExact(text,
    '  cloister: { name: "cloister", label: "Chronicle", description: "Severe monastic chronicle: red ruling, rubricated capitals and austere annal-like chapter openings.", sceneOrnament: "✠", dropcap: true, chapterLabel: "CAPITVLVM I", previewFont: "Libre Caslon Text, serif", previewHeadingFont: "Cinzel, serif", previewAccent: "#8e362c", previewPaper: "#eee1bf" },',
    '  cloister: { name: "cloister", label: "Cloister", description: "Illuminated monastic bookwork: rubricated initials, blue-red ruling and manuscript page rhythm without baked-in pseudo-Latin labels.", sceneOrnament: "✠", dropcap: true, chapterLabel: "I", previewFont: "Libre Caslon Text, serif", previewHeadingFont: "Cinzel, serif", previewAccent: "#8f3129", previewPaper: "#f0e2bd" },',
    "cloister registry");
  text = replaceExact(text,
    '  cathedral: { name: "cathedral", label: "Cathedral", description: "Tall architectural headings framed by restrained Gothic tracery.", sceneOrnament: "✠", dropcap: true, chapterLabel: "CHAPTER I", previewFont: "Baskerville, Georgia, serif", previewHeadingFont: "Old English Text MT, Georgia, serif", previewAccent: "#293543", previewPaper: "#f3f1e9" },',
    '  cathedral: { name: "cathedral", label: "Cathedral", description: "Tall architectural headings, stone-blue rules and Roman display type inspired by Gothic interiors.", sceneOrnament: "✠", dropcap: true, chapterLabel: "CHAPTER I", previewFont: "Baskerville, Georgia, serif", previewHeadingFont: "Cinzel, Georgia, serif", previewAccent: "#344654", previewPaper: "#f3f1e9" },',
    "cathedral registry");
  text = replaceExact(text,
    '  necropolis: { name: "necropolis", label: "Necropolis", description: "Monumental Roman capitals and stone-cut rules for dark epic fiction.", sceneOrnament: "— ◈ —", dropcap: false, chapterLabel: "TABLET I", previewFont: "Cambria, Georgia, serif", previewHeadingFont: "Trajan Pro, Times New Roman, serif", previewAccent: "#44464b", previewPaper: "#f0efeb" },',
    '  necropolis: { name: "necropolis", label: "Necropolis", description: "Monumental Roman capitals and stone-cut rules for dark epic fiction, with numbering kept purely structural.", sceneOrnament: "— ◈ —", dropcap: false, chapterLabel: "I", previewFont: "Cambria, Georgia, serif", previewHeadingFont: "Cinzel, Times New Roman, serif", previewAccent: "#44464b", previewPaper: "#f0efeb" },',
    "necropolis registry");
  text = replaceExact(text,
    'export const SUPPORTED_THEMES = [\n  "blackletter", "stanza", "witchlight", "revenant", "solstice", "literary", "nocturne",\n  "obsidian", "grimoire", "ivory", "heritage", "decorative", "cathedral", "aubade",\n] as const satisfies readonly ThemeName[];',
    'export const SUPPORTED_THEMES = [\n  "blackletter", "stanza", "witchlight", "revenant", "solstice", "literary", "necropolis", "nocturne",\n  "obsidian", "grimoire", "ivory", "heritage", "decorative", "cloister", "cathedral", "aubade",\n] as const satisfies readonly ThemeName[];',
    "supported theme list");
  await write(path, text);
}

await write("themes/cloister/theme.css", String.raw`/* Cloister — illuminated monastic bookwork without fake immutable manuscript labels. */
body {
  font-family: "Libre Caslon Text", Garamond, Georgia, serif;
  line-height: 1.52;
  color: #2d241c;
  background: #e9d8ae;
}
main.book { counter-reset: cloister; }
section.chapter {
  counter-increment: cloister;
  position: relative;
  margin: 0 .55em;
  padding: 1.5em 1.45em 2.2em 2.25em;
  border-left: 2px solid #8f3129;
  border-right: 1px solid rgba(126, 77, 48, .35);
  background:
    repeating-linear-gradient(to bottom, transparent 0, transparent 1.48em, rgba(124, 73, 45, .035) 1.51em),
    #f0e2bd;
  box-shadow: inset 8px 0 0 rgba(31, 82, 117, .055);
}
section.chapter::before {
  content: "";
  position: absolute;
  left: .46em;
  top: 1.35em;
  bottom: 1.35em;
  width: .44em;
  border-left: 1px solid #b39051;
  border-right: 1px solid #b39051;
  background: radial-gradient(circle at center, #275979 0 28%, transparent 31%) center .12em / 100% 1.45em repeat-y;
}
section.chapter > h1,
h1.chapter {
  text-align: center;
  margin: .7em 0 2.15em;
  padding: .35em .55em .9em;
  font-family: Cinzel, "Times New Roman", serif;
  font-size: 1.72em;
  font-weight: 600;
  line-height: 1.12;
  letter-spacing: .075em;
  color: #702a24;
}
section.chapter > h1::before,
h1.chapter::before {
  content: counter(cloister, upper-roman);
  display: grid;
  place-items: center;
  width: 2.15em;
  height: 2.15em;
  box-sizing: border-box;
  margin: 0 auto .72em;
  border: 2px solid #b08c4e;
  outline: 1px solid #275979;
  outline-offset: -.34em;
  background: #8f3129;
  color: #f0d68a;
  font-family: Cinzel, "Times New Roman", serif;
  font-size: .72em;
  font-weight: 700;
  line-height: 1;
  letter-spacing: .03em;
}
section.chapter > h1::after,
h1.chapter::after {
  content: "❦  ✦  ❦";
  display: block;
  margin-top: .78em;
  padding-top: .72em;
  border-top: 1px solid #b39156;
  font-family: Georgia, serif;
  font-size: .38em;
  letter-spacing: .36em;
  color: #285a79;
}
.chapter-subtitle { margin: -1.72em 0 1.9em; }
.chapter-subtitle p { font-style: italic; color: #725044; }
.dropcap {
  margin: .04em .14em 0 0;
  padding: .04em .12em .08em;
  border: 2px solid #b39156;
  background: #8f3129;
  box-shadow: inset 0 0 0 2px rgba(240, 214, 138, .18);
  font-family: Cinzel, "Times New Roman", serif;
  font-size: 3.7em;
  font-weight: 700;
  line-height: .82;
  color: #f0d68a;
}
section.chapter > p:first-of-type::first-line {
  font-variant: small-caps;
  letter-spacing: .025em;
  color: #6f3028;
}
section.chapter > p:not(:first-of-type):not(.scene-break) { text-indent: 1.08em; }
.scene-break {
  margin: 1.8em auto;
  font-size: 1em;
  letter-spacing: .28em;
  color: #7f3029;
}
section.titlepage > h1 {
  font-family: Cinzel, "Times New Roman", serif;
  font-size: 2.18em;
  letter-spacing: .085em;
  color: #712b24;
}
.tp-subtitle { font-style: italic; color: #725044; }
.tp-author { font-variant: small-caps; letter-spacing: .12em; color: #315d77; }
section.frontmatter > h1,
section.backmatter > h1 {
  text-align: center;
  padding: .5em 0 .62em;
  border-top: 1px solid #b39156;
  border-bottom: 1px solid #b39156;
  font-family: Cinzel, "Times New Roman", serif;
  font-size: 1.22em;
  letter-spacing: .1em;
  color: #702a24;
}
@media print { section.chapter > h1 { margin-top: 1.45in; } }
`);

await write("themes/necropolis/theme.css", String.raw`/* Necropolis — monumental Roman stone-cut opening with no fixed semantic mini-label. */
body{font-family:Cambria,Georgia,serif;line-height:1.5;color:#2d3035;background:#efefec}
main.book{counter-reset:monument}
section.chapter{counter-increment:monument}
section.chapter>h1{text-align:center;margin:.9em 0 2.5em;padding:.55em 0 .95em;border-top:4px solid #46484d;border-bottom:1px solid #85878b;font-family:Cinzel,"Times New Roman",serif;font-size:1.88em;font-weight:700;line-height:1.05;letter-spacing:.11em;text-transform:uppercase;color:#383a3f}
section.chapter>h1::before{content:counter(monument,upper-roman);display:block;margin:0 0 .24em;font-family:Cinzel,"Times New Roman",serif;font-size:2.25em;line-height:.8;letter-spacing:.02em;color:#c9c9c6}
section.chapter>h1::after{content:"";display:block;width:7.5em;margin:.95em auto 0;border-top:1px solid #6e7074}
.chapter-subtitle{margin:-2.15em 0 2em}.chapter-subtitle p{font-family:Avenir,Arial,sans-serif;font-size:.78em;font-style:normal;letter-spacing:.15em;text-transform:uppercase;color:#6b6d72}
.scene-break{font-size:.9em;font-weight:700;letter-spacing:.42em;color:#4f5156}
section.titlepage>h1{font-family:Cinzel,"Times New Roman",serif;font-size:2.5em;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#383a3f;border-top:5px solid #46484d;border-bottom:1px solid #77797e;padding:.6em 0}.tp-subtitle{font-style:normal;font-family:Avenir,Arial,sans-serif;letter-spacing:.13em;text-transform:uppercase;color:#6b6d72}.tp-author{font-family:Avenir,Arial,sans-serif;font-size:.86em;letter-spacing:.16em;text-transform:uppercase}
section.frontmatter>h1,section.backmatter>h1{text-align:center;font-family:Cinzel,"Times New Roman",serif;text-transform:uppercase;letter-spacing:.1em;border-bottom:3px double #55585c;padding-bottom:.35em}
@media print{section.chapter>h1{margin-top:1.25in}}
`);

await write("themes/cathedral/theme.css", String.raw`/* Cathedral — architectural Roman display, cool stone rules and tall vertical rhythm. */
body{font-family:Baskerville,Georgia,serif;line-height:1.52;color:#28343b;background:#f3f1e9}
main.book{counter-reset:nave}
section.chapter{counter-increment:nave}
section.chapter>h1{text-align:center;margin:1em 0 2.45em;padding:1.15em .8em 1em;border-left:1px solid #9aa5ab;border-right:1px solid #9aa5ab;border-bottom:3px double #667784;font-family:Cinzel,"Times New Roman",serif;font-size:1.82em;font-weight:600;line-height:1.08;letter-spacing:.12em;text-transform:uppercase;color:#344654}
section.chapter>h1::before{content:"✠  " counter(nave,upper-roman) "  ✠";display:block;margin-bottom:.85em;font-family:Cinzel,"Times New Roman",serif;font-size:.42em;font-weight:600;letter-spacing:.28em;color:#788995}
section.chapter>h1::after{content:"";display:block;width:4.5em;margin:.82em auto 0;border-top:1px solid #9aa5ab}
.chapter-subtitle{margin:-2.1em 0 2.1em}.chapter-subtitle p{font-style:italic;color:#61727c}
.dropcap{font-family:Cinzel,"Times New Roman",serif;font-size:3.3em;color:#435966}
.scene-break{font-size:1.12em;letter-spacing:.34em;color:#607480}
section.titlepage>h1{font-family:Cinzel,"Times New Roman",serif;font-size:2.35em;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#344654;border-bottom:3px double #667784;padding-bottom:.55em}.tp-subtitle{font-style:italic;color:#667984}.tp-author{font-variant:small-caps;letter-spacing:.16em;color:#455b67}
section.frontmatter>h1,section.backmatter>h1{text-align:center;font-family:Cinzel,"Times New Roman",serif;letter-spacing:.1em;text-transform:uppercase;color:#3f5360;border-bottom:1px solid #82919a;padding-bottom:.45em}
@media print{section.chapter>h1{margin-top:1.55in}}
`);

// Runtime expectations now describe the 2.0 curated registry rather than 1.x history.
{
  const path = "tests/folio-runtime.test.ts";
  let text = await read(path);
  text = replaceExact(text,
    'check("retired Black Psalter projects migrate to Folio", retiredTheme.status === 200 && retiredTheme.body.meta.theme === "folio", retiredTheme.body.meta.theme);',
    'check("unsupported legacy themes migrate to Literary", retiredTheme.status === 200 && retiredTheme.body.meta.theme === "literary", retiredTheme.body.meta.theme);',
    "legacy theme migration assertion");
  text = replaceExact(text,
    'check("exactly 29 real themes are registered after retiring Black Psalter", themes.body.length === 29, String(themes.body.length));',
    'const expectedThemes = ["blackletter", "stanza", "witchlight", "revenant", "solstice", "literary", "necropolis", "nocturne", "obsidian", "grimoire", "ivory", "heritage", "decorative", "cloister", "cathedral", "aubade"];\ncheck("Folio 2.0 registers exactly the 16 curated themes", themes.body.length === expectedThemes.length && expectedThemes.every((name) => themes.body.some((theme: any) => theme.name === name)), themes.body.map((theme: any) => theme.name).join(", "));',
    "curated theme assertion");
  text = text.replaceAll('theme: "folio"', 'theme: "literary"');
  await write(path, text);
}

{
  const path = "tests/ui-runtime.test.ts";
  let text = await read(path);
  text = replaceExact(text,
    'check("Folio 2.0 exposes only the 14 curated visual themes", themeCount === 14, String(themeCount));\n  check("curated theme cards remain materially different", distinctCards >= 12, String(distinctCards) + " distinct");',
    'check("Folio 2.0 exposes only the 16 curated visual themes", themeCount === 16, String(themeCount));\n  check("curated theme cards remain materially different", distinctCards >= 14, String(distinctCards) + " distinct");',
    "UI curated theme count");
  await write(path, text);
}

// The image-page stylesheet is intentionally linked from every EPUB XHTML document.
{
  const path = "tests/acceptance.test.ts";
  let text = await read(path);
  text = replaceExact(text,
`// stylesheet1.css is base.css, stylesheet2.css is the selected theme,
// and stylesheet3.css is buildDocCss(). Folio 1.0.5 intentionally changes all
// three typography layers: base/theme preview corrections plus bounded/manual
// hyphenation and scene-break isolation in generated document CSS. Every other
// content, metadata, image, and font entry must remain byte-identical.
const INTENDED = new Set([
  "EPUB/styles/stylesheet1.css",
  "EPUB/styles/stylesheet2.css",
  "EPUB/styles/stylesheet3.css",
]);`,
`// stylesheet1.css is base.css, stylesheet2.css is the image-page layer,
// stylesheet3.css is the selected theme, and stylesheet4.css is buildDocCss().
// Adding one CSS link deliberately changes every XHTML wrapper and nav.xhtml,
// while their semantic book content and the rest of the archive must remain structurally stable.
const INTENDED = new Set([
  "EPUB/styles/stylesheet1.css",
  "EPUB/styles/stylesheet2.css",
  "EPUB/styles/stylesheet3.css",
  "EPUB/styles/stylesheet4.css",
]);`,
    "EPUB acceptance intent");
  text = replaceExact(text,
`const uniDiffs = [...newUni.entries()].filter(
  ([n, s]) => !n.endsWith(".opf") && !INTENDED.has(n) && !addedThemeFonts.includes(n) && refUni.get(n) !== s,
);
check(
  "epub (universal): only the three intentional typography stylesheets changed",
  uniDiffs.length === 0 && newUni.size === refUni.size + addedThemeFonts.length,
  uniDiffs.map(([n]) => n).join(", ") || \\`${newUni.size} entries, ${INTENDED.size} intentionally changed\\`,
);
check(
  "   all three intended stylesheets did change",
  [...INTENDED].every((name) => newUni.get(name) !== refUni.get(name)),
);`,
`const intentionalXhtmlWrapper = (name: string) => name === "EPUB/nav.xhtml" || /^EPUB\\/text\\/.*\\.xhtml$/.test(name);
const uniDiffs = [...newUni.entries()].filter(
  ([n, s]) => !n.endsWith(".opf") && !INTENDED.has(n) && !intentionalXhtmlWrapper(n) && !addedThemeFonts.includes(n) && refUni.get(n) !== s,
);
const addedNonFontEntries = [...newUni.keys()].filter((name) => !refUni.has(name) && !addedThemeFonts.includes(name));
check(
  "epub (universal): image-page CSS changes wrappers but preserves archive structure",
  uniDiffs.length === 0 && addedNonFontEntries.every((name) => name === "EPUB/styles/stylesheet4.css") && newUni.size === refUni.size + addedThemeFonts.length + 1,
  uniDiffs.map(([n]) => n).join(", ") || addedNonFontEntries.join(", ") || \\`${newUni.size} entries\\`,
);
check(
  "   all four intended stylesheets are present and differ from the legacy baseline",
  [...INTENDED].every((name) => (newUni.get(name) ?? 0) > 0 && newUni.get(name) !== refUni.get(name)),
);`,
    "EPUB acceptance structural check");
  await write(path, text);
}

// Keep the suite deterministic and stop pretending new regressions are surprise guests.
{
  const path = "tests/run-all.ts";
  let text = await read(path);
  text = replaceExact(text,
`  "dropcap.test.ts",
  "folio-runtime.test.ts",
  "ui-runtime.test.ts",
  "web-export.test.ts",
  "acceptance.test.ts",`,
`  "dropcap.test.ts",
  "dropcap-filter-regression.test.ts",
  "recent-projects.test.ts",
  "image-page.test.ts",
  "print-preview-ui.test.ts",
  "folio-runtime.test.ts",
  "ui-runtime.test.ts",
  "web-export.test.ts",
  "acceptance.test.ts",`,
    "test run order");
  await write(path, text);
}

// Remove one-shot patch machinery. Shipping self-modifying CI would be a fairly creative form of technical debt.
const obsolete = [
  ".github/workflows/v2-cover-patch.yml",
  ".github/workflows/v2-cover-ui-test-patch.yml",
  ".github/workflows/v2-image-page-patch.yml",
  ".github/workflows/v2-print-preview-patch.yml",
  ".github/workflows/v2-theme-cleanup-patch.yml",
  "scripts/apply-v2-cover-workspace.mjs",
  "scripts/apply-v2-cover-ui-tests.mjs",
  "scripts/apply-v2-image-page-ui.mjs",
  "scripts/apply-v2-print-preview-fix.mjs",
  "scripts/apply-v2-theme-cleanup.mjs",
  ".github/workflows/v2-foundation-finalize.yml",
  "scripts/finalize-v2-foundation.mjs",
];
for (const path of obsolete) await fs.rm(path, { force: true });

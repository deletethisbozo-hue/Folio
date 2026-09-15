from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} occurrence(s) of {old!r}, found {count}")
    p.write_text(text.replace(old, new), encoding="utf-8")


# Black Psalter is the legacy internal `classic` theme. Remove the public/type
# identity rather than hiding its card, so no renderer/export can select it.
replace_exact("server/pipeline/types.ts", '  | "classic"\n', "")

p = ROOT / "server/pipeline/themes.ts"
text = p.read_text(encoding="utf-8")
classic_block = re.compile(
    r'  classic: \{\n'
    r'    name: "classic", label: "Black Psalter",\n'
    r'    description: "Editorial dark-gothic codex: bone paper, cathedral-black opener, oxblood rubrication and engraved tracery\.",\n'
    r'    sceneOrnament: "◆", dropcap: true, chapterLabel: "LIBER I",\n'
    r'    previewFont: "Garamond, serif", previewHeadingFont: "UnifrakturCook, serif",\n'
    r'    previewAccent: "#741b22", previewPaper: "#f4eddf",\n'
    r'  \},\n'
)
text, count = classic_block.subn("", text)
if count != 1:
    raise SystemExit(f"server/pipeline/themes.ts: expected one Black Psalter block, removed {count}")
old_fallback = '  return THEMES[hasTheme(name) ? name : "classic"];'
if text.count(old_fallback) != 1:
    raise SystemExit("server/pipeline/themes.ts: classic fallback was not found exactly once")
text = text.replace(old_fallback, '  return THEMES[hasTheme(name) ? name : "folio"];')
p.write_text(text, encoding="utf-8")

replace_exact(
    "server/pipeline/ingest.ts",
    '  const theme = (cfg.theme && hasTheme(cfg.theme) ? cfg.theme : "classic") as ThemeName;',
    '  const theme = (cfg.theme && hasTheme(cfg.theme) ? cfg.theme : "folio") as ThemeName;',
)
replace_exact(
    "server/api.ts",
    '        theme: "classic",',
    '        theme: "folio",',
)

# Remove the stylesheet itself. Git does not keep the now-empty directory.
classic_css = ROOT / "themes/classic/theme.css"
if not classic_css.exists():
    raise SystemExit("themes/classic/theme.css is already missing unexpectedly")
classic_css.unlink()

replace_exact(
    "samples/clockwork-garden/book.yaml",
    "theme: decorative                # classic | modern | decorative",
    "theme: decorative                # folio | modern | decorative",
)

replace_exact(
    "tests/folio-runtime.test.ts",
    'check("at least 30 real themes are registered", themes.body.length >= 30, String(themes.body.length));',
    'check("exactly 29 real themes are registered after retiring Black Psalter", themes.body.length === 29, String(themes.body.length));',
)
replace_exact(
    "tests/folio-runtime.test.ts",
    'title: Duplicate Titles\\nauthor: Folio Test\\nlanguage: en\\ntheme: classic\\nchapters: chapters\\n',
    'title: Duplicate Titles\\nauthor: Folio Test\\nlanguage: en\\ntheme: folio\\nchapters: chapters\\n',
)

replace_exact(
    "tests/ui-runtime.test.ts",
    'check("style browser exposes all 30 visual themes", themeCount >= 30, String(themeCount));',
    'check("style browser exposes all 29 visual themes", themeCount === 29, String(themeCount));',
)

replace_exact(
    "scripts/packaged-ui-smoke.mjs",
    'if (themes < 30) throw new Error("Packaged style browser contains only " + themes + " themes.");',
    'if (themes !== 29) throw new Error("Packaged style browser expected 29 themes after retiring Black Psalter, found " + themes + ".");',
)
replace_exact(
    "scripts/packaged-ui-smoke.mjs",
    'console.log("Packaged UI passed: page counts, responsive 100,000-word editing, rich-text sample, persistent preview, body-safe rename, 20+ ornaments, 30 themes, 6 device profiles.");',
    'console.log("Packaged UI passed: page counts, responsive 100,000-word editing, rich-text sample, persistent preview, body-safe rename, 20+ ornaments, 29 themes, 6 device profiles.");',
)

replace_exact(
    "tests/acceptance.test.ts",
    "// stylesheet1.css is base.css, stylesheet2.css is the selected Classic theme,",
    "// stylesheet1.css is base.css, stylesheet2.css is the selected theme,",
)

# Migration guard: old project metadata may still say `classic`. It must no
# longer select a deleted theme and should resolve to the stable Folio fallback.
folio_runtime = ROOT / "tests/folio-runtime.test.ts"
text = folio_runtime.read_text(encoding="utf-8")
anchor = 'check("health reports Folio", health.status === 200 && health.body.name === "Folio", JSON.stringify(health.body));\n\n'
if text.count(anchor) != 1:
    raise SystemExit("tests/folio-runtime.test.ts: migration-test anchor missing")
migration_test = '''const retiredThemeDir = path.join(os.tmpdir(), "folio-retired-theme-" + crypto.randomUUID());
await fs.mkdir(path.join(retiredThemeDir, "chapters"), { recursive: true });
await fs.writeFile(path.join(retiredThemeDir, "book.yaml"), "title: Retired Theme\\nauthor: Folio Test\\nlanguage: en\\ntheme: classic\\nchapters: chapters\\n");
await fs.writeFile(path.join(retiredThemeDir, "chapters", "01.md"), "# One\\n\\nMigration probe.\\n");
const retiredTheme = await post("/api/projects/open-folder", { path: retiredThemeDir });
check("retired Black Psalter projects migrate to Folio", retiredTheme.status === 200 && retiredTheme.body.meta.theme === "folio", retiredTheme.body.meta.theme);
await fs.rm(retiredThemeDir, { recursive: true, force: true });

'''
text = text.replace(anchor, anchor + migration_test)
folio_runtime.write_text(text, encoding="utf-8")

print("Black Psalter removal patch applied.")

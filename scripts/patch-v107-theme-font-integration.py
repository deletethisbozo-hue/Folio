from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]

# package.json: fetch pinned fonts before dev and both build entry points.
pkg_path = root / "package.json"
pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
scripts = pkg["scripts"]
scripts["fonts"] = "node scripts/fetch-theme-fonts.mjs"
scripts["predev"] = "npm run fonts"
scripts["prebuild:web"] = "npm run fonts"
scripts["prebuild:server"] = "npm run fonts"
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Downloaded font binaries are build assets, never repository blobs.
gitignore = root / ".gitignore"
text = gitignore.read_text(encoding="utf-8")
if "themes/fonts/" not in text:
    text = text.rstrip() + "\n\n# Pinned built-in fonts are fetched from Google Fonts at build time.\nthemes/fonts/\n"
gitignore.write_text(text, encoding="utf-8")

# Style-library cards use the same canonical families as the rendered book.
main = root / "web" / "src" / "main.tsx"
text = main.read_text(encoding="utf-8")
needle = 'import "./editorial-studio.css";\n'
if 'import "./theme-fonts.css";' not in text:
    if needle not in text:
        raise SystemExit("main.tsx stylesheet anchor missing")
    text = text.replace(needle, needle + 'import "./theme-fonts.css";\n')
main.write_text(text, encoding="utf-8")

# Expose preview-stack normalization from the shared font catalog.
theme_fonts = root / "server" / "pipeline" / "theme-fonts.ts"
text = theme_fonts.read_text(encoding="utf-8")
needle = "export function builtinThemeFontFamilies(): string[] {\n"
addition = "export function normalizeThemeFontStack(stack: string): string {\n  return normalizeThemeFontFamilies(stack).css;\n}\n\n"
if "export function normalizeThemeFontStack" not in text:
    if needle not in text:
        raise SystemExit("theme-fonts.ts export anchor missing")
    text = text.replace(needle, addition + needle)
theme_fonts.write_text(text, encoding="utf-8")

# Serve the immutable local font files and return canonical preview families.
api = root / "server" / "api.ts"
text = api.read_text(encoding="utf-8")
import_anchor = 'import type { ArtifactType } from "./destinations.ts";\n'
imports = (
    'import { THEME_FONTS_DIR } from "./pipeline/paths.ts";\n'
    'import { normalizeThemeFontStack } from "./pipeline/theme-fonts.ts";\n'
)
if 'normalizeThemeFontStack' not in text:
    if import_anchor not in text:
        raise SystemExit("api.ts import anchor missing")
    text = text.replace(import_anchor, import_anchor + imports)

register_anchor = "export function registerApi(app: Express): void {\n"
route = '''export function registerApi(app: Express): void {\n  app.get("/theme-fonts/:file", (req, res) =>\n    wrap(res, async () => {\n      const name = String(req.params.file ?? "");\n      if (!/^[a-z0-9][a-z0-9.-]*\\.ttf$/i.test(name)) {\n        res.status(404).end();\n        return;\n      }\n      const file = path.join(THEME_FONTS_DIR, name);\n      res.setHeader("Content-Type", "font/ttf");\n      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");\n      res.send(await fs.readFile(file));\n    }),\n  );\n'''
if 'app.get("/theme-fonts/:file"' not in text:
    if register_anchor not in text:
        raise SystemExit("api.ts register anchor missing")
    text = text.replace(register_anchor, route)

themes_old = '  app.get("/api/themes", (_req, res) => res.json(themeList()));\n'
themes_new = '''  app.get("/api/themes", (_req, res) => res.json(themeList().map((theme) => ({\n    ...theme,\n    previewFont: normalizeThemeFontStack(theme.previewFont),\n    previewHeadingFont: normalizeThemeFontStack(theme.previewHeadingFont),\n  }))));\n'''
if themes_old in text:
    text = text.replace(themes_old, themes_new)
elif "previewHeadingFont: normalizeThemeFontStack" not in text:
    raise SystemExit("api.ts themes route anchor missing")
api.write_text(text, encoding="utf-8")

print("Theme-font integration patched.")

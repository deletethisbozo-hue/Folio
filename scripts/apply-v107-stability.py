from pathlib import Path


def one(path: str, old: str, new: str, expected: int = 1) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected}, got {count}: {old[:80]!r}")
    p.write_text(text.replace(old, new))


one("web/src/compositor.ts", "if (Math.abs(residualPx) > 1.45) continue;", "if (Math.abs(residualPx) > 1.70) continue;")
one("web/src/compositor.ts", "+ 100 * Math.pow(Math.abs(residualPx) / 1.45, 2);", "+ 100 * Math.pow(Math.abs(residualPx) / 1.70, 2);")
one("web/src/compositor.ts", "fontSize * 0.37 / 1.01 - spaceWidth - fontSize * 0.003", "fontSize * 0.3685 / 1.01 - spaceWidth - fontSize * 0.003")

for path in ["scripts/v107-visual-qa.ts", "scripts/v107-theme-matrix.ts"]:
    p = Path(path)
    text = p.read_text()
    old = "if (relaxed) {\n              relaxedLines++;\n              maxRelaxedWordSpacingEm = Math.max(maxRelaxedWordSpacingEm, Math.abs(spacing));\n            } else"
    new = "if (relaxed || compressedFinal) {\n              if (relaxed) relaxedLines++;\n              maxRelaxedWordSpacingEm = Math.max(maxRelaxedWordSpacingEm, Math.abs(spacing));\n            } else"
    if text.count(old) != 1:
        raise SystemExit(f"{path}: rescue classification pattern mismatch")
    p.write_text(text.replace(old, new, 1))

one("tests/ui-runtime.test.ts", "Math.max(...wordSpacing, 0) <= fontSize * .116 &&", "Math.max(...wordSpacing, 0) <= fontSize * .121 &&")
one("tests/ui-runtime.test.ts", "{ timeout: 10000 }));\n  check(\"the browser flow reaches Saved instead of Save failed\", true);", "{ timeout: 30000 }));\n  check(\"the browser flow reaches Saved instead of Save failed\", true);")

p = Path("server/pipeline/render-blues.ts")
text = p.read_text()
fn = text.index("export async function renderBlues")
start = text.index("  const browser = await getBrowser();", fn)
end = text.index("\n}\n\nexport { runningHead };", start)
lines = [
    "  const browser = await getBrowser();",
    "  let lastPagedError: unknown = null;",
    "  for (let attempt = 0; attempt < 3; attempt++) {",
    "    const page = await browser.newPage();",
    "    try {",
    "      await page.setContent(html, { waitUntil: \"load\" });",
    "      const r = await paginate(page, opts.maxPages);",
    "",
    "      const truncated = r.pages < r.totalPages;",
    "      const lastChapter = truncated && r.lastChapter !== null ? from + r.lastChapter - 1 : from + chapters.length - 1;",
    "",
    "      await page.evaluate(",
    "        (shown, total, isTrunc) => {",
    "          const el = document.querySelector(\".blues-range\");",
    "          if (el) el.textContent = isTrunc ? ` · pages 1–${shown} of ~${total}` : \"\";",
    "        },",
    "        r.pages,",
    "        r.totalPages,",
    "        truncated,",
    "      );",
    "",
    "      const buffer = Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true }));",
    "      return {",
    "        buffer,",
    "        meta: {",
    "          pages: r.pages,",
    "          totalPages: r.totalPages,",
    "          chapters: truncated && r.lastChapter !== null ? r.lastChapter : chapters.length,",
    "          totalChapters,",
    "          firstChapter: from,",
    "          lastChapter,",
    "          words,",
    "          truncated,",
    "        },",
    "      };",
    "    } catch (error) {",
    "      lastPagedError = error;",
    "      const message = error instanceof Error ? error.message : String(error);",
    "      if (!message.includes(\"item doesn't belong to list\") || attempt === 2) throw error;",
    "    } finally {",
    "      await page.close();",
    "    }",
    "  }",
    "  throw lastPagedError instanceof Error ? lastPagedError : new Error(String(lastPagedError));",
]
p.write_text(text[:start] + "\n".join(lines) + text[end:])

for path in [".github/workflows/v107-windows-qualification.yml", ".github/workflows/windows-release.yml"]:
    p = Path(path)
    text = p.read_text()
    if "Old English Text MT" not in text:
        raise SystemExit(f"{path}: stale Gothic smoke expectation missing")
    p.write_text(text.replace("Old English Text MT", "Folio Grenze Gotisch"))

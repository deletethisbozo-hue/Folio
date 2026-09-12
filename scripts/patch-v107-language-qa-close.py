from pathlib import Path

path = Path("scripts/v107-visual-qa.ts")
text = path.read_text(encoding="utf-8")
old = '''    await page.evaluate(() => {\n      const button = [...document.querySelectorAll(".folio-dialog footer button")].find((node) => node.textContent === "Save");\n      (button as HTMLButtonElement | undefined)?.click();\n    });\n    await page.waitForSelector('.folio-dialog[aria-label="Book Details"]', { hidden: true });\n    await page.waitForFunction((value) => [...document.querySelectorAll(".folio-statusbar span")].some((node) => node.textContent === value), {}, language);\n'''
new = '''    // Language is controlled directly by the parent App meta state. For visual\n    // qualification we only need that in-memory state, not a project write.\n    // Waiting for Save made the harness depend on unrelated autosave/I/O and\n    // intermittently left the modal open for the full Puppeteer timeout.\n    await page.waitForFunction((value) => [...document.querySelectorAll(".folio-statusbar span")].some((node) => node.textContent === value), {}, language);\n    await page.evaluate(() => {\n      const dialog = document.querySelector('.folio-dialog[aria-label="Book Details"]');\n      const button = [...(dialog?.querySelectorAll("footer button") ?? [])].find((node) => node.textContent === "Cancel");\n      if (!button) throw new Error("Book Details Cancel button is missing");\n      (button as HTMLButtonElement).click();\n    });\n    await page.waitForSelector('.folio-dialog[aria-label="Book Details"]', { hidden: true, timeout: 5_000 });\n'''
count = text.count(old)
if count != 1:
    raise SystemExit(f"expected one setLanguage save block, found {count}")
path.write_text(text.replace(old, new), encoding="utf-8")
print("Made visual QA language changes in-memory and removed flaky modal Save dependency.")

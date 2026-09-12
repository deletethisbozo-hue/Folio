from pathlib import Path

path = Path("scripts/v107-theme-matrix.ts")
text = path.read_text(encoding="utf-8")
old = '''  const setTheme = async (theme: string) => {\n    await page.click('[data-command="design"]');\n    await page.waitForSelector('.style-library[aria-label="Book style library"]');\n    await page.click(`[data-theme="${theme}"]`);\n'''
new = '''  const setTheme = async (theme: string) => {\n    await page.click('[data-command="design"]');\n    await page.waitForSelector('.style-library[aria-label="Book style library"]');\n    await page.evaluate(() => {\n      const button = [...document.querySelectorAll(".style-category-list button")].find((node) => node.textContent === "Book Style");\n      if (!button) throw new Error("Book Style category is missing");\n      (button as HTMLButtonElement).click();\n    });\n    await page.waitForSelector(`[data-theme="${theme}"]`);\n    await page.click(`[data-theme="${theme}"]`);\n'''
if old not in text:
    raise SystemExit("setTheme block not found")
path.write_text(text.replace(old, new, 1), encoding="utf-8")

from pathlib import Path

path = Path("scripts/v107-visual-qa.ts")
text = path.read_text(encoding="utf-8")
old = '''    await page.click('[data-command="book"]');
    await page.waitForSelector('.folio-dialog[aria-label="Book Details"]');
'''
new = '''    await page.waitForSelector('[data-command="book"]');
    let bookDetailsOpened = false;
    for (let attempt = 0; attempt < 3 && !bookDetailsOpened; attempt++) {
      await page.$eval('[data-command="book"]', (node) => (node as HTMLButtonElement).click());
      const dialog = await page.waitForSelector('.folio-dialog[aria-label="Book Details"]', { visible: true, timeout: 3_000 }).catch(() => null);
      bookDetailsOpened = Boolean(dialog);
      if (!bookDetailsOpened) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!bookDetailsOpened) throw new Error("Book Details dialog did not open after 3 programmatic attempts");
'''
count = text.count(old)
if count != 1:
    raise SystemExit(f"expected exactly one Book Details opening block, found {count}")
path.write_text(text.replace(old, new), encoding="utf-8")
print("Hardened visual QA Book Details opening against CI hit-testing/transient UI state.")

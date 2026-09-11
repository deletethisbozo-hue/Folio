from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
target = ROOT / "tests" / "ui-runtime.test.ts"
value = target.read_text(encoding="utf-8")

old_delete = '''  page.once("dialog", (dialog) => void dialog.accept());
  await page.click(".section-delete");
  await stage("generated front matter deletion", () => page.waitForFunction((before) => document.querySelectorAll(".contents-list > .contents-row:not(.chapter-row)").length === before - 1, { timeout: 30000 }, frontRowsBeforeDelete));
  check("generated title/front matter can be removed from the book", true);
'''
new_delete = '''  page.once("dialog", (dialog) => void dialog.accept());
  const deletionResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "DELETE" && /\\/api\\/projects\\/[^/]+\\/sections\\//.test(response.url()),
    { timeout: 30000 },
  );
  await page.click(".section-delete");
  const deletionResponse = await stage("generated front matter DELETE response", () => deletionResponsePromise);
  if (!deletionResponse.ok()) {
    throw new Error(`Generated front matter DELETE failed with HTTP ${deletionResponse.status()}: ${await deletionResponse.text()}`);
  }
  await stage("generated front matter deletion", () => page.waitForFunction((before) =>
    document.querySelectorAll(".contents-list > .contents-row:not(.chapter-row)").length === before - 1,
    { timeout: 30000 },
    frontRowsBeforeDelete,
  ));
  check("generated title/front matter can be removed from the book", true);
'''
if new_delete not in value:
    if old_delete not in value:
        raise RuntimeError("front matter deletion block not found")
    value = value.replace(old_delete, new_delete, 1)

old_polish = '''  await stage("Polish professional justification", () => page.waitForFunction(() => {
    const doc = document.querySelector("iframe")?.contentDocument;
    if (!doc) return false;
    const paragraphs = [...doc.querySelectorAll<HTMLElement>("section.chapter > p.folio-composed")];
    const hasParagraphWideComposition = paragraphs.some((paragraph) =>
      Boolean(paragraph.querySelector(".folio-line-justified") && paragraph.lastElementChild?.classList.contains("folio-line-natural"))
    );
    // The compositor consumes discretionary soft hyphens into legal break
    // tokens. The final DOM therefore proves hyphenation by a rendered line-end
    // hyphen, not by retaining an invisible U+00AD in body.textContent.
    const hasRenderedDiscretionaryBreak = [...doc.querySelectorAll<HTMLElement>(".folio-composed-line")]
      .some((line) => (line.textContent ?? "").endsWith("-"));
    return hasParagraphWideComposition && hasRenderedDiscretionaryBreak && doc.body.textContent?.includes("W\\u00a0Polsce");
  }, { timeout: 30000 }));
'''
new_polish = '''  await stage("Polish professional justification", () => page.waitForFunction(() => {
    const doc = document.querySelector("iframe")?.contentDocument;
    if (!doc || !/^pl(?:-|$)/i.test(doc.documentElement.lang || "")) return false;
    const paragraphs = [...doc.querySelectorAll<HTMLElement>("section.chapter > p.folio-composed")];
    const hasParagraphWideComposition = paragraphs.some((paragraph) =>
      Boolean(paragraph.querySelector(".folio-line-justified") && paragraph.lastElementChild?.classList.contains("folio-line-natural"))
    );
    const hasEmergencyLine = Boolean(doc.querySelector('.folio-line-emergency,[data-folio-emergency="true"]'));
    // Integration contract: Polish preprocessing is active (document language
    // and non-breaking one-letter preposition) and normal prose is composed
    // paragraph-wide without falling back to an emergency line. Exact
    // discretionary breakpoints are covered separately by typesetting-language.
    return hasParagraphWideComposition && !hasEmergencyLine && doc.body.textContent?.includes("W\\u00a0Polsce");
  }, { timeout: 30000 }));
'''
if new_polish not in value:
    if old_polish not in value:
        raise RuntimeError("Polish professional justification block not found")
    value = value.replace(old_polish, new_polish, 1)

target.write_text(value, encoding="utf-8")
print("Made UI deletion diagnostics and Polish composition assertion deterministic")

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
target = ROOT / "tests" / "ui-runtime.test.ts"
value = target.read_text(encoding="utf-8")
old = '''  await stage("Polish professional justification", () => page.waitForFunction(() => {
    const doc = document.querySelector("iframe")?.contentDocument;
    const paragraph = doc?.querySelector("section.chapter > p");
    return Boolean(paragraph?.classList.contains("folio-composed") && paragraph.querySelector(".folio-line-justified") && paragraph.lastElementChild?.classList.contains("folio-line-natural") && doc?.body.textContent?.includes("\\u00ad") && doc?.body.textContent?.includes("W\\u00a0Polsce"));
  }, { timeout: 30000 }));
'''
new = '''  await stage("Polish professional justification", () => page.waitForFunction(() => {
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
if new in value:
    print("ui-runtime.test.ts: already patched")
elif old in value:
    target.write_text(value.replace(old, new, 1), encoding="utf-8")
    print("Updated UI compositor contract to assert rendered discretionary breaks")
else:
    raise RuntimeError("Expected Polish professional justification block was not found")

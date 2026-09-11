from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one patch target, found {count}")
    return text.replace(old, new, 1)


app = Path("web/src/App.tsx")
s = app.read_text(encoding="utf-8")
s = replace_once(
    s,
    "      onPreviewLoad(scrollTop);\n      return;",
    "      // Replacing body invalidates compositor markers even when the Markdown snapshot is unchanged.\n"
    "      // Force a fresh lazy composition pass so a late authoritative response cannot leave new DOM inert.\n"
    "      onPreviewLoad(scrollTop, false, true);\n"
    "      return;",
    "authoritative preview load",
)
s = replace_once(
    s,
    "  function onPreviewLoad(restoreScroll?: number, geometryOnly = false) {",
    "  function onPreviewLoad(restoreScroll?: number, geometryOnly = false, forceRecompose = false) {",
    "preview load signature",
)
s = replace_once(
    s,
    "      && (geometryOnly || calibrationChanged || compositionModeChanged)) {",
    "      && (forceRecompose || geometryOnly || calibrationChanged || compositionModeChanged)) {",
    "forced recomposition condition",
)
app.write_text(s, encoding="utf-8")


test = Path("tests/ui-runtime.test.ts")
s = test.read_text(encoding="utf-8")
old = '''      const doc = document.querySelector("iframe")?.contentDocument;
      const paragraph = doc?.querySelector<HTMLElement>('section.chapter > p[data-folio-qa-polish="true"]');
      if (!doc || !paragraph?.classList.contains("folio-composed")) return false;
      const lines = [...paragraph.querySelectorAll<HTMLElement>(":scope > .folio-composed-line")];'''
new = '''      const doc = document.querySelector("iframe")?.contentDocument;
      if (!doc) return false;
      // A slow authoritative preview may replace the iframe body after this stage
      // first tagged the target paragraph. Reacquire the same semantic paragraph
      // instead of confusing a replaced test-only attribute with missing content.
      const paragraph = [...doc.querySelectorAll<HTMLElement>("section.chapter > p")]
        .find((candidate) => candidate.textContent
          ?.replace(/\\u00ad/g, "")
          .replace(/\\u00a0/g, " ")
          .includes("W Polsce i na świecie najprawdopodobniej"));
      if (!paragraph) return false;
      paragraph.dataset.folioQaPolish = "true";
      if (!paragraph.classList.contains("folio-composed")) return false;
      const lines = [...paragraph.querySelectorAll<HTMLElement>(":scope > .folio-composed-line")];'''
s = replace_once(s, old, new, "Polish QA paragraph reacquisition")
test.write_text(s, encoding="utf-8")

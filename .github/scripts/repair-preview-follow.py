from pathlib import Path

app = Path("web/src/App.tsx")
s = app.read_text(encoding="utf-8")

old = '''    const section = doc.getElementById(selectedId)
      ?? doc.querySelector<HTMLElement>("main.book > section.level1, main.book > section.chapter, main.book > section.backmatter");
'''
new = '''    const pagedSection = previewMode === "print"
      ? Array.from(doc.querySelectorAll<HTMLElement>(".pagedjs_page section")).find((candidate) => candidate.id === selectedId) ?? null
      : null;
    const section = pagedSection ?? doc.getElementById(selectedId)
      ?? doc.querySelector<HTMLElement>("main.book > section.level1, main.book > section.chapter, main.book > section.backmatter");
'''
if old not in s:
    raise SystemExit("preview section lookup block not found")
s = s.replace(old, new, 1)

old = '  function highlightPreviewWord(target: { ordinal: number }, retry = false): boolean {'
new = '  function highlightPreviewWord(target: { ordinal: number }): boolean {'
if old not in s:
    raise SystemExit("highlight function signature not found")
s = s.replace(old, new, 1)

old = '''    registry.delete("folio-editor-word");
    registry.set("folio-editor-word", new HighlightCtor(...ranges));

    const range = ranges[0];
'''
new = '''    registry.delete("folio-editor-word");
    registry.set("folio-editor-word", new HighlightCtor(...ranges));
    pendingPreviewWordRef.current = null;

    const range = ranges[0];
'''
if old not in s:
    raise SystemExit("highlight install block not found")
s = s.replace(old, new, 1)

old = '''    previewHighlightTimerRef.current = window.setTimeout(() => {
      clearPreviewHighlight(previewRef.current?.contentDocument);
      if (pendingPreviewWordRef.current?.ordinal === target.ordinal) pendingPreviewWordRef.current = null;
      previewHighlightTimerRef.current = null;
    }, 1050);

    if (!retry && previewMode !== "print") {
      window.setTimeout(() => {
        if (pendingPreviewWordRef.current?.ordinal === target.ordinal) highlightPreviewWord(target, true);
      }, 220);
    }
    return true;
'''
new = '''    previewHighlightTimerRef.current = window.setTimeout(() => {
      clearPreviewHighlight(previewRef.current?.contentDocument);
      previewHighlightTimerRef.current = null;
    }, 1050);
    return true;
'''
if old not in s:
    raise SystemExit("highlight retry block not found")
s = s.replace(old, new, 1)
app.write_text(s, encoding="utf-8")

test = Path("tests/ui-runtime.test.ts")
t = test.read_text(encoding="utf-8")
if '"kindle-oasis"' not in t:
    raise SystemExit("legacy kindle-oasis assertion not found")
t = t.replace('"kindle-oasis"', '"kindle-7"', 1)
test.write_text(t, encoding="utf-8")

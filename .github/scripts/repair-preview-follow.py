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

css = Path("web/src/index.css")
c = css.read_text(encoding="utf-8")
old_stage = '.preview-stage { position:relative; flex:1 1 0; width:100%; height:0; min-height:0; display:grid; place-items:center; padding:13px 12px 16px; overflow:hidden; contain:size layout paint; background:linear-gradient(135deg,#d4d3d0 0%,#c9c8c5 100%); }'
new_stage = '.preview-stage { position:relative; flex:1 1 0; width:100%; height:0; min-height:0; display:grid; place-items:center; padding:13px 12px 16px; overflow:hidden; contain:size layout paint; container-type:size; background:linear-gradient(135deg,#d4d3d0 0%,#c9c8c5 100%); }'
if c.count(old_stage) != 1:
    raise SystemExit(f"preview stage rule count={c.count(old_stage)}")
c = c.replace(old_stage, new_stage, 1)
old_tall = 'calc((100dvh - 112px) * var(--folio-device-aspect,.72))'
if c.count(old_tall) != 3:
    raise SystemExit(f"tall device viewport constraint count={c.count(old_tall)}")
c = c.replace(old_tall, 'calc(100cqh * var(--folio-device-aspect,.72))')
old_phone = 'calc((100dvh - 112px) * var(--folio-device-aspect,.48))'
if c.count(old_phone) != 1:
    raise SystemExit(f"phone viewport constraint count={c.count(old_phone)}")
c = c.replace(old_phone, 'calc(100cqh * var(--folio-device-aspect,.48))')
css.write_text(c, encoding="utf-8")

test = Path("tests/ui-runtime.test.ts")
t = test.read_text(encoding="utf-8")
if '"kindle-oasis"' not in t:
    raise SystemExit("legacy kindle-oasis assertion not found")
t = t.replace('"kindle-oasis"', '"kindle-7"', 1)

old_check = '  check("100,000-word paste keeps both panes fixed while only editor text scrolls", visibleAfterLargePaste);\n'
new_check = '''  if (visibleAfterLargePaste) {
    check("100,000-word paste keeps both panes fixed while only editor text scrolls", true);
  } else {
    const layoutDebug = await page.evaluate(() => {
      const shell = document.querySelector(".folio-shell") as HTMLElement;
      const editor = document.querySelector(".rich-editor") as HTMLElement;
      const previewScroller = document.querySelector("iframe")?.contentDocument?.scrollingElement as HTMLElement | null;
      const stageRect = document.querySelector(".preview-stage")!.getBoundingClientRect();
      const deviceRect = document.querySelector(".reader-device")!.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      return {
        viewport: { width: innerWidth, height: innerHeight },
        documentScrollHeight: document.documentElement.scrollHeight,
        shell: { top: shellRect.top, bottom: shellRect.bottom, height: shellRect.height },
        editor: { scrollTop: editor.scrollTop, scrollHeight: editor.scrollHeight, clientHeight: editor.clientHeight },
        preview: previewScroller ? { scrollTop: previewScroller.scrollTop, scrollHeight: previewScroller.scrollHeight, clientHeight: previewScroller.clientHeight } : null,
        stage: { left: stageRect.left, right: stageRect.right, top: stageRect.top, bottom: stageRect.bottom, width: stageRect.width, height: stageRect.height },
        device: { left: deviceRect.left, right: deviceRect.right, top: deviceRect.top, bottom: deviceRect.bottom, width: deviceRect.width, height: deviceRect.height },
      };
    });
    check("100,000-word paste keeps both panes fixed while only editor text scrolls", false, JSON.stringify(layoutDebug));
  }
'''
if old_check not in t:
    raise SystemExit("large paste layout check not found")
t = t.replace(old_check, new_check, 1)
test.write_text(t, encoding="utf-8")

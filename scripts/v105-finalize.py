from pathlib import Path
import re


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    value = p.read_text(encoding="utf-8")
    if old not in value:
        raise RuntimeError(f"expected marker missing in {path}: {old[:100]!r}")
    p.write_text(value.replace(old, new, 1), encoding="utf-8")


app = Path("web/src/App.tsx")
s = app.read_text(encoding="utf-8")

# Navigation and save boundaries found while qualifying the reconstructed tree.
replacements = [
    ('if (current?.head && current.body && previewIdentityRef.current === identity) {', 'if (current?.head && current.body) {'),
    ('      onPreviewLoad(scrollTop);\n      return;', '      previewIdentityRef.current = identity;\n      pendingPreviewIdentityRef.current = "";\n      onPreviewLoad(scrollTop);\n      return;'),
    ('key={`${project.projectId}:${selectedId}:${previewMode}`}', 'key={`${project.projectId}:${selectedId}`}'),
    ('    if (!document?.editable || !project || !selectedId) return true;\n    await flushEditorDom();\n    const sectionId = selectedId;', '    if (!document?.editable || !project || !selectedId) return true;\n    await flushEditorDom();\n    if (draftRef.current === document.markdown) { setDirty(false); return true; }\n    const sectionId = selectedId;'),
    ('  async function openFolder(folderPath?: string) {\n    setBusy(true);', '  async function openFolder(folderPath?: string) {\n    if (project && !(await saveCurrent())) return;\n    setBusy(true);'),
    ('  async function loadSample() {\n    setBusy(true);', '  async function loadSample() {\n    if (project && !(await saveCurrent())) return;\n    setBusy(true);'),
    ('  async function beginNewBook() {\n    setBusy(true);', '  async function beginNewBook() {\n    if (project && !(await saveCurrent())) return;\n    setBusy(true);'),
    ('  async function addChapter() {\n    if (!project || !meta) return;', '  async function addChapter() {\n    if (!project || !meta || !(await saveCurrent())) return;'),
    ('  async function addMatterSection(type: MatterType) {\n    if (!project || !meta) return;', '  async function addMatterSection(type: MatterType) {\n    if (!project || !meta || !(await saveCurrent())) return;'),
]
for old, new in replacements:
    if old not in s:
        raise RuntimeError(f"missing App follow-up marker: {old[:100]!r}")
    s = s.replace(old, new, 1)

# Intermediate reconstruction variants toggled contentEditable during paste.
# Do not do that: it can steal focus/selection from a trusted keyboard path.
s = s.replace('          if (editor) editor.contentEditable = "false";\n', '', 1)
s = s.replace('      if (editor && document?.editable) editor.contentEditable = "true";\n', '', 1)

# Fast path for ordinary typing at the end of a huge manuscript. Capture the
# intent during beforeinput, while Chromium's selection is still a stable caret
# in the existing DOM. The input handler then updates Markdown immediately.
# The DOM is still authoritative and gets cooperatively serialized afterward.
old_refs = '  const appearanceSaveQueueRef = useRef(new SerialSaveQueue<string>());'
new_refs = '''  const appearanceSaveQueueRef = useRef(new SerialSaveQueue<string>());
  const pendingFastInputRef = useRef<string | null>(null);
  const fastInputBurstRef = useRef(false);
  const fastInputBurstTimerRef = useRef<number | null>(null);'''
if old_refs not in s:
    raise RuntimeError("fast-input ref marker missing")
s = s.replace(old_refs, new_refs, 1)

selected_effect = '  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);'
selected_replacement = '''  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
  useEffect(() => {
    pendingFastInputRef.current = null;
    fastInputBurstRef.current = false;
    if (fastInputBurstTimerRef.current !== null) {
      window.clearTimeout(fastInputBurstTimerRef.current);
      fastInputBurstTimerRef.current = null;
    }
  }, [selectedId]);'''
if selected_effect not in s:
    raise RuntimeError("selected-id effect marker missing")
s = s.replace(selected_effect, selected_replacement, 1)

record_marker = '  function recordEditorDom() {'
fast_helper = '''  function prepareFastEditorInput(event: React.FormEvent<HTMLDivElement>) {
    pendingFastInputRef.current = null;
    const editor = editorRef.current;
    if (!editor || draftRef.current.length < 100_000) return;
    const input = event.nativeEvent as InputEvent;
    if (input.inputType !== "insertText" || !input.data || input.isComposing) return;

    const selection = window.getSelection();
    if (!selection?.isCollapsed || !selection.focusNode || !editor.contains(selection.focusNode)) return;
    const parent = selection.focusNode.nodeType === Node.ELEMENT_NODE
      ? selection.focusNode as Element
      : selection.focusNode.parentElement;
    // Plain end typing is the hot path. Rich inline editing keeps using the
    // authoritative serializer so temporary Markdown can never misrepresent it.
    if (parent?.closest("strong,b,em,i,u,s,a,code,sup,sub")) return;

    const tail = window.document.createRange();
    tail.selectNodeContents(editor);
    try { tail.setStart(selection.focusNode, selection.focusOffset); } catch { return; }
    if (tail.toString().length !== 0) return;
    pendingFastInputRef.current = input.data;
  }

  function recordFastEditorInput() {
    const editor = editorRef.current;
    const data = pendingFastInputRef.current;
    pendingFastInputRef.current = null;
    if (!editor || !data || draftRef.current.length < 100_000) return;

    const current = draftRef.current;
    const next = current + data;
    if (!fastInputBurstRef.current) {
      undoRef.current.push(current);
      if (undoRef.current.length > 200) undoRef.current.shift();
      redoRef.current = [];
      fastInputBurstRef.current = true;
    }
    if (fastInputBurstTimerRef.current !== null) window.clearTimeout(fastInputBurstTimerRef.current);
    fastInputBurstTimerRef.current = window.setTimeout(() => {
      fastInputBurstRef.current = false;
      fastInputBurstTimerRef.current = null;
    }, 700);

    editor.dataset.markdown = next;
    draftRef.current = next;
    setDraft(next);
    setDirty(true);
  }

  function recordEditorDom() {'''
if record_marker not in s:
    raise RuntimeError("recordEditorDom marker missing")
s = s.replace(record_marker, fast_helper, 1)

input_marker = 'onInput={recordEditorDom}'
input_replacement = 'onBeforeInput={prepareFastEditorInput} onInput={() => { recordFastEditorInput(); recordEditorDom(); }}'
if input_marker not in s:
    raise RuntimeError("editor onInput marker missing")
s = s.replace(input_marker, input_replacement, 1)

app.write_text(s, encoding="utf-8")

# Make the trusted-keyboard large-manuscript path part of the normal browser
# suite so regressions fail before Electron packaging instead of four minutes later.
ui = Path("tests/ui-runtime.test.ts")
t = ui.read_text(encoding="utf-8")
needle = '''  await stage("immediate whole-book preview", () => page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.body?.innerText.includes("WHOLE BOOK FINAL MARKER"), { timeout: 30000 }));
  await page.setViewport({ width: 1180, height: 700 });'''
insertion = '''  await stage("immediate whole-book preview", () => page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.body?.innerText.includes("WHOLE BOOK FINAL MARKER"), { timeout: 30000 }));
  await page.$eval(".rich-editor", (el) => {
    const editor = el as HTMLElement;
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor); range.collapse(false);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  });
  const trustedTypingStarted = Date.now();
  await page.keyboard.type(" TRUSTED LARGE TYPING MARKER", { delay: 5 });
  await stage("trusted large-manuscript typing reaches model", () => page.waitForFunction(() =>
    (document.querySelector(".rich-editor") as HTMLElement)?.dataset.markdown?.includes("TRUSTED LARGE TYPING MARKER"), { timeout: 5000 }));
  await stage("trusted large-manuscript typing reaches preview", () => page.waitForFunction(() =>
    document.querySelector("iframe")?.contentDocument?.body?.innerText.includes("TRUSTED LARGE TYPING MARKER"), { timeout: 8000 }));
  check("trusted keyboard input stays responsive after a 100,000-word paste", Date.now() - trustedTypingStarted <= 8000);
  await page.setViewport({ width: 1180, height: 700 });'''
if needle not in t:
    raise RuntimeError("large-manuscript UI test insertion marker missing")
ui.write_text(t.replace(needle, insertion, 1), encoding="utf-8")

# Pin the exact runtime assets that qualification uses, and ship accurate notes.
release = Path(".github/workflows/windows-release.yml")
s = release.read_text(encoding="utf-8")
s = s.replace('runs-on: windows-latest', 'runs-on: windows-2025', 1)
s = s.replace('node-version: 22', 'node-version: 22.23.2', 1)
pattern = r'''          \$url = gh api repos/jgm/pandoc/releases/latest --jq .*?\n          if \(-not \$url\) \{ throw "Could not find the current Pandoc Windows archive\." \}\n          Invoke-WebRequest -Uri \$url -OutFile build\\pandoc\.zip'''
new = '''          $url = "https://github.com/jgm/pandoc/releases/download/3.11/pandoc-3.11-windows-x86_64.zip"
          Invoke-WebRequest -Uri $url -OutFile build\\pandoc.zip
          $actual = (Get-FileHash build\\pandoc.zip -Algorithm SHA256).Hash.ToLowerInvariant()
          if ($actual -ne "2ab72baf2399450e148ddf7a2a8689806c42e1bba71862b57e220fd9b8456d3d") { throw "Pandoc 3.11 checksum mismatch: $actual" }'''
s, n = re.subn(pattern, lambda _: new, s, count=1, flags=re.S)
if n != 1:
    raise RuntimeError("could not pin Pandoc in windows-release.yml")
old_browser = '        run: npx puppeteer browsers install chrome-headless-shell'
if old_browser not in s:
    raise RuntimeError("could not find Chromium install step")
s = s.replace(old_browser, '''        run: |
          npx puppeteer browsers install chrome-headless-shell
          $chrome = Get-ChildItem build\\puppeteer-cache -Filter chrome-headless-shell.exe -Recurse | Where-Object { $_.FullName -match "152\\.0\\.7977\\.75" } | Select-Object -First 1
          if (-not $chrome) { throw "Pinned Chrome Headless Shell 152.0.7977.75 was not installed." }''', 1)
old_notes = 'Folio 1.0.4 fixes illegal mid-word breaks by distinguishing real discretionary hyphenation points from ordinary DOM/style boundaries, and makes Polish/English hyphenation deliberately more restrained. Long-manuscript editing is substantially lighter: redundant server preview renders are skipped while typing, large contenteditable input is coalesced, and the paragraph compositor runs lazily near the viewport without forcing a full-document geometry pass. Kindle, iPad, iPhone and Android previews now use calibrated logical screen geometry and proportional reading metrics, and Folio displays page counts for the current chapter and the whole book (exact whole-book pages in Print preview, estimated reflowable pages at the selected Folio reading preset). Print/PDF composition uses the same corrected break rules. The Windows build is validated by the full formatter/export suite and a packaged-EXE smoke test.'
new_notes = 'Folio 1.0.5 hardens manuscript safety with serialized autosave, atomic source/config replacement and a close-time flush gate. Large Writer/Word pastes are processed cooperatively and ordinary end-of-manuscript typing uses an immediate model fast path before authoritative background serialization. Reflow preview no longer sends backend renders for each draft and uses one deterministic Standard calibration without enlarging device shells. The professional compositor bounds inter-word expansion and tracking, penalizes consecutive hyphenation, preserves authored soft hyphens and inline semantics, isolates scene breaks, and uses the same rules for preview and print. The desktop UI adds two restrained editorial tones, Ivory & Ink and Midnight Editorial, while keeping the three-pane Folio workflow. Windows assets are pinned and the release is validated by typecheck, the full suite, packaged UI smoke, EPUB/PDF/print export and release hashing.'
if old_notes not in s:
    raise RuntimeError("could not find 1.0.4 release notes")
release.write_text(s.replace(old_notes, new_notes, 1), encoding="utf-8")

print("Folio 1.0.5 final responsiveness and release patches applied")

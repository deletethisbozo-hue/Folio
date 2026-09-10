from pathlib import Path


app = Path("web/src/App.tsx")
source = app.read_text(encoding="utf-8")

# On a 100k-word contentEditable Chromium can spend seconds performing its own
# edit before React sees input. For a printable key at the literal end of plain
# prose, own the tiny mutation during keydown and bypass that full edit path.
source = source.replace('  const pendingFastInputRef = useRef<string | null>(null);\n', '', 1)
source = source.replace('    pendingFastInputRef.current = null;\n', '', 1)

start = source.find('  function prepareFastEditorInput(')
end = source.find('  function recordEditorDom() {', start)
if start < 0 or end < 0:
    raise RuntimeError("missing generated fast-input block")

hot_path = '''  function applyFastEditorKey(event: React.KeyboardEvent<HTMLDivElement>): boolean {
    const editor = editorRef.current;
    if (!editor || draftRef.current.length < 100_000) return false;
    if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing || event.key.length !== 1) return false;

    const selection = window.getSelection();
    if (!selection?.isCollapsed || !selection.focusNode || !editor.contains(selection.focusNode)) return false;
    const parent = selection.focusNode.nodeType === Node.ELEMENT_NODE
      ? selection.focusNode as Element
      : selection.focusNode.parentElement;
    if (parent?.closest("strong,b,em,i,u,s,a,code,sup,sub")) return false;

    // Structural end check, O(depth), never O(manuscript size).
    let node: Node = selection.focusNode;
    if (node.nodeType === Node.TEXT_NODE) {
      if (selection.focusOffset !== (node.textContent?.length ?? 0)) return false;
    } else if (selection.focusOffset !== node.childNodes.length) return false;
    while (node !== editor) {
      if (node.nextSibling || !node.parentNode) return false;
      node = node.parentNode;
    }

    event.preventDefault();
    const text = window.document.createTextNode(event.key);
    const focusNode = selection.focusNode;
    const rootBoundary = focusNode === editor && selection.focusOffset === editor.childNodes.length;
    if (rootBoundary) {
      const last = editor.lastElementChild as HTMLElement | null;
      if (last && last.getAttribute("contenteditable") !== "false" && !last.classList.contains("editor-scene-break")) {
        if (last.lastChild?.nodeName === "BR" && !(last.textContent ?? "")) last.lastChild.remove();
        last.appendChild(text);
      } else editor.appendChild(text);
    } else {
      const range = selection.getRangeAt(0);
      range.insertNode(text);
    }
    const caret = window.document.createRange();
    caret.setStartAfter(text); caret.collapse(true);
    selection.removeAllRanges(); selection.addRange(caret);

    const current = draftRef.current;
    const next = current + event.key;
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
    return true;
  }

'''
source = source[:start] + hot_path + source[end:]

jsx_old = 'onBeforeInput={prepareFastEditorInput} onInput={() => { recordFastEditorInput(); recordEditorDom(); }}'
if jsx_old not in source:
    raise RuntimeError("missing generated fast-input JSX marker")
source = source.replace(jsx_old, 'onInput={recordEditorDom}', 1)

keydown_old = '''  function editorKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!(event.ctrlKey || event.metaKey)) return;'''
keydown_new = '''  function editorKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (applyFastEditorKey(event)) return;
    if (!(event.ctrlKey || event.metaKey)) return;'''
if keydown_old not in source:
    raise RuntimeError("missing editorKeyDown marker")
source = source.replace(keydown_old, keydown_new, 1)
app.write_text(source, encoding="utf-8")

# Windows can transiently deny replace-style rename while Defender/indexing has
# just opened the destination. Never unlink the target; bounded retries preserve
# atomicity while tolerating the short EPERM/EBUSY/EACCES lock window.
atomic = Path("server/atomic-write.ts")
a = atomic.read_text(encoding="utf-8")
rename_old = '    await fs.rename(temp, target);'
rename_new = '''    for (let attempt = 0; ; attempt += 1) {
      try {
        await fs.rename(temp, target);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const transientWindowsLock = process.platform === "win32" && (code === "EPERM" || code === "EBUSY" || code === "EACCES");
        if (!transientWindowsLock || attempt >= 6) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, 25 * (2 ** attempt)));
      }
    }'''
if rename_old not in a:
    raise RuntimeError("missing atomic rename marker")
atomic.write_text(a.replace(rename_old, rename_new, 1), encoding="utf-8")

# The delete control can be transiently disabled while the previous save settles.
# Wait for actual interactivity, then still require the row to disappear.
ui = Path("tests/ui-runtime.test.ts")
test = ui.read_text(encoding="utf-8")
old_delete = '''  const frontRowsBeforeDelete = await page.$$eval(".contents-list > .contents-row:not(.chapter-row)", (rows) => rows.length);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.click(".section-delete");
  await stage("generated front matter deletion", () => page.waitForFunction((before) => document.querySelectorAll(".contents-list > .contents-row:not(.chapter-row)").length === before - 1, {}, frontRowsBeforeDelete));'''
new_delete = '''  const frontRowsBeforeDelete = await page.$$eval(".contents-list > .contents-row:not(.chapter-row)", (rows) => rows.length);
  await stage("generated front matter delete button ready", () => page.waitForFunction(() => {
    const button = document.querySelector(".section-delete") as HTMLButtonElement | null;
    return Boolean(button && !button.disabled);
  }));
  page.once("dialog", (dialog) => void dialog.accept());
  await page.click(".section-delete");
  await stage("generated front matter deletion", () => page.waitForFunction((before) => document.querySelectorAll(".contents-list > .contents-row:not(.chapter-row)").length === before - 1, { timeout: 30000 }, frontRowsBeforeDelete));'''
if old_delete not in test:
    raise RuntimeError("missing generated front matter delete test marker")
ui.write_text(test.replace(old_delete, new_delete, 1), encoding="utf-8")

print("Folio 1.0.5 synchronous keyboard + Windows atomic-replace hotfix applied")

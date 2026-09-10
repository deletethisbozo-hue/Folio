from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    value = path.read_text(encoding="utf-8")
    if old not in value:
        raise RuntimeError(f"missing hotfix marker: {label}")
    path.write_text(value.replace(old, new, 1), encoding="utf-8")


app = Path("web/src/App.tsx")
source = app.read_text(encoding="utf-8")

old_event = '''  function prepareFastEditorInput(event: React.FormEvent<HTMLDivElement>) {
    pendingFastInputRef.current = null;
    const editor = editorRef.current;
    if (!editor || draftRef.current.length < 100_000) return;
    const input = event.nativeEvent as InputEvent;
    if (input.inputType !== "insertText" || !input.data || input.isComposing) return;
'''
new_event = '''  function prepareFastEditorInput(event: React.KeyboardEvent<HTMLDivElement>) {
    pendingFastInputRef.current = null;
    const editor = editorRef.current;
    if (!editor || draftRef.current.length < 100_000) return;
    // React's beforeinput normalization does not reliably expose InputEvent.data
    // for contentEditable on every Chromium build. keydown is the stable trusted
    // pre-mutation signal for ordinary printable keyboard input.
    if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing || event.key.length !== 1) return;
'''
if old_event not in source:
    raise RuntimeError("missing fast-input event marker")
source = source.replace(old_event, new_event, 1)
source = source.replace('    pendingFastInputRef.current = input.data;\n', '    pendingFastInputRef.current = event.key;\n', 1)
source = source.replace('onBeforeInput={prepareFastEditorInput} ', '', 1)
old_keydown = '''  function editorKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!(event.ctrlKey || event.metaKey)) return;'''
new_keydown = '''  function editorKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    prepareFastEditorInput(event);
    if (!(event.ctrlKey || event.metaKey)) return;'''
if old_keydown not in source:
    raise RuntimeError("missing editorKeyDown marker")
source = source.replace(old_keydown, new_keydown, 1)
app.write_text(source, encoding="utf-8")

# The generated-title deletion assertion was intermittently clicking while the
# control was transiently disabled on slower Windows runners. Wait for the same
# state a real user can interact with, then keep asserting the actual row removal.
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

print("Folio 1.0.5 trusted-keyboard hotfix applied")

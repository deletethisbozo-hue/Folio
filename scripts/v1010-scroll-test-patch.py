from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / "tests/ui-runtime.test.ts"
text = path.read_text(encoding="utf-8")
anchor = '''  check("100,000-word paste keeps both panes fixed while only editor text scrolls", visibleAfterLargePaste);
  await stage("whole-book autosave", () => page.waitForFunction(() => document.querySelector(".save-indicator")?.textContent === "Saved", { timeout: 60000 }));
'''
replacement = '''  check("100,000-word paste keeps both panes fixed while only editor text scrolls", visibleAfterLargePaste);
  const rapidPreviewScroll = await page.evaluate(async () => {
    const frame = document.querySelector("iframe") as HTMLIFrameElement | null;
    const scroller = frame?.contentDocument?.scrollingElement as HTMLElement | null;
    if (!frame || !scroller) return { ok: false, maxFrameDelay: Infinity, steps: 0 };
    const max = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
    const positions = [0.08, 0.82, 0.18, 0.93, 0.31, 0.74, 0.47, 0.97, 0.12, 0.66, 0.39, 0.88];
    let maxFrameDelay = 0;
    let frames = 0;
    for (const ratio of positions) {
      const before = performance.now();
      scroller.scrollTop = Math.floor(max * ratio);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      maxFrameDelay = Math.max(maxFrameDelay, performance.now() - before);
      frames++;
    }
    // Hold still long enough for the idle compositor to resume after the final
    // scroll event. The important part is that it did not try to compose every
    // paragraph crossed on the way here.
    await new Promise((resolve) => setTimeout(resolve, 180));
    return { ok: frames === positions.length, maxFrameDelay, steps: positions.length };
  });
  check(
    "rapid preview scrolling does not let lazy composition freeze the app",
    rapidPreviewScroll.ok && rapidPreviewScroll.maxFrameDelay < 250,
    JSON.stringify(rapidPreviewScroll),
  );
  await stage("whole-book autosave", () => page.waitForFunction(() => document.querySelector(".save-indicator")?.textContent === "Saved", { timeout: 60000 }));
'''
if text.count(anchor) != 1:
    raise SystemExit(f"rapid-scroll test anchor: expected one, found {text.count(anchor)}")
path.write_text(text.replace(anchor, replacement), encoding="utf-8")
print("Added Folio 1.0.10 rapid-scroll regression coverage.")

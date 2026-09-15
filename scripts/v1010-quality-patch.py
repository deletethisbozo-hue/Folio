from pathlib import Path

root = Path(__file__).resolve().parents[1]
compositor = root / "web/src/compositor.ts"
text = compositor.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    text = text.replace(old, new)

replace_once(
    'const compositionObservers = new WeakMap<Document, IntersectionObserver>();\n',
    'const compositionObservers = new WeakMap<Document, IntersectionObserver>();\nconst compositionCleanups = new WeakMap<Document, () => void>();\n',
    'composition cleanup map',
)

replace_once(
    '        const emergencyRescue = allowNaturalRescue && !last && !fit && !continuityFit && !spacingFit && natural <= available + 0.75;\n',
    '        const emergencyRescue = allowNaturalRescue\n          && !last\n          && !fit\n          && !continuityFit\n          && !spacingFit\n          && natural <= available + 0.75\n          // A non-final ragged rescue line below roughly three quarters of the\n          // measure is more conspicuous than an extra legal hyphen. Folio 1.0.9\n          // could otherwise choose lines such as a lone “Umierali,” merely to\n          // improve the paragraph-wide hyphen budget.\n          && natural / Math.max(1, available) >= 0.72;\n',
    'minimum rescue fill',
)

replace_once(
    '        const rescuePenalty = dropcapRescue\n          ? 115 + 260 * Math.pow(1 - fill, 2)\n          : rescueNatural ? 1100 + 900 * Math.pow(1 - fill, 2) : 0;\n',
    '        const rescuePenalty = dropcapRescue\n          ? 115 + 260 * Math.pow(1 - fill, 2)\n          : rescueNatural\n            // Natural rescue is a cross-platform escape hatch, not a preferred\n            // way to lower hyphen density. Keep it available for genuinely hard\n            // measures, but make a legal justified line decisively cheaper.\n            ? 4200 + 18000 * Math.pow(Math.max(0, 0.90 - fill) / 0.18, 2)\n            : 0;\n',
    'rescue penalty',
)

replace_once(
    '  queued: WeakSet<HTMLElement>,\n',
    '  queued: Set<HTMLElement>,\n',
    'observer queue type',
)

old_observer = '''  const view = document.defaultView;
  if (!view) return;
  let scheduled = false;
  let observer: IntersectionObserver;

  const request = () => {
    if (scheduled || compositionGeneration.get(document) !== generation) return;
    scheduled = true;
    view.requestAnimationFrame(run);
  };

  const run = () => {
    scheduled = false;
    if (compositionGeneration.get(document) !== generation) return;
    const started = view.performance.now();
    let processed = 0;
    while (queue.length && processed < 2 && view.performance.now() - started < 8) {
      const paragraph = queue.shift()!;
      if (!paragraph.isConnected) continue;
      observer.unobserve(paragraph);
      composeParagraph(paragraph, language, sectionStatsFor(paragraph, statsBySection));
      processed++;
    }
    if (queue.length) request();
  };

  observer = new view.IntersectionObserver((entries) => {
    if (compositionGeneration.get(document) !== generation) return;
    for (const entry of entries) {
      const paragraph = entry.target as HTMLElement;
      if (entry.isIntersecting && !queued.has(paragraph)) {
        queued.add(paragraph);
        queue.push(paragraph);
      }
    }
    if (queue.length) request();
  }, { root: null, rootMargin: "700px 0px", threshold: 0 });
  compositionObservers.set(document, observer);
  for (const paragraph of paragraphs) observer.observe(paragraph);
  if (queue.length) request();
'''
new_observer = '''  const view = document.defaultView;
  if (!view) return;
  let scheduled = false;
  let scrolling = false;
  let scrollTimer: number | null = null;
  let observer: IntersectionObserver;

  const request = () => {
    if (scheduled || scrolling || compositionGeneration.get(document) !== generation) return;
    scheduled = true;
    view.requestAnimationFrame(run);
  };

  const run = () => {
    scheduled = false;
    if (scrolling || compositionGeneration.get(document) !== generation) return;
    const started = view.performance.now();
    let processed = 0;
    // One expensive paragraph is enough work for one animation frame. The old
    // two-paragraph batch could monopolise the UI thread after a fast scroll.
    while (queue.length && processed < 1 && view.performance.now() - started < 5) {
      const paragraph = queue.shift()!;
      if (!queued.delete(paragraph) || !paragraph.isConnected) continue;
      const rect = paragraph.getBoundingClientRect();
      const viewportHeight = view.innerHeight || document.documentElement.clientHeight;
      // Drop stale work collected while the user flew past this paragraph.
      // IntersectionObserver will enqueue it again if the reader comes back.
      if (rect.bottom < -340 || rect.top > viewportHeight + 340) continue;
      observer.unobserve(paragraph);
      composeParagraph(paragraph, language, sectionStatsFor(paragraph, statsBySection));
      processed++;
    }
    if (queue.length) request();
  };

  const onScroll = () => {
    scrolling = true;
    if (scrollTimer !== null) view.clearTimeout(scrollTimer);
    scrollTimer = view.setTimeout(() => {
      scrolling = false;
      scrollTimer = null;
      if (queue.length) request();
    }, 110);
  };
  view.addEventListener("scroll", onScroll, { passive: true, capture: true });

  observer = new view.IntersectionObserver((entries) => {
    if (compositionGeneration.get(document) !== generation) return;
    for (const entry of entries) {
      const paragraph = entry.target as HTMLElement;
      if (entry.isIntersecting) {
        if (!queued.has(paragraph)) {
          queued.add(paragraph);
          queue.push(paragraph);
        }
      } else {
        // Leave the stale array entry in place and invalidate it in O(1). The
        // worker skips it later; if the paragraph returns, it may be queued anew.
        queued.delete(paragraph);
      }
    }
    if (queue.length) request();
  }, { root: null, rootMargin: "320px 0px", threshold: 0 });

  const cleanup = () => {
    observer.disconnect();
    view.removeEventListener("scroll", onScroll, true);
    if (scrollTimer !== null) view.clearTimeout(scrollTimer);
  };
  compositionObservers.set(document, observer);
  compositionCleanups.set(document, cleanup);
  for (const paragraph of paragraphs) observer.observe(paragraph);
  if (queue.length) request();
'''
replace_once(old_observer, new_observer, 'scroll-aware observer')

replace_once(
    '  compositionObservers.get(document)?.disconnect();\n  compositionObservers.delete(document);\n',
    '  compositionCleanups.get(document)?.();\n  compositionCleanups.delete(document);\n  compositionObservers.get(document)?.disconnect();\n  compositionObservers.delete(document);\n',
    'observer cleanup invocation',
)

replace_once(
    '  const queued = new WeakSet<HTMLElement>();\n',
    '  const queued = new Set<HTMLElement>();\n',
    'queue set',
)

compositor.write_text(text, encoding="utf-8")

qa = root / "scripts/v107-visual-qa.ts"
qa_text = qa.read_text(encoding="utf-8")
old_corpus = '''  "— Czy naprawdę możemy tam wrócić? — zapytała. — Możemy, jeśli naprawdę musimy, ale nie powinniśmy udawać, że niczego się nie boimy. Najtrudniejsze odpowiedzi przychodzą przecież dopiero wtedy, gdy kończą się wszystkie pozornie łatwe pytania.",
];'''
new_corpus = '''  "— Czy naprawdę możemy tam wrócić? — zapytała. — Możemy, jeśli naprawdę musimy, ale nie powinniśmy udawać, że niczego się nie boimy. Najtrudniejsze odpowiedzi przychodzą przecież dopiero wtedy, gdy kończą się wszystkie pozornie łatwe pytania.",
  "Umierali, a jedno z niewielu remediów na śmierć w ludzkiej postaci postanowiło chować się jak tchórz.",
  "Ostatnimi czasy coraz częściej wypadało mi to z głowy, choć niby takie oczywiste. Oddychaj i żyj.",
];'''
if qa_text.count(old_corpus) != 1:
    raise SystemExit(f"visual QA corpus anchor: expected one, found {qa_text.count(old_corpus)}")
qa.write_text(qa_text.replace(old_corpus, new_corpus), encoding="utf-8")

print("Applied Folio 1.0.10 line-quality and fast-scroll compositor patch.")

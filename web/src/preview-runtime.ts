import { composePreviewDocument } from "./compositor";

type ReflowProfile = {
  width: number;
  height: number;
  baseFont: number;
  padding: [number, number, number, number];
  wordsPerPage: number;
};

const PROFILES: Record<string, ReflowProfile> = {
  // Logical CSS viewports at a standard reading size. Physical e-reader font
  // size is user-adjustable, so these are deliberately a stable Folio reading
  // preset rather than pretending there is one immutable Kindle font size.
  "kindle-paperwhite": { width: 412, height: 549, baseFont: 16, padding: [34, 28, 46, 28], wordsPerPage: 285 },
  "kindle-oasis": { width: 421, height: 560, baseFont: 16, padding: [32, 34, 46, 28], wordsPerPage: 305 },
  ipad: { width: 820, height: 1180, baseFont: 18, padding: [62, 68, 82, 68], wordsPerPage: 475 },
  iphone: { width: 390, height: 844, baseFont: 17, padding: [38, 25, 58, 25], wordsPerPage: 255 },
  android: { width: 412, height: 915, baseFont: 17, padding: [38, 26, 60, 26], wordsPerPage: 275 },
};

function countWords(value: string): number {
  return value.trim().match(/\S+/g)?.length ?? 0;
}

function numberFromWordsLabel(): number {
  const label = document.querySelector<HTMLElement>(".word-count")?.textContent ?? "";
  const raw = label.replace(/[^0-9]/g, "");
  return raw ? Number(raw) : 0;
}

function mode(): string {
  return document.querySelector<HTMLSelectElement>('select[aria-label="Preview device"]')?.value || "kindle-paperwhite";
}

/** Avoid a full Pandoc/server round-trip after every key. App.tsx already has a
 * local semantic preview path for editable reflowable sections; repeated
 * requests whose only changing input is `draft` are therefore redundant and
 * were a major source of whole-app stalls on long chapters. Device/profile
 * changes are part of the signature so switching readers still triggers the
 * authoritative App render and its device-specific stylesheet. */
function installPreviewFetchFastPath(): void {
  const nativeFetch = window.fetch.bind(window);
  let lastReflowSignature = "";
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (init?.method === "POST" && /\/api\/projects\/[^/]+\/preview$/.test(url) && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        const signature = JSON.stringify({
          url,
          device: mode(),
          meta: body.meta,
          theme: body.theme,
          typography: body.typography,
          previewSectionId: body.previewSectionId,
        });
        if (signature === lastReflowSignature && typeof body.draft === "string") {
          return Promise.reject(new DOMException("Live draft is already rendered locally.", "AbortError"));
        }
        lastReflowSignature = signature;
      } catch {
        // A malformed/unknown request goes through untouched.
      }
    }
    return nativeFetch(input, init);
  }) as typeof window.fetch;
}

function calibrateFrame(frame: HTMLIFrameElement): boolean {
  const profile = PROFILES[mode()];
  const doc = frame.contentDocument;
  if (!profile || !doc?.head || !frame.clientWidth) return false;

  const scale = frame.clientWidth / profile.width;
  const [top, right, bottom, left] = profile.padding.map((value) => Math.max(1, value * scale)) as [number, number, number, number];
  let style = doc.getElementById("folio-device-calibration") as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = "folio-device-calibration";
  }
  const css = [
    `body{font-size:${profile.baseFont * scale}px!important}`,
    `main.book{padding:${top}px ${right}px ${bottom}px ${left}px!important}`,
  ].join("");
  const changed = style.textContent !== css;
  if (changed) style.textContent = css;
  // App can replace its device-profile stylesheet. Move calibration to the end
  // only when something actually appeared after it; otherwise a head observer
  // would trigger itself forever and burn a CPU core for no useful reason.
  if (style.parentElement !== doc.head || doc.head.lastElementChild !== style) doc.head.appendChild(style);
  return changed;
}

function previewUsesProfessionalJustification(doc: Document): boolean {
  if (mode() === "print") return false;
  const css = doc.getElementById("folio-device-profile")?.textContent ?? "";
  return css.includes("hyphens:manual") || css.includes("-webkit-hyphens:manual");
}

function ensureStatsNode(): HTMLElement | null {
  const host = document.querySelector<HTMLElement>(".editor-topbar-right");
  if (!host) return null;
  let node = host.querySelector<HTMLElement>(".page-counts");
  if (!node) {
    node = document.createElement("span");
    node.className = "page-counts";
    const words = host.querySelector(".word-count");
    host.insertBefore(node, words ?? null);
  }
  return node;
}

function sectionCount(): number {
  return document.querySelectorAll(".contents-list .contents-row").length;
}

function updatePageCounts(frame: HTMLIFrameElement): void {
  const stats = ensureStatsNode();
  const doc = frame.contentDocument;
  if (!stats || !doc) return;
  const currentMode = mode();

  if (currentMode === "print") {
    const pages = doc.querySelectorAll(".pagedjs_page").length;
    const editor = document.querySelector<HTMLElement>(".rich-editor");
    const chapterWords = countWords(editor?.dataset.markdown || editor?.innerText || "");
    const totalWords = numberFromWordsLabel();
    const chapterEstimate = pages && totalWords > 0 && chapterWords > 0
      ? Math.max(1, Math.round(pages * chapterWords / totalWords))
      : 0;
    stats.textContent = pages
      ? `Chapter ~${chapterEstimate || 1} pages · Book ${pages} pages`
      : "Calculating pages…";
    return;
  }

  const profile = PROFILES[currentMode];
  if (!profile || frame.clientHeight <= 0) return;
  const editor = document.querySelector<HTMLElement>(".rich-editor");
  const chapterWords = countWords(editor?.dataset.markdown || editor?.innerText || "");
  const totalWords = numberFromWordsLabel();
  const contentHeight = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0);
  const chapterPages = Math.max(1, Math.ceil(contentHeight / frame.clientHeight));

  // Use the actual rendered chapter to calibrate density when it is long enough
  // to be representative, otherwise fall back to the device's standard preset.
  const observedDensity = chapterWords >= 500 ? chapterWords / chapterPages : profile.wordsPerPage;
  const density = Math.max(profile.wordsPerPage * 0.62, Math.min(profile.wordsPerPage * 1.45, observedDensity));
  const structuralOverhead = Math.max(0, sectionCount() - 1) * 0.16;
  const bookPages = Math.max(chapterPages, Math.ceil(totalWords / Math.max(1, density) + structuralOverhead));
  stats.textContent = `Chapter ${chapterPages} pages · Book ~${bookPages} pages`;
}

function refreshFrame(frame: HTMLIFrameElement, forceRecompose = false): void {
  const changed = calibrateFrame(frame);
  const doc = frame.contentDocument;
  if (doc && (changed || forceRecompose) && previewUsesProfessionalJustification(doc)) {
    // Device metrics affect word widths. Recompose the near-viewport paragraphs
    // after calibration rather than leaving breaks calculated at the old scale.
    void composePreviewDocument(doc, true);
  }
  window.requestAnimationFrame(() => updatePageCounts(frame));
}

function bindFrame(frame: HTMLIFrameElement): void {
  if (frame.dataset.folioMetricsBound === "true") return;
  frame.dataset.folioMetricsBound = "true";

  let headObserver: MutationObserver | null = null;
  const refresh = () => {
    refreshFrame(frame, true);
    const head = frame.contentDocument?.head;
    if (head && !headObserver) {
      let scheduled = false;
      headObserver = new MutationObserver((records) => {
        if (scheduled) return;
        const profileChanged = records.some((record) =>
          Array.from(record.addedNodes).some((node) => node instanceof HTMLElement && node.id === "folio-device-profile") ||
          Array.from(record.removedNodes).some((node) => node instanceof HTMLElement && node.id === "folio-device-profile"),
        );
        scheduled = true;
        window.requestAnimationFrame(() => {
          scheduled = false;
          refreshFrame(frame, profileChanged);
        });
      });
      headObserver.observe(head, { childList: true });
    }
  };
  frame.addEventListener("load", refresh);
  refresh();
}

/** A contenteditable input event used to serialise the entire editor DOM is
 * expensive by definition. For large chapters, coalesce trusted keystrokes and
 * let React process one synthetic input event after a very short idle window.
 * The browser still edits the visible DOM synchronously, so typing/caret motion
 * remain immediate; draft state, autosave and preview catch up milliseconds
 * later instead of reparsing 100k words for every key. */
function installLargeEditorInputCoalescing(): void {
  const timers = new WeakMap<HTMLElement, number>();
  document.addEventListener("input", (event) => {
    if (!event.isTrusted) return;
    const editor = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".rich-editor") : null;
    if (!editor) return;
    const knownLength = editor.dataset.markdown?.length ?? 0;
    if (knownLength < 35_000) return;

    event.stopPropagation();
    const previous = timers.get(editor);
    if (previous !== undefined) window.clearTimeout(previous);
    const delay = knownLength > 250_000 ? 140 : knownLength > 100_000 ? 105 : 75;
    const timer = window.setTimeout(() => {
      timers.delete(editor);
      if (!editor.isConnected) return;
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText" }));
      const frame = document.querySelector<HTMLIFrameElement>(".preview-frame");
      if (frame) window.requestAnimationFrame(() => updatePageCounts(frame));
    }, delay);
    timers.set(editor, timer);
  }, true);
}

function scan(): void {
  const frame = document.querySelector<HTMLIFrameElement>(".preview-frame");
  if (frame) bindFrame(frame);
  ensureStatsNode();
}

export function installPreviewRuntime(): void {
  installPreviewFetchFastPath();

  const start = () => {
    installLargeEditorInputCoalescing();
    scan();
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        scan();
      });
    });
    // Structural changes are enough to discover new frames/topbars. Watching
    // every text-node mutation would put the page counter back on the typing
    // hot path we just removed.
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener("change", (event) => {
      const select = event.target instanceof HTMLSelectElement ? event.target : null;
      if (select?.getAttribute("aria-label") !== "Preview device") return;
      const frame = document.querySelector<HTMLIFrameElement>(".preview-frame");
      if (frame) window.requestAnimationFrame(() => refreshFrame(frame, true));
    });

    window.addEventListener("resize", () => {
      const frame = document.querySelector<HTMLIFrameElement>(".preview-frame");
      if (frame) refreshFrame(frame, true);
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

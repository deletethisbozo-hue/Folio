import { composePreviewDocument } from "./compositor";

type ReflowProfile = {
  width: number;
  height: number;
  baseFont: number;
  padding: [number, number, number, number];
  wordsPerPage: number;
};

const PROFILES: Record<string, ReflowProfile> = {
  // Logical viewports at Folio's named Standard reading preset. The shell stays
  // the same size; text and margins scale into that reduced visualisation.
  // Paperwhite Standard uses a 35px logical side inset. This intentionally
  // encourages an earlier legal word break instead of forcing isolated lines
  // to the edge of the microtypographic envelope.
  "kindle-paperwhite": { width: 412, height: 549, baseFont: 18, padding: [34, 35, 46, 35], wordsPerPage: 270 },
  "kindle-oasis": { width: 421, height: 560, baseFont: 18, padding: [32, 34, 46, 28], wordsPerPage: 290 },
  ipad: { width: 820, height: 1180, baseFont: 19, padding: [62, 68, 82, 68], wordsPerPage: 455 },
  iphone: { width: 390, height: 844, baseFont: 18, padding: [38, 25, 58, 25], wordsPerPage: 245 },
  android: { width: 412, height: 915, baseFont: 18, padding: [38, 26, 60, 26], wordsPerPage: 265 },
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

/** Install the one authoritative font/margin calibration for reflow preview.
 * App.tsx calls this before composition, so line metrics are never calculated at
 * an obsolete 12–14px intermediate size. */
export function calibratePreviewFrame(frame: HTMLIFrameElement): boolean {
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
  if (style.parentElement !== doc.head || doc.head.lastElementChild !== style) doc.head.appendChild(style);
  frame.dataset.folioCalibrationReady = "true";
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

export function updatePreviewPageCounts(frame: HTMLIFrameElement): void {
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
  const observedDensity = chapterWords >= 500 ? chapterWords / chapterPages : profile.wordsPerPage;
  const density = Math.max(profile.wordsPerPage * 0.62, Math.min(profile.wordsPerPage * 1.45, observedDensity));
  const structuralOverhead = Math.max(0, sectionCount() - 1) * 0.16;
  const bookPages = Math.max(chapterPages, Math.ceil(totalWords / Math.max(1, density) + structuralOverhead));
  stats.textContent = `Chapter ${chapterPages} pages · Book ~${bookPages} pages`;
}

function refreshFrame(frame: HTMLIFrameElement, allowResizeRecompose = false): void {
  const wasCalibrated = frame.dataset.folioCalibrationReady === "true";
  const changed = calibratePreviewFrame(frame);
  const doc = frame.contentDocument;

  // Initial/load composition belongs to App.tsx after calibration. Runtime only
  // recomposes an already-calibrated document when its physical iframe width
  // actually changes, which avoids the old double-compose/flicker path.
  if (allowResizeRecompose && wasCalibrated && changed && doc && previewUsesProfessionalJustification(doc)) {
    void composePreviewDocument(doc, true);
  }
  window.requestAnimationFrame(() => updatePreviewPageCounts(frame));
}

function bindFrame(frame: HTMLIFrameElement): void {
  if (frame.dataset.folioMetricsBound === "true") return;
  frame.dataset.folioMetricsBound = "true";
  frame.addEventListener("load", () => refreshFrame(frame, false));
  refreshFrame(frame, false);
}

function scan(): void {
  const frame = document.querySelector<HTMLIFrameElement>(".preview-frame");
  if (frame) bindFrame(frame);
  ensureStatsNode();
}

export function installPreviewRuntime(): void {
  const start = () => {
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
    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener("resize", () => {
      const frame = document.querySelector<HTMLIFrameElement>(".preview-frame");
      if (frame) refreshFrame(frame, true);
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

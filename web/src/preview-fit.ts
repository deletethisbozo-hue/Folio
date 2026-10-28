/** Physical CSS pixels only; user zoom is applied after this fit calculation. */
export function printFitScale(physicalWidth: number, availableWidth: number): number {
  if (!Number.isFinite(physicalWidth) || physicalWidth <= 0 || !Number.isFinite(availableWidth)) return 1;
  return Math.min(1, Math.max(1, availableWidth - 28) / physicalWidth);
}

/** Seek only after book pagination and physical fit have finished. */
export function seekPrintSection(frame: HTMLIFrameElement, sectionId: string): boolean {
  const document = frame.contentDocument;
  const scroller = document?.scrollingElement;
  const section = Array.from(document?.querySelectorAll<HTMLElement>(".pagedjs_page section") ?? []).find((section) => section.id === sectionId);
  if (!section || !scroller) return false;
  const heading = section.querySelector<HTMLElement>(":scope > h1");
  const target = heading && heading.getBoundingClientRect().height > 0 ? heading : section;
  scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + target.getBoundingClientRect().top - 16), left: scroller.scrollLeft });
  frame.dataset.folioPrintAnchor = sectionId;
  return true;
}

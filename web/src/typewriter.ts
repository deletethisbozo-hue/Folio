function usableCaretRect(editor: HTMLElement): DOMRect | null {
  const selection = editor.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const source = selection.getRangeAt(0);
  if (!editor.contains(source.startContainer)) return null;

  const caret = source.cloneRange();
  caret.collapse(true);
  const directRects = Array.from(caret.getClientRects());
  const direct = directRects[0] ?? caret.getBoundingClientRect();
  if (direct && (direct.height > 0 || direct.width > 0)) return direct;

  const node = caret.startContainer;
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node as Text;
    if (text.length > 0) {
      const probe = editor.ownerDocument.createRange();
      const offset = Math.min(caret.startOffset, text.length);
      if (offset > 0) {
        probe.setStart(text, offset - 1);
        probe.setEnd(text, offset);
        const rects = Array.from(probe.getClientRects());
        const rect = rects.at(-1) ?? probe.getBoundingClientRect();
        if (rect && (rect.height > 0 || rect.width > 0)) return rect;
      } else {
        probe.setStart(text, 0);
        probe.setEnd(text, Math.min(1, text.length));
        const rect = Array.from(probe.getClientRects())[0] ?? probe.getBoundingClientRect();
        if (rect && (rect.height > 0 || rect.width > 0)) return rect;
      }
    }
  }

  const element = node.nodeType === Node.ELEMENT_NODE
    ? node as HTMLElement
    : node.parentElement;
  const block = element?.closest<HTMLElement>("p,li,h1,h2,h3,h4,h5,h6,blockquote,div");
  if (!block || !editor.contains(block)) return null;
  const blockRect = block.getBoundingClientRect();
  const lineHeight = Number.parseFloat(getComputedStyle(block).lineHeight)
    || Number.parseFloat(getComputedStyle(editor).lineHeight)
    || 24;
  return new DOMRect(blockRect.left, blockRect.top, Math.max(1, blockRect.width), Math.max(1, lineHeight));
}

export function centerTypewriterCaret(editor: HTMLElement | null): boolean {
  if (!editor || !editor.classList.contains("typewriter-active")) return false;

  const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 24;
  const spacer = Math.max(0, editor.clientHeight / 2 - lineHeight);
  editor.style.setProperty("--folio-typewriter-spacer", `${spacer}px`);

  const rect = usableCaretRect(editor);
  if (!rect) return false;

  const viewport = editor.getBoundingClientRect();
  const caretCenter = rect.top + Math.max(rect.height, lineHeight) / 2;
  const viewportCenter = viewport.top + editor.clientHeight / 2;
  const delta = caretCenter - viewportCenter;
  if (Math.abs(delta) > 0.5) editor.scrollTop += delta;
  return true;
}

export function scheduleTypewriterCaret(editor: HTMLElement | null): void {
  if (!editor || !editor.classList.contains("typewriter-active")) return;
  editor.ownerDocument.defaultView?.requestAnimationFrame(() => centerTypewriterCaret(editor));
}

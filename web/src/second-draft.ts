import type { SecondDraftBlock, SecondDraftBlockStatus, SecondDraftPair } from "./write-studio";

export function secondDraftProcessedStatus(status: SecondDraftBlockStatus): boolean {
  return status === "rewritten" || status === "cut" || status === "keep" || status === "sent";
}

export function mergedSecondDraftRanges(blocks: SecondDraftBlock[], targetSectionId: string): Array<[number, number]> {
  const ranges = blocks
    .filter((block) => block.targetSectionId === targetSectionId && secondDraftProcessedStatus(block.status))
    .map((block) => [block.sourceStart, block.sourceEnd] as [number, number])
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (!previous || range[0] > previous[1]) merged.push([...range]);
    else previous[1] = Math.max(previous[1], range[1]);
  }
  return merged;
}

export function secondDraftProgress(pair: SecondDraftPair | null | undefined, blocks: SecondDraftBlock[]): number {
  if (!pair || pair.sourceTextLength <= 0) return 0;
  const covered = mergedSecondDraftRanges(blocks, pair.targetSectionId)
    .reduce((sum, [start, end]) => sum + Math.max(0, Math.min(pair.sourceTextLength, end) - Math.max(0, start)), 0);
  return Math.max(0, Math.min(1, covered / pair.sourceTextLength));
}

export function changedTextRange(before: string, after: string, anchor = 0): { start: number; end: number } | null {
  if (before === after) return null;
  const start = Math.max(0, Math.min(Math.round(anchor), before.length, after.length));
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd--;
    afterEnd--;
  }
  return { start, end: Math.max(start, afterEnd) };
}

export function sourceFingerprint(text: string): string {
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    hashA ^= code;
    hashA = Math.imul(hashA, 0x01000193) >>> 0;
    hashB ^= (code + index) >>> 0;
    hashB = Math.imul(hashB, 0x85ebca6b) >>> 0;
  }
  return hashA.toString(16).padStart(8, "0") + hashB.toString(16).padStart(8, "0");
}

export function textOffsetWithin(root: Node, node: Node, offset: number): number | null {
  if (!(root instanceof Node) || !root.contains(node)) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;

  while (walker.nextNode()) {
    const current = walker.currentNode as Text;
    if (current === node) {
      return seen + Math.max(0, Math.min(current.data.length, offset));
    }
    if (current.contains?.(node)) {
      return seen;
    }
    seen += current.data.length;
  }

  // Selections can occasionally target an element boundary rather than a text
  // node. Resolve that boundary by summing the text-node lengths before it,
  // using the same coordinate system as rangeForTextOffsets/textContent.
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element;
    const children = Array.from(element.childNodes);
    const safeOffset = Math.max(0, Math.min(children.length, offset));
    let total = 0;
    const rootWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (rootWalker.nextNode()) {
      const text = rootWalker.currentNode as Text;
      const child = children[safeOffset] ?? null;
      if (child && (text === child || child.contains?.(text))) break;
      if (!child && element.contains(text)) total += text.data.length;
      else if (!element.contains(text)) total += text.data.length;
    }
    return total;
  }

  return null;
}

export function caretTextOffset(root: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection?.focusNode || !root.contains(selection.focusNode)) return null;
  return textOffsetWithin(root, selection.focusNode, selection.focusOffset);
}

export function placeCaretAtTextOffset(root: HTMLElement, offset: number): boolean {
  const total = root.textContent?.length ?? 0;
  const safe = Math.max(0, Math.min(total, Math.round(offset)));
  const selection = window.getSelection();
  if (!selection) return false;

  if (total === 0) {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let last: Text | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    last = node;
    const next = seen + node.data.length;
    if (safe <= next) {
      const range = document.createRange();
      range.setStart(node, Math.max(0, Math.min(node.data.length, safe - seen)));
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }
    seen = next;
  }

  if (!last) return false;
  const range = document.createRange();
  range.setStart(last, last.data.length);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

export function selectedTextOffsets(root: HTMLElement): { start: number; end: number; text: string } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const start = textOffsetWithin(root, range.startContainer, range.startOffset);
  const end = textOffsetWithin(root, range.endContainer, range.endOffset);
  if (start === null || end === null || end <= start) return null;
  const text = range.toString();
  if (!text.trim()) return null;
  // sourceStart/sourceEnd intentionally count text-node characters only. Keep
  // sourceText in that same coordinate system even for selections crossing
  // block elements, where Range.toString() may synthesize line separators.
  const normalizedText = (() => {
    const fragment = range.cloneContents();
    return fragment.textContent ?? text;
  })();
  if (!normalizedText.trim()) return null;
  return { start, end, text: normalizedText };
}

export function rangeForTextOffsets(root: HTMLElement, start: number, end: number): Range | null {
  if (end <= start) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let startPoint: { node: Text; offset: number } | null = null;
  let endPoint: { node: Text; offset: number } | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const next = seen + node.data.length;
    if (!startPoint && start >= seen && start <= next) startPoint = { node, offset: Math.min(node.data.length, start - seen) };
    if (end >= seen && end <= next) {
      endPoint = { node, offset: Math.min(node.data.length, end - seen) };
      break;
    }
    seen = next;
  }
  if (!startPoint || !endPoint) return null;
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  return range;
}

export interface PairedScrollAnchor {
  target: number;
  source: number;
}

export function normalizePairedScrollAnchors(anchors: PairedScrollAnchor[]): PairedScrollAnchor[] {
  const sorted = anchors
    .filter((item) => Number.isFinite(item.target) && Number.isFinite(item.source))
    .map((item) => ({ target: Math.max(0, item.target), source: Math.max(0, item.source) }))
    .sort((a, b) => a.target - b.target || a.source - b.source);

  const normalized: PairedScrollAnchor[] = [];
  for (const item of sorted) {
    const previous = normalized.at(-1);
    if (previous && Math.abs(item.target - previous.target) < 0.5) {
      previous.source = Math.max(previous.source, item.source);
      continue;
    }
    normalized.push({
      target: item.target,
      source: previous ? Math.max(previous.source, item.source) : item.source,
    });
  }
  return normalized;
}

export function interpolatePairedScroll(value: number, anchors: PairedScrollAnchor[]): number {
  const sorted = normalizePairedScrollAnchors(anchors);
  if (!sorted.length) return value;
  if (value <= sorted[0].target) return sorted[0].source;
  for (let index = 1; index < sorted.length; index++) {
    const left = sorted[index - 1];
    const right = sorted[index];
    if (value <= right.target) {
      const span = Math.max(1e-6, right.target - left.target);
      const t = (value - left.target) / span;
      return left.source + (right.source - left.source) * t;
    }
  }
  return sorted.at(-1)!.source;
}

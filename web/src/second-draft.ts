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

export function secondDraftUnprocessedRanges(
  pair: SecondDraftPair | null | undefined,
  blocks: SecondDraftBlock[],
): Array<[number, number]> {
  if (!pair || pair.sourceTextLength <= 0) return [];
  const covered = mergedSecondDraftRanges(blocks, pair.targetSectionId)
    .map(([start, end]) => [
      Math.max(0, Math.min(pair.sourceTextLength, start)),
      Math.max(0, Math.min(pair.sourceTextLength, end)),
    ] as [number, number])
    .filter(([start, end]) => end > start);
  const gaps: Array<[number, number]> = [];
  let cursor = 0;
  for (const [start, end] of covered) {
    if (start > cursor) gaps.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < pair.sourceTextLength) gaps.push([cursor, pair.sourceTextLength]);
  return gaps;
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
  const range = document.createRange();
  range.selectNodeContents(root);
  try { range.setEnd(node, offset); } catch { return null; }
  return range.toString().length;
}

export function caretTextOffset(root: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection?.focusNode || !root.contains(selection.focusNode)) return null;
  return textOffsetWithin(root, selection.focusNode, selection.focusOffset);
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
  return { start, end, text };
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

export function interpolatePairedScroll(value: number, anchors: PairedScrollAnchor[]): number {
  const sorted = [...anchors].sort((a, b) => a.target - b.target);
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

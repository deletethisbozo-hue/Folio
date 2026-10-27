/** Physical CSS pixels only; user zoom is applied after this fit calculation. */
export function printFitScale(physicalWidth: number, availableWidth: number): number {
  if (!Number.isFinite(physicalWidth) || physicalWidth <= 0 || !Number.isFinite(availableWidth)) return 1;
  return Math.min(1, Math.max(1, availableWidth - 28) / physicalWidth);
}

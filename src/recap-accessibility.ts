/**
 * Return the index to focus when Tab would leave a modal; otherwise null.
 * An unknown/removed active node is treated as outside the dialog.
 */
export function recapWrappedTabTarget(
  activeIndex: number,
  focusableCount: number,
  reverse: boolean,
): number | null {
  if (!Number.isInteger(focusableCount) || focusableCount <= 0) return null;
  if (!Number.isInteger(activeIndex) || activeIndex < 0 || activeIndex >= focusableCount)
    return reverse ? focusableCount - 1 : 0;
  if (reverse && activeIndex === 0) return focusableCount - 1;
  if (!reverse && activeIndex === focusableCount - 1) return 0;
  return null;
}

/** CSS pixels. Drag math uses the row's measured width. */
const MIN_PREVIEW_PX = 18 * 16;
const MAX_PREVIEW_RATIO = 0.75;
const DEFAULT_PREVIEW_RATIO = 0.42;

export function clampPreviewWidth({ requested, rowWidth }: { requested: number; rowWidth: number }): number {
  if (rowWidth <= 0) return requested;
  const min = Math.min(MIN_PREVIEW_PX, rowWidth * 0.3);
  const max = Math.max(min, rowWidth * MAX_PREVIEW_RATIO);
  return Math.min(max, Math.max(min, requested));
}

export function defaultPreviewWidth(rowWidth: number): number {
  return clampPreviewWidth({ requested: rowWidth * DEFAULT_PREVIEW_RATIO, rowWidth });
}

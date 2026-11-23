/** SVG point used by sparkline / path helpers. */
export type PolylinePoint = { x: number; y: number };

/**
 * Builds an SVG path that follows `points` but rounds each interior corner
 * with a short quadratic. Radius is clamped per corner so short segments
 * stay sharp rather than overshooting.
 */
export function roundedPolylinePath({ points, radius }: { points: readonly PolylinePoint[]; radius: number }): string {
  if (points.length === 0) return '';
  const first = points[0];
  if (first == null) return '';
  if (points.length === 1) return `M ${String(first.x)} ${String(first.y)}`;

  const second = points[1];
  if (points.length === 2) {
    if (second == null) return `M ${String(first.x)} ${String(first.y)}`;
    return `M ${String(first.x)} ${String(first.y)} L ${String(second.x)} ${String(second.y)}`;
  }

  const parts: string[] = [`M ${String(first.x)} ${String(first.y)}`];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    if (prev == null || curr == null || next == null) continue;

    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    const len1 = Math.hypot(dx1, dy1);
    const len2 = Math.hypot(dx2, dy2);
    if (len1 === 0 || len2 === 0) {
      parts.push(`L ${String(curr.x)} ${String(curr.y)}`);
      continue;
    }

    const r = Math.min(radius, len1 / 2, len2 / 2);
    const beforeX = curr.x - (dx1 / len1) * r;
    const beforeY = curr.y - (dy1 / len1) * r;
    const afterX = curr.x + (dx2 / len2) * r;
    const afterY = curr.y + (dy2 / len2) * r;
    parts.push(
      `L ${String(beforeX)} ${String(beforeY)} Q ${String(curr.x)} ${String(curr.y)} ${String(afterX)} ${String(afterY)}`,
    );
  }

  const last = points[points.length - 1];
  if (last != null) parts.push(`L ${String(last.x)} ${String(last.y)}`);
  return parts.join(' ');
}

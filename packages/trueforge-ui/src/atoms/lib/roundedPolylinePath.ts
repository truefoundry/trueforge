type PolylinePoint = { x: number; y: number };

const coord = ({ x, y }: PolylinePoint): string => `${String(x)} ${String(y)}`;

/**
 * Builds an SVG path that follows `points` but rounds each interior corner
 * with a short quadratic. Radius is clamped per corner so short segments
 * stay sharp rather than overshooting.
 */
export function roundedPolylinePath({ points, radius }: { points: readonly PolylinePoint[]; radius: number }): string {
  const first = points[0];
  if (first == null) return '';
  const parts = [`M ${coord(first)}`];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    if (prev == null || curr == null) continue;

    const len1 = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const len2 = next == null ? 0 : Math.hypot(next.x - curr.x, next.y - curr.y);
    if (next == null || len1 === 0 || len2 === 0) {
      parts.push(`L ${coord(curr)}`);
      continue;
    }

    const r = Math.min(radius, len1 / 2, len2 / 2);
    const before = { x: curr.x - ((curr.x - prev.x) / len1) * r, y: curr.y - ((curr.y - prev.y) / len1) * r };
    const after = { x: curr.x + ((next.x - curr.x) / len2) * r, y: curr.y + ((next.y - curr.y) / len2) * r };
    parts.push(`L ${coord(before)} Q ${coord(curr)} ${coord(after)}`);
  }

  return parts.join(' ');
}

import { describe, expect, it } from 'vitest';

import { roundedPolylinePath } from '@/atoms/lib/roundedPolylinePath.js';

describe('roundedPolylinePath', () => {
  it('returns an empty path for no points', () => {
    expect(roundedPolylinePath({ points: [], radius: 2 })).toBe('');
  });

  it('draws a straight segment for two points', () => {
    expect(
      roundedPolylinePath({
        points: [
          { x: 0, y: 10 },
          { x: 10, y: 10 },
        ],
        radius: 2,
      }),
    ).toBe('M 0 10 L 10 10');
  });

  it('rounds an interior peak with a quadratic corner', () => {
    const d = roundedPolylinePath({
      points: [
        { x: 0, y: 20 },
        { x: 10, y: 0 },
        { x: 20, y: 20 },
      ],
      radius: 2,
    });
    expect(d).toContain('Q 10 0');
    expect(d.startsWith('M 0 20')).toBe(true);
    expect(d.endsWith('L 20 20')).toBe(true);
  });

  it('clamps radius on short segments so corners do not overshoot', () => {
    const d = roundedPolylinePath({
      points: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 4, y: 0 },
      ],
      radius: 10,
    });
    // Half of each length-2 segment ⇒ r=1, so the curve starts at x=1 and ends at x=3.
    expect(d).toBe('M 0 0 L 1 0 Q 2 0 3 0 L 4 0');
  });
});

import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { Spinner } from '@/atoms/primitives/Spinner.js';

describe('Spinner', () => {
  it('provides an accessible default loading indicator', () => {
    render(<Spinner />);

    const spinner = screen.getByRole('status', { name: 'Loading' });
    expect(spinner).toHaveAttribute('width', '16');
    expect(spinner).toHaveAttribute('height', '16');
    expect(spinner).toHaveAttribute('viewBox', '0 0 16 16');
    expect(spinner).toHaveClass('animate-spin');
  });

  it('derives its geometry from size and forwards SVG props and its ref', () => {
    const ref = createRef<SVGSVGElement>();
    render(
      <Spinner ref={ref} size={24} aria-label="Saving" className="host-spinner" data-track="save" strokeWidth={4} />,
    );

    const spinner = screen.getByRole('status', { name: 'Saving' });
    const circle = spinner.querySelector('circle');
    expect(spinner).toBe(ref.current);
    expect(spinner).toHaveAttribute('width', '24');
    expect(spinner).toHaveAttribute('height', '24');
    expect(spinner).toHaveAttribute('viewBox', '0 0 24 24');
    expect(spinner).toHaveAttribute('data-track', 'save');
    expect(spinner).toHaveAttribute('stroke-width', '4');
    expect(spinner).toHaveClass('animate-spin', 'host-spinner');
    expect(circle).toHaveAttribute('cx', '12');
    expect(circle).toHaveAttribute('cy', '12');
    expect(circle).toHaveAttribute('r', '9');
  });
});

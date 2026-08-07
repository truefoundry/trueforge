import { render, screen } from '@testing-library/react';
import type { SVGProps } from 'react';
import { describe, expect, it } from 'vitest';

import { Icon } from '@/icons/Icon.js';
import { ThemeProvider } from '@/theme/ThemeProvider.js';

function CustomIcon(props: SVGProps<SVGSVGElement>) {
  return <svg data-testid="custom-icon" {...props} />;
}

describe('Icon', () => {
  it('renders a named icon as decorative by default', () => {
    const { container } = render(<Icon name="check" className="host-icon" size={20} style={{ color: 'red' }} />);
    const icon = container.querySelector('svg');

    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveAttribute('width', '20');
    expect(icon).toHaveAttribute('height', '20');
    expect(icon).toHaveClass('inline-block', 'shrink-0', 'host-icon');
    expect(icon?.style.color).toBe('red');
  });

  it('uses the last array entry and exposes labelled icons as images', () => {
    render(<Icon name={['far', 'clone']} aria-label="Copy message" />);

    const icon = screen.getByRole('img', { name: 'Copy message' });
    expect(icon).toHaveClass('lucide-copy');
    expect(icon).not.toHaveAttribute('aria-hidden');
  });

  it('prefers a theme icon override while preserving icon props', () => {
    render(
      <ThemeProvider theme={{ icons: { check: CustomIcon } }}>
        <Icon name="check" aria-label="Custom check" className="override-class" size="2rem" />
      </ThemeProvider>,
    );

    const icon = screen.getByRole('img', { name: 'Custom check' });
    expect(icon).toBe(screen.getByTestId('custom-icon'));
    expect(icon).toHaveClass('inline-block', 'override-class');
    expect(icon).toHaveAttribute('width', '2rem');
    expect(icon).toHaveAttribute('height', '2rem');
  });

  it('renders nothing for an unknown icon name', () => {
    const { container } = render(<Icon name="not-registered" aria-label="Unknown" />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('img', { name: 'Unknown' })).not.toBeInTheDocument();
  });
});

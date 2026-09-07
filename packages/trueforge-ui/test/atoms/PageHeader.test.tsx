// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageHeader } from '@/atoms/PageHeader.js';

describe('PageHeader', () => {
  it('renders a string title with shared header chrome', () => {
    render(<PageHeader title="Agent Sessions" end={<button type="button">Filter</button>} />);

    expect(screen.getByRole('banner')).toHaveClass('min-h-14');
    expect(screen.getByRole('heading', { name: 'Agent Sessions' })).toHaveClass('text-md', 'font-semibold');
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();
  });

  it('renders a custom title node without wrapping another h1', () => {
    render(
      <PageHeader
        title={<h1 className="text-md font-semibold">New Chat</h1>}
        start={<button type="button">Menu</button>}
      />,
    );

    expect(screen.getByRole('heading', { name: 'New Chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
  });
});

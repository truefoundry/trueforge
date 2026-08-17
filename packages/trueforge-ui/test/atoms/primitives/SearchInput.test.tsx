import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SearchInput from '@/atoms/primitives/SearchInput.js';

describe('SearchInput', () => {
  it('renders an accessible focused search control with its default placeholder', () => {
    render(<SearchInput query="" setQuery={vi.fn()} />);

    const input = screen.getByRole('searchbox');
    expect(input).toHaveAttribute('type', 'search');
    expect(input).toHaveAttribute('placeholder', 'Search');
    expect(input).toHaveFocus();
  });

  it('reports user changes and reflects controlled query updates', () => {
    const setQuery = vi.fn();
    const { rerender } = render(<SearchInput query="initial" setQuery={setQuery} placeholder="Find agents" />);

    const input = screen.getByRole('searchbox');
    expect(input).toHaveValue('initial');
    expect(input).toHaveAttribute('placeholder', 'Find agents');

    fireEvent.change(input, { target: { value: 'updated' } });

    expect(setQuery).toHaveBeenCalledOnce();
    expect(setQuery).toHaveBeenCalledWith('updated');

    rerender(<SearchInput query="updated" setQuery={setQuery} placeholder="Find agents" />);

    expect(screen.getByRole('searchbox')).toHaveValue('updated');
  });
});

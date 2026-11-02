import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MultiSelectInput } from '@/atoms/primitives/MultiSelectInput.js';

type Item = { id: string; name: string };

const items: Item[] = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob' },
];

function renderInput({ selected = items, query = '' }: { selected?: Item[]; query?: string } = {}) {
  const onRemove = vi.fn();
  const onQueryChange = vi.fn();
  render(
    <MultiSelectInput
      selected={selected}
      getKey={item => item.id}
      getLabel={item => item.name}
      onRemove={onRemove}
      query={query}
      onQueryChange={onQueryChange}
      placeholder="Add people"
      aria-label="Search"
    />,
  );
  return { onRemove, onQueryChange, input: screen.getByLabelText('Search') };
}

describe('MultiSelectInput', () => {
  it('renders selected items as chips inside the field and hides the placeholder', () => {
    const { input } = renderInput();

    expect(input.closest('label')).toContainElement(screen.getByRole('button', { name: 'Remove Alice' }));
    expect(input.closest('label')).toContainElement(screen.getByRole('button', { name: 'Remove Bob' }));
    expect(input).not.toHaveAttribute('placeholder');
  });

  it('shows the placeholder when nothing is selected', () => {
    const { input } = renderInput({ selected: [] });

    expect(input).toHaveAttribute('placeholder', 'Add people');
  });

  it('removes a chip when its button is clicked', () => {
    const { onRemove } = renderInput();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Alice' }));

    expect(onRemove).toHaveBeenCalledWith(items[0]);
  });

  it('reports query changes', () => {
    const { onQueryChange, input } = renderInput();

    fireEvent.change(input, { target: { value: 'ca' } });

    expect(onQueryChange).toHaveBeenCalledWith('ca');
  });

  it('removes the last chip on Backspace only when the query is empty', () => {
    const empty = renderInput();
    fireEvent.keyDown(empty.input, { key: 'Backspace' });
    expect(empty.onRemove).toHaveBeenCalledWith(items[1]);
  });

  it('keeps chips on Backspace while the query has text', () => {
    const { onRemove, input } = renderInput({ query: 'b' });

    fireEvent.keyDown(input, { key: 'Backspace' });

    expect(onRemove).not.toHaveBeenCalled();
  });
});
